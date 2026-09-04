alter table public.sync_jobs
add column if not exists sync_limit integer check (sync_limit is null or sync_limit > 0);
