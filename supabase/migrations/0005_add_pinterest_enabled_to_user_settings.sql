alter table public.user_settings
add column if not exists pinterest_enabled boolean not null default true;
