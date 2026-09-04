alter table public.pin_queue
add column if not exists schedule_locked boolean not null default false;

alter table public.instagram_queue
add column if not exists schedule_locked boolean not null default false;
