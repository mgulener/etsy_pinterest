create type public.pin_queue_status as enum (
  'pending',
  'processing',
  'published',
  'failed',
  'cancelled'
);

create table public.etsy_listings (
  id uuid primary key default gen_random_uuid(),
  etsy_listing_id bigint not null unique,
  etsy_image_id bigint,
  image_url text,
  title text not null,
  description text,
  url text,
  state text not null,
  original_creation_timestamp bigint,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.pin_queue (
  id uuid primary key default gen_random_uuid(),
  etsy_listing_id bigint not null unique references public.etsy_listings(etsy_listing_id) on delete cascade,
  etsy_image_id bigint,
  image_url text,
  title text not null,
  description text,
  destination_url text,
  board_id text not null,
  status public.pin_queue_status not null default 'pending',
  attempt_count integer not null default 0,
  last_error text,
  scheduled_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz
);

create table public.pinterest_posts (
  id uuid primary key default gen_random_uuid(),
  etsy_listing_id bigint not null unique references public.etsy_listings(etsy_listing_id) on delete cascade,
  etsy_image_id bigint,
  pinterest_pin_id text not null unique,
  pinterest_board_id text not null,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create index etsy_listings_last_seen_idx on public.etsy_listings(last_seen_at desc);
create index etsy_listings_title_idx on public.etsy_listings using gin (to_tsvector('simple', title));
create index pin_queue_status_scheduled_idx on public.pin_queue(status, scheduled_at, created_at);
create index pinterest_posts_published_at_idx on public.pinterest_posts(published_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_etsy_listings_updated_at
before update on public.etsy_listings
for each row execute function public.set_updated_at();

create trigger set_pin_queue_updated_at
before update on public.pin_queue
for each row execute function public.set_updated_at();

create or replace function public.set_app_settings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_app_settings_updated_at
before update on public.app_settings
for each row execute function public.set_app_settings_updated_at();
