-- Migration: Schedule weekly execution of the find-collaborators Edge Function
-- Requires: pg_cron, pg_net, and Supabase Vault secrets configured once per environment.
--
-- One-time setup in Supabase SQL Editor (replace placeholders with real values):
--   select vault.create_secret('https://<PROJECT_REF>.supabase.co', 'project_url');
--   select vault.create_secret('<STRONG_RANDOM_CRON_SECRET>', 'find_collaborators_cron_secret');
--
-- Also set the same CRON_SECRET as an Edge Function secret:
--   supabase secrets set CRON_SECRET=<STRONG_RANDOM_CRON_SECRET>

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

create or replace function public.invoke_find_collaborators(
  p_target_count integer default 20,
  p_trigger_source text default 'cron'
)
returns bigint
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  v_project_url text;
  v_cron_secret text;
  v_request_id bigint;
begin
  select decrypted_secret
    into v_project_url
    from vault.decrypted_secrets
   where name = 'project_url'
   limit 1;

  select decrypted_secret
    into v_cron_secret
    from vault.decrypted_secrets
   where name = 'find_collaborators_cron_secret'
   limit 1;

  if v_project_url is null or trim(v_project_url) = '' then
    raise exception 'Missing Vault secret: project_url. Add it with vault.create_secret(''https://<ref>.supabase.co'', ''project_url'').';
  end if;

  if v_cron_secret is null or trim(v_cron_secret) = '' then
    raise exception 'Missing Vault secret: find_collaborators_cron_secret. Add it with vault.create_secret(''<secret>'', ''find_collaborators_cron_secret'').';
  end if;

  select net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/find-collaborators',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_cron_secret
    ),
    body := jsonb_build_object(
      'target_count', greatest(1, p_target_count),
      'trigger_source', p_trigger_source
    ),
    timeout_milliseconds := 120000
  )
  into v_request_id;

  return v_request_id;
end;
$$;

-- Restrict direct invocation to privileged database roles only
revoke all on function public.invoke_find_collaborators(integer, text) from public, anon, authenticated;
grant execute on function public.invoke_find_collaborators(integer, text) to postgres, service_role;

-- Idempotently schedule the weekly cron job:
-- Runs every Sunday at 23:00 UTC (Monday 09:00 AEST / 10:00 AEDT Sydney time)
do $$
declare
  v_existing_job_id bigint;
begin
  select jobid
    into v_existing_job_id
    from cron.job
   where jobname = 'weekly-find-collaborators';

  if v_existing_job_id is not null then
    perform cron.unschedule(v_existing_job_id);
  end if;

  perform cron.schedule(
    'weekly-find-collaborators',
    '0 23 * * 0',
    $cron$select public.invoke_find_collaborators(20, 'cron');$cron$
  );
end;
$$;
