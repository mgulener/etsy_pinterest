begin;
alter table public.facebook_settings
  drop constraint facebook_settings_interval_minutes_check;
alter table public.facebook_settings
  add constraint facebook_settings_interval_minutes_check
  check (interval_minutes between 5 and 1440);
commit;
