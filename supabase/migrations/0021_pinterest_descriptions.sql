alter table public.pin_queue
  add column pin_description text
    check (pin_description is null or (
      char_length(btrim(pin_description)) between 1 and 500
    ));

comment on column public.pin_queue.pin_description is
  'User-approved Pinterest description; description retains the original Etsy text.';

notify pgrst, 'reload schema';
