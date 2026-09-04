alter table public.instagram_queue
add column if not exists available_media_urls jsonb not null default '[]'::jsonb;

update public.instagram_queue
set available_media_urls = media_urls
where available_media_urls = '[]'::jsonb
  and media_urls <> '[]'::jsonb;
