alter table public.user_settings
add column if not exists pinterest_app_id text,
add column if not exists pinterest_app_secret text,
add column if not exists pinterest_redirect_uri text,
add column if not exists pinterest_refresh_token text,
add column if not exists pinterest_token_expires_at bigint,
add column if not exists pinterest_token_scope text,
add column if not exists pinterest_token_type text;
