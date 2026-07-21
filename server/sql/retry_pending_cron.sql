-- Pending-job retry schedule (Supabase pg_cron).
--
-- Fires a DAILY HTTP POST to the server's
--   POST /api/maintenance/retry-pending
-- endpoint, which re-triggers `pending` jobs that stalled — most commonly because a
-- processing run hit the AI provider's rate limit (OpenRouter free-tier 50/day) and
-- was requeued to `pending` instead of shipping a doc with the AI passes skipped. The
-- retry logic lives in the server (server/src/lib/retryPendingJobs.ts) — this file only
-- schedules the trigger.
--
-- WHY DAILY (not hourly): the free-tier cap resets once a day, so retrying more often
-- just burns a job's attempt budget while quota is still exhausted. Running shortly
-- after the reset (00:00 UTC) gives each rate-limited job one fresh attempt per window.
-- Bump to a shorter interval only once you are on a paid tier with per-minute limits.
--
-- Run this ONCE per environment in the Supabase SQL editor (not an automatic
-- migration). Re-running cron.schedule with the same job name replaces the schedule.
--
-- PREREQUISITE MIGRATION (run once, see supabase_tables.md):
--   alter table projects add column if not exists processing_attempts int not null default 0;

-- 1. Extensions (idempotent; both ship with Supabase).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2. Store the endpoint URL + shared secret in Vault (skip if they already exist for
--    another job — reuse the same webhook secret). WEBHOOK_SECRET must match server/.env.
--
--    select vault.create_secret('https://your-server.example.com/api/maintenance/retry-pending', 'retry_pending_endpoint_url');
--    select vault.create_secret('your-webhook-secret', 'retry_pending_webhook_secret');

-- 3. Schedule the daily retry (00:30 UTC — just after the free-tier daily reset).
select cron.schedule(
  'retry-pending-jobs',
  '30 0 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'retry_pending_endpoint_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'retry_pending_webhook_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Useful operational queries:
--   select * from cron.job;                                    -- list schedules
--   select * from cron.job_run_details order by start_time desc limit 20;  -- run history
--   select cron.unschedule('retry-pending-jobs');              -- remove the schedule
