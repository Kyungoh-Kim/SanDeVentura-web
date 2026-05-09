-- =============================================================================
-- 0023_split_cron.sql
-- Schedules the evaluate-route-splits edge function to run once per hour
-- via pg_cron + pg_net (same pattern as 0013_match_cron.sql).
--
-- dryRun=false: executes splits automatically when thresholds are met.
-- No-ops gracefully if pg_cron is not available.
-- =============================================================================

do $outer$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'evaluate-route-splits-hourly',
      '0 * * * *',
      $cron_body$
      select net.http_post(
        url     := current_setting('app.functions_url') || '/evaluate-route-splits',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
          'Content-Type',  'application/json'
        ),
        body    := '{"dryRun": false}'::jsonb
      );
      $cron_body$
    );
  end if;
end
$outer$;
