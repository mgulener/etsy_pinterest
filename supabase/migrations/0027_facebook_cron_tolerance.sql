begin;

-- Vercel Cron starts on the configured minute, but the preceding API request can
-- finish a few seconds after its slot. Allow normal scheduler jitter without
-- weakening the processing/needs-review locks that prevent duplicate posts.
create or replace function public.claim_facebook_post(
  p_user_id uuid,
  p_page_id text,
  p_automatic boolean default false
)
returns setof public.facebook_queue
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  config public.facebook_settings;
  next_id uuid;
  minimum_gap interval;
begin
  select * into config from public.facebook_settings where user_id = p_user_id for update;
  if not found or config.page_id <> p_page_id or not config.enabled or (p_automatic and not config.automatic_enabled) then return; end if;
  perform pg_advisory_xact_lock(hashtextextended('facebook:' || config.page_id, 0));
  if exists (select 1 from public.facebook_queue where page_id = config.page_id and status in ('processing','needs_review')) then return; end if;

  minimum_gap := greatest(
    make_interval(mins => config.interval_minutes) - interval '90 seconds',
    interval '0 seconds'
  );
  if exists (
    select 1 from public.facebook_queue
    where page_id = config.page_id and published_at > now() - minimum_gap
  ) then return; end if;

  select id into next_id from public.facebook_queue
    where user_id = p_user_id and page_id = config.page_id and status = 'pending' and scheduled_at <= now()
    order by scheduled_at, created_at, id limit 1 for update skip locked;
  if next_id is null then return; end if;
  return query update public.facebook_queue set status = 'processing', request_started_at = now(),
    attempt_count = attempt_count + 1, last_error = null where id = next_id returning *;
end;
$$;

revoke all on function public.claim_facebook_post(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.claim_facebook_post(uuid, text, boolean) to service_role;

commit;
