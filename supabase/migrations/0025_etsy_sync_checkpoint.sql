-- Keep incomplete imports retryable while satisfying the social queues' listing FKs.
alter table public.etsy_listings
  add column if not exists social_sync_pending boolean not null default false;

notify pgrst, 'reload schema';
