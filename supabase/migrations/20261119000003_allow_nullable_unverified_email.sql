-- Migration: Allow NULL email when no 100% verified email is found on source
-- Purpose: Only store email addresses directly verified from official RSS feeds or
--          scraped brand websites. Unverified leads are still saved with brand_name,
--          poc_name, and poc_role, with email = NULL for later enrichment/outreach.

alter table public.collaboration_leads
  alter column email drop not null,
  alter column email_source drop not null,
  alter column email_source drop default;

alter table public.collaboration_leads
  drop constraint if exists collaboration_leads_email_format_chk,
  add constraint collaboration_leads_email_format_chk
    check (email is null or email ~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$');

alter table public.collaboration_leads
  drop constraint if exists collaboration_leads_email_source_check,
  add constraint collaboration_leads_email_source_check
    check (
      email_source is null
      or email_source in ('rss_feed', 'website_scrape', 'openai_web_search', 'manual')
    );

alter table public.collaboration_leads
  drop constraint if exists collaboration_leads_verified_email_consistency_chk,
  add constraint collaboration_leads_verified_email_consistency_chk
    check (
      (email is null and email_verified_on_source = false and email_source is null)
      or (email is not null)
    );

alter table public.collaboration_scrape_runs
  add column if not exists leads_with_verified_email integer not null default 0;
