-- =============================================================================
-- 0013_match_cron.sql
-- Schedules the match-and-aggregate-sessions edge function to run every 15
-- minutes via pg_cron + pg_net.
--
-- Prerequisites: pg_cron and pg_net extensions must be enabled (0001).
-- Requires app.functions_url and app.service_role_key database settings.
-- These are set in the Supabase project dashboard under Database > Settings.
-- No-ops gracefully if pg_cron is not available (e.g. local dev without cron).
-- =============================================================================

do $outer$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule(
      'match-sessions-every-15min',
      '*/15 * * * *',
      $cron_body$
      select net.http_post(
        url     := current_setting('app.functions_url') || '/match-and-aggregate-sessions',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
          'Content-Type',  'application/json'
        ),
        body    := '{}'::jsonb
      );
      $cron_body$
    );
  end if;
end
$outer$;
