alter table public.user_settings
add column if not exists pinterest_environment text not null default 'production'
  check (pinterest_environment in ('production', 'sandbox')),
add column if not exists pinterest_sandbox_access_token text,
add column if not exists pinterest_sandbox_board_id text;

notify pgrst, 'reload schema';
