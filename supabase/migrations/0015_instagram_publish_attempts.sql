-- Apply before deploying the durable Instagram publisher.
alter type public.pin_queue_status add value if not exists 'needs_review';

create table public.instagram_publish_attempts (
  id uuid primary key default gen_random_uuid(),
  etsy_listing_id bigint not null,
  account_id text not null,
  state text not null default 'preparing' check (state in ('preparing', 'ready', 'publishing', 'published', 'failed', 'retired')),
  container_id text,
  media_id text,
  media_type text not null check (media_type in ('IMAGE', 'CAROUSEL')),
  caption text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (state not in ('ready', 'publishing') or container_id is not null),
  check (state <> 'published' or media_id is not null)
);
-- Keep evidence even if a queue or listing is deleted and recreated.
create unique index instagram_publish_attempts_active
on public.instagram_publish_attempts (account_id, etsy_listing_id)
where state not in ('failed', 'retired');
create trigger set_instagram_publish_attempts_updated_at before update on public.instagram_publish_attempts
for each row execute function public.set_updated_at();
alter table public.instagram_publish_attempts enable row level security;
revoke all on public.instagram_publish_attempts from anon, authenticated;
grant all on public.instagram_publish_attempts to service_role;
notify pgrst, 'reload schema';
