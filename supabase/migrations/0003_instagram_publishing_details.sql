alter table public.instagram_queue
add column if not exists processing_started_at timestamptz,
add column if not exists post_mode text not null default 'single',
add column if not exists media_urls jsonb not null default '[]'::jsonb;

alter table public.instagram_posts
add column if not exists instagram_creation_id text,
add column if not exists media_type text not null default 'IMAGE',
add column if not exists caption text;
