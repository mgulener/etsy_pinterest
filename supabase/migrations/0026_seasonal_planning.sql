begin;

alter table public.etsy_listings add column if not exists tags text[] not null default '{}';

create table if not exists public.seasonal_planning_settings (
  user_id uuid primary key references public.admin_users(id) on delete cascade,
  enabled boolean not null default false,
  lead_time_days integer not null default 14 check (lead_time_days between 0 and 60),
  lookahead_days integer not null default 90 check (lookahead_days between 1 and 365)
);

-- Per-user cache may be populated before the shop listing is inserted during sync.
create table if not exists public.listing_event_classifications (
  user_id uuid not null references public.admin_users(id) on delete cascade,
  etsy_listing_id bigint not null,
  input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
  classifier_version text not null,
  model text not null,
  classification jsonb not null check (jsonb_typeof(classification) = 'object'),
  classified_at timestamptz not null default now(),
  primary key(user_id, etsy_listing_id)
);

alter table public.seasonal_planning_settings enable row level security;
alter table public.listing_event_classifications enable row level security;
revoke all on public.seasonal_planning_settings, public.listing_event_classifications from anon, authenticated;
grant all on public.seasonal_planning_settings, public.listing_event_classifications to service_role;
notify pgrst, 'reload schema';
commit;
