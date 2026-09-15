begin;

create table public.facebook_settings (
  user_id uuid primary key references public.admin_users(id) on delete cascade,
  page_id text not null check (page_id ~ '^[0-9]+$'),
  page_name text not null,
  page_access_token text not null,
  api_version text not null check (api_version ~ '^v[0-9]+\.0$'),
  enabled boolean not null default false,
  automatic_enabled boolean not null default false,
  interval_minutes integer not null default 15 check (interval_minutes between 15 and 1440),
  verified_at timestamptz not null,
  updated_at timestamptz not null default now()
);

-- The queue also holds the publication receipt, so success is one atomic DB write.
-- Listing snapshots are intentionally independent of the legacy shop-wide listing cache.
create table public.facebook_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.admin_users(id) on delete cascade,
  page_id text not null check (page_id ~ '^[0-9]+$'),
  etsy_listing_id bigint not null,
  title text not null,
  image_url text not null,
  destination_url text not null,
  message text not null check (length(trim(message)) between 1 and 2000),
  status text not null default 'pending' check (status in ('pending','processing','published','failed','needs_review','cancelled')),
  scheduled_at timestamptz not null default now(),
  schedule_locked boolean not null default false,
  attempt_count integer not null default 0,
  last_error text,
  request_started_at timestamptz,
  facebook_post_id text unique,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, page_id, etsy_listing_id),
  check (status <> 'published' or (facebook_post_id is not null and published_at is not null))
);

create index facebook_queue_due on public.facebook_queue(user_id, page_id, status, scheduled_at, id);
create index facebook_queue_page_history on public.facebook_queue(page_id, status, published_at desc);
-- Do not depend on optional legacy user-settings triggers during rollout.
create function public.set_facebook_updated_at()
returns trigger language plpgsql set search_path = pg_catalog, pg_temp as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;
create trigger facebook_settings_updated_at before update on public.facebook_settings
  for each row execute function public.set_facebook_updated_at();
create trigger facebook_queue_updated_at before update on public.facebook_queue
  for each row execute function public.set_facebook_updated_at();

alter table public.facebook_settings enable row level security;
alter table public.facebook_queue enable row level security;
revoke all on public.facebook_settings, public.facebook_queue from anon, authenticated;
grant all on public.facebook_settings, public.facebook_queue to service_role;

-- Serialize claims per Page, including simultaneous manual and cron requests.
create function public.claim_facebook_post(p_user_id uuid, p_page_id text, p_automatic boolean default false)
returns setof public.facebook_queue
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  config public.facebook_settings;
  next_id uuid;
begin
  select * into config from public.facebook_settings where user_id = p_user_id for update;
  if not found or config.page_id <> p_page_id or not config.enabled or (p_automatic and not config.automatic_enabled) then return; end if;
  perform pg_advisory_xact_lock(hashtextextended('facebook:' || config.page_id, 0));
  if exists (select 1 from public.facebook_queue where page_id = config.page_id and status in ('processing','needs_review')) then return; end if;
  if exists (select 1 from public.facebook_queue where page_id = config.page_id and published_at > now() - make_interval(mins => config.interval_minutes)) then return; end if;
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

create function public.schedule_facebook_posts(p_user_id uuid, p_page_id text, p_updates jsonb)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare changed integer;
begin
  update public.facebook_queue q set scheduled_at = plan.scheduled_at
  from jsonb_to_recordset(p_updates) as plan(id uuid, scheduled_at timestamptz, updated_at timestamptz)
  where q.user_id = p_user_id and q.page_id = p_page_id and q.id = plan.id
    and q.status = 'pending' and not q.schedule_locked and q.updated_at = plan.updated_at;
  get diagnostics changed = row_count;
  return changed;
end;
$$;
revoke all on function public.schedule_facebook_posts(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.schedule_facebook_posts(uuid, text, jsonb) to service_role;

commit;
