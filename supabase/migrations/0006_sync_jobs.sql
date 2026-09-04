create table public.sync_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.admin_users(id) on delete cascade,
  type text not null check (type in ('etsy_sync')),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed')),
  progress_current integer not null default 0,
  progress_total integer not null default 100,
  sync_limit integer check (sync_limit is null or sync_limit > 0),
  message text not null default 'Queued',
  result jsonb,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index sync_jobs_user_type_created_idx
on public.sync_jobs (user_id, type, created_at desc);

create index sync_jobs_active_idx
on public.sync_jobs (user_id, type, status)
where status in ('queued', 'running');

create or replace function public.set_sync_jobs_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_sync_jobs_updated_at
before update on public.sync_jobs
for each row execute function public.set_sync_jobs_updated_at();
