-- Migration: Create collaboration_scrape_runs and collaboration_leads tables
-- Purpose: Store potential media, podcast, and social-media collaboration leads
--          for James Castrission / My Adventure Group, along with weekly run logs.

create extension if not exists pgcrypto;

-- 1. Audit & run-tracking table for weekly/manual discovery runs
create table if not exists public.collaboration_scrape_runs (
  id uuid primary key default gen_random_uuid(),
  trigger_source text not null default 'manual'
    check (trigger_source in ('cron', 'manual', 'api')),
  status text not null default 'running'
    check (status in ('running', 'completed', 'partial', 'failed')),
  target_count integer not null default 20
    check (target_count > 0),
  rotation_week integer not null default 1,
  queries_executed jsonb not null default '[]'::jsonb,
  candidates_found integer not null default 0,
  leads_inserted integer not null default 0,
  leads_skipped_duplicate integer not null default 0,
  leads_skipped_no_email integer not null default 0,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

comment on table public.collaboration_scrape_runs is
  'Execution log for each weekly or manual invocation of the find-collaborators Edge Function.';

-- 2. Main potential collaborators table
create table if not exists public.collaboration_leads (
  id uuid primary key default gen_random_uuid(),

  -- Core required fields
  brand_name text not null,
  brand_name_normalized text generated always as (
    lower(regexp_replace(trim(brand_name), '\s+', ' ', 'g'))
  ) stored,
  brand_type text not null default 'podcast'
    check (
      brand_type in (
        'podcast',
        'youtube_channel',
        'media_company',
        'social_media_brand',
        'influencer_network',
        'event_host',
        'other'
      )
    ),
  poc_name text not null,
  poc_role text not null,
  email text not null,
  email_normalized text generated always as (lower(trim(email))) stored,

  -- Verification & sourcing metadata
  email_source text not null default 'openai_web_search'
    check (
      email_source in (
        'rss_feed',
        'website_scrape',
        'openai_web_search',
        'manual'
      )
    ),
  email_verified_on_source boolean not null default false,
  website_url text,
  rss_feed_url text,
  source_url text,

  -- Platform presence (facebook, linkedin, instagram, youtube, podcast, tiktok, etc.)
  platforms text[] not null default '{}',
  platform_urls jsonb not null default '{}'::jsonb,

  -- Targeting & outreach metadata
  region text,
  niche text,
  audience_notes text,
  outreach_status text not null default 'new'
    check (
      outreach_status in (
        'new',
        'reviewing',
        'approved',
        'contacted',
        'replied',
        'collaborated',
        'rejected',
        'do_not_contact'
      )
    ),

  -- Lineage & timestamps
  run_id uuid references public.collaboration_scrape_runs (id) on delete set null,
  discovered_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Basic email sanity check
  constraint collaboration_leads_email_format_chk
    check (email ~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$')
);

comment on table public.collaboration_leads is
  'Potential podcast, influencer, media company, and social-media collaboration leads for James Castrission / My Adventure Group.';

-- Deduplication & lookup indexes
create unique index if not exists collaboration_leads_brand_name_norm_uidx
  on public.collaboration_leads (brand_name_normalized);

create index if not exists collaboration_leads_email_norm_idx
  on public.collaboration_leads (email_normalized);

create index if not exists collaboration_leads_outreach_status_idx
  on public.collaboration_leads (outreach_status);

create index if not exists collaboration_leads_discovered_at_idx
  on public.collaboration_leads (discovered_at desc);

create index if not exists collaboration_leads_platforms_gin_idx
  on public.collaboration_leads using gin (platforms);

-- Auto-maintain updated_at
create or replace function public.set_collaboration_leads_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_collaboration_leads_updated_at on public.collaboration_leads;
create trigger trg_collaboration_leads_updated_at
  before update on public.collaboration_leads
  for each row
  execute function public.set_collaboration_leads_updated_at();

-- Row Level Security (service_role bypasses RLS; authenticated users can view & manage outreach status)
alter table public.collaboration_leads enable row level security;
alter table public.collaboration_scrape_runs enable row level security;

drop policy if exists "Authenticated users can read collaboration leads" on public.collaboration_leads;
create policy "Authenticated users can read collaboration leads"
  on public.collaboration_leads
  for select
  to authenticated
  using (true);

drop policy if exists "Authenticated users can update collaboration leads" on public.collaboration_leads;
create policy "Authenticated users can update collaboration leads"
  on public.collaboration_leads
  for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "Authenticated users can insert collaboration leads" on public.collaboration_leads;
create policy "Authenticated users can insert collaboration leads"
  on public.collaboration_leads
  for insert
  to authenticated
  with check (true);

drop policy if exists "Authenticated users can read scrape runs" on public.collaboration_scrape_runs;
create policy "Authenticated users can read scrape runs"
  on public.collaboration_scrape_runs
  for select
  to authenticated
  using (true);
