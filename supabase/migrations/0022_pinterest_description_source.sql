alter table public.pin_queue
  add column pin_description_source text
    check (pin_description_source in ('ai', 'manual')),
  add column pin_description_generated_at timestamptz;

update public.pin_queue set pin_description_source = 'manual'
where pin_description is not null;

notify pgrst, 'reload schema';
