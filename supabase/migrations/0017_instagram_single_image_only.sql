update public.user_settings
set instagram_post_mode = 'single'
where instagram_post_mode <> 'single';

update public.instagram_queue
set
  post_mode = 'single',
  media_urls = case
    when jsonb_array_length(media_urls) > 0 then jsonb_build_array(media_urls -> 0)
    when image_url is not null then jsonb_build_array(image_url)
    else '[]'::jsonb
  end
where status <> 'published';

update public.instagram_queue
set
  status = 'pending',
  attempt_count = 0,
  last_error = null,
  processing_started_at = null,
  processed_at = null
where status = 'failed'
  and last_error like '%2207069%';

notify pgrst, 'reload schema';
