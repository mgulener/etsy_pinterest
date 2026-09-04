alter table public.instagram_queue
add column if not exists caption_source text not null default 'rule'
  check (caption_source in ('rule', 'ai', 'manual')),
add column if not exists caption_generated_at timestamptz;

update public.instagram_queue
set caption_source = 'ai',
    caption_generated_at = coalesce(caption_generated_at, updated_at)
where caption_source = 'rule';
