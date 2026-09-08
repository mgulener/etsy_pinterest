-- Run as postgres. A successful cron SQL execution only means HTTP was enqueued.
select jobname, schedule, active from cron.job where jobname = 'instagram-publish-15m';
select d.start_time, d.end_time, d.status, d.return_message
from cron.job_run_details d join cron.job j using (jobid)
where j.jobname = 'instagram-publish-15m' order by d.start_time desc limit 10;

-- pg_net responses expire (normally after six hours). Do not interpret missing as success.
select r.requested_at, r.request_id, h.status_code, h.timed_out,
  h.error_msg, h.content as publish_result
from public.instagram_cron_requests r
left join net._http_response h on h.id = r.request_id
order by r.requested_at desc limit 10;

-- Confirm actual publication separately; HTTP 200 alone is not sufficient.
select etsy_listing_id, instagram_media_id, published_at
from public.instagram_posts order by published_at desc limit 10;

-- Pause if API access is blocked or a result is uncertain:
-- select cron.alter_job(jobid, active := false) from cron.job where jobname = 'instagram-publish-15m';
