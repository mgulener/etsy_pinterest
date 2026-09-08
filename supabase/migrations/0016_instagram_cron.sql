-- Install in Supabase SQL Editor as postgres. Publishing starts only after activation.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists public.instagram_cron_requests (
  request_id bigint primary key,
  requested_at timestamptz not null default now()
);
alter table public.instagram_cron_requests enable row level security;
revoke all on public.instagram_cron_requests from public, anon, authenticated;
grant select on public.instagram_cron_requests to service_role;

create or replace function public.trigger_instagram_cron()
returns bigint
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  secret text;
  request_id bigint;
  settings public.user_settings%rowtype;
  previous public.instagram_cron_requests%rowtype;
  response net._http_response%rowtype;
  result jsonb;
begin
  if not pg_try_advisory_xact_lock(20260907, 15) then return null; end if;
  select * into previous from public.instagram_cron_requests order by requested_at desc limit 1;
  if previous.request_id is not null and previous.requested_at < now() - interval '10 minutes' then
    select * into response from net._http_response where id = previous.request_id;
    if response.status_code = 200 and not coalesce(response.timed_out, false) then
      begin
        result := response.content::jsonb;
      exception when others then
        raise exception 'Previous cron response is invalid; verify before continuing';
      end;
      if result->>'mode' is distinct from 'publish-instagram'
        or result->>'dryRun' is distinct from 'false'
        or coalesce((result->>'needsReview')::integer, 0) > 0
        or coalesce(jsonb_array_length(result->'errors'), 0) > 0 then
        raise exception 'Previous Instagram run requires review; no request sent';
      end if;
    elsif not exists (select 1 from public.instagram_posts where published_at >= previous.requested_at) then
      raise exception 'Previous HTTP result missing or failed; verify before continuing';
    end if;
  end if;
  -- Fail closed for ambiguous ownership until queues are fully tenant-scoped.
  if (select count(*) from public.user_settings where instagram_enabled
      and instagram_access_token is not null
      and coalesce(instagram_account_id, instagram_user_id) is not null) <> 1 then
    raise exception 'Exactly one enabled Instagram automation account is required';
  end if;
  select * into settings from public.user_settings
    where instagram_enabled and instagram_access_token is not null
      and coalesce(instagram_account_id, instagram_user_id) is not null;
  if settings.max_instagram_posts_per_run is distinct from 1 or settings.dry_run is distinct from false then
    raise exception 'Instagram requires max posts 1 and dry run false';
  end if;
  if exists (select 1 from public.instagram_queue where status = 'needs_review') then
    raise exception 'Instagram verification required; no request sent';
  end if;
  if exists (select 1 from public.instagram_queue where status = 'processing')
    or exists (select 1 from public.instagram_posts where published_at > now() - interval '15 minutes')
    or exists (select 1 from public.instagram_cron_requests where requested_at > now() - interval '15 minutes')
    or not exists (select 1 from public.instagram_queue where status = 'pending' and scheduled_at <= now()) then
    return null;
  end if;
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'instagram_cron_secret';
  if secret is null or length(trim(secret)) = 0 then
    raise exception 'Create instagram_cron_secret in Supabase Vault first';
  end if;
  select net.http_get(
    url := 'https://etsy-pinterest.vercel.app/api/cron/instagram/publish',
    headers := jsonb_build_object('Authorization', 'Bearer ' || secret),
    timeout_milliseconds := 300000
  ) into request_id;
  insert into public.instagram_cron_requests(request_id) values (request_id);
  return request_id;
end;
$$;
revoke all on function public.trigger_instagram_cron() from public, anon, authenticated, service_role;

do $$
declare job bigint;
begin
  if not exists (select 1 from cron.job where jobname = 'instagram-publish-15m') then
    select cron.schedule('instagram-publish-15m', '*/15 * * * *', 'select public.trigger_instagram_cron();') into job;
    perform cron.alter_job(job, active := false);
  end if;
end;
$$;
commit;
