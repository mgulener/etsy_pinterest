create extension if not exists pgcrypto;

create table public.admin_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  password_salt text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_settings (
  user_id uuid primary key references public.admin_users(id) on delete cascade,
  etsy_api_key text,
  etsy_redirect_uri text,
  etsy_shop_id text,
  etsy_access_token text,
  etsy_refresh_token text,
  etsy_token_expires_at bigint,
  etsy_token_scope text,
  etsy_token_type text,
  pinterest_enabled boolean not null default true,
  pinterest_access_token text,
  pinterest_board_id text,
  instagram_enabled boolean not null default false,
  instagram_access_token text,
  instagram_account_id text,
  instagram_user_id text,
  instagram_post_mode text not null default 'single' check (instagram_post_mode in ('single', 'carousel')),
  meta_api_version text,
  dry_run boolean not null default false,
  max_pins_per_run integer not null default 10,
  max_pin_retries integer not null default 3,
  max_instagram_posts_per_run integer not null default 5,
  max_instagram_retries integer not null default 3,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_admin_users_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create or replace function public.set_user_settings_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger set_admin_users_updated_at
before update on public.admin_users
for each row execute function public.set_admin_users_updated_at();

create trigger set_user_settings_updated_at
before update on public.user_settings
for each row execute function public.set_user_settings_updated_at();
