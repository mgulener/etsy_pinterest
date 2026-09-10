alter table public.etsy_listings
add column if not exists etsy_shop_section_id bigint;

create table if not exists public.pinterest_board_mappings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.admin_users(id) on delete cascade,
  etsy_shop_section_id bigint not null,
  etsy_section_title text not null,
  pinterest_board_id text not null,
  pinterest_board_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, etsy_shop_section_id),
  unique (user_id, pinterest_board_id)
);

create index if not exists pinterest_board_mappings_user_id_idx
on public.pinterest_board_mappings(user_id);

drop trigger if exists set_pinterest_board_mappings_updated_at
on public.pinterest_board_mappings;

create trigger set_pinterest_board_mappings_updated_at
before update on public.pinterest_board_mappings
for each row execute function public.set_updated_at();

notify pgrst, 'reload schema';
