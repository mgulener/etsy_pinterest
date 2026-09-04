alter table public.sync_jobs
  drop constraint if exists sync_jobs_type_check;

alter table public.sync_jobs
  add constraint sync_jobs_type_check
  check (type in ('etsy_sync', 'instagram_ai_captions'));
