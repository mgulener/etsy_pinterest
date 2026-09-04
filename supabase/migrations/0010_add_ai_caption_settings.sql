alter table public.user_settings
add column if not exists ai_captions_enabled boolean not null default false,
add column if not exists openai_api_key text,
add column if not exists openai_model text not null default 'gpt-5.4-mini';
