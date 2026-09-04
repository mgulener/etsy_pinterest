alter table public.etsy_listings
add column if not exists image_urls jsonb not null default '[]'::jsonb;

update public.etsy_listings
set image_urls = jsonb_build_array(image_url)
where image_urls = '[]'::jsonb
  and image_url is not null;
