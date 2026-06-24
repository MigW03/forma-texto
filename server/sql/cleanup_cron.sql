-- File auto-deletion schedule (Supabase pg_cron).
--
-- Fires a daily HTTP POST to the server's
--   POST /api/maintenance/cleanup-expired
-- endpoint, which deletes the stored files of any project past its
-- `delete_files_at` deadline and stamps `files_deleted_at`. The deletion logic
-- lives in the server (server/src/lib/cleanupExpiredFiles.ts) — this file only
-- schedules the trigger, so there is no logic duplicated in SQL/Deno.
--
-- Run this ONCE per environment in the Supabase SQL editor (it is not an
-- automatic migration). Re-running cron.schedule with the same job name
-- replaces the existing schedule.

-- 1. Enable the extensions (idempotent; both ship with Supabase).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2. Store the endpoint URL + shared secret in Vault so they are not written
--    into the cron job definition in plaintext. Run these two lines once with
--    your real values; skip/replace if the secrets already exist.
--    (WEBHOOK_SECRET must match server/.env.)
--
--    select vault.create_secret('https://your-server.example.com/api/maintenance/cleanup-expired', 'cleanup_endpoint_url');
--    select vault.create_secret('your-webhook-secret', 'cleanup_webhook_secret');

-- 3. Schedule the daily sweep (03:00 UTC = 00:00 in BRT). Reads URL + secret
--    from Vault at run time.
select cron.schedule(
  'cleanup-expired-files',
  '0 3 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'cleanup_endpoint_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cleanup_webhook_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Useful operational queries:
--   select * from cron.job;                                    -- list schedules
--   select * from cron.job_run_details order by start_time desc limit 20;  -- run history
--   select cron.unschedule('cleanup-expired-files');           -- remove the schedule
