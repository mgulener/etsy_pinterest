-- Run only after creating the Vault secret and disabling other publishing schedulers.
do $$
declare job bigint;
begin
  if not exists (select 1 from vault.decrypted_secrets
    where name = 'instagram_cron_secret' and length(trim(decrypted_secret)) > 0) then
    raise exception 'Missing instagram_cron_secret in Vault';
  end if;
  select jobid into job from cron.job where jobname = 'instagram-publish-15m';
  if job is null then raise exception 'Install migration 0016 first'; end if;
  perform cron.alter_job(job, active := true);
end;
$$;
select jobname, schedule, active from cron.job where jobname = 'instagram-publish-15m';
