create table public.instagram_queue (
  id uuid primary key default gen_random_uuid(),
  etsy_listing_id bigint not null unique references public.etsy_listings(etsy_listing_id) on delete cascade,
  etsy_image_id bigint,
  image_url text,
  title text not null,
  description text,
  destination_url text,
  caption text not null,
  post_mode text not null default 'single',
  media_urls jsonb not null default '[]'::jsonb,
  status public.pin_queue_status not null default 'pending',
  attempt_count integer not null default 0,
  last_error text,
  scheduled_at timestamptz not null default now(),
  processing_started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz
);

create table public.instagram_posts (
  id uuid primary key default gen_random_uuid(),
  etsy_listing_id bigint not null unique references public.etsy_listings(etsy_listing_id) on delete cascade,
  etsy_image_id bigint,
  instagram_media_id text not null unique,
  instagram_creation_id text,
  media_type text not null default 'IMAGE',
  caption text,
  instagram_permalink text,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index instagram_queue_status_scheduled_idx on public.instagram_queue(status, scheduled_at, created_at);
create index instagram_posts_published_at_idx on public.instagram_posts(published_at desc);

create trigger set_instagram_queue_updated_at
before update on public.instagram_queue
for each row execute function public.set_updated_at();
