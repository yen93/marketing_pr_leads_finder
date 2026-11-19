# Marketing & PR Collaboration Leads Finder

Automated weekly collaborator discovery pipeline for **James Castrission / My Adventure Group**, built on **Supabase (Postgres + Edge Functions + `pg_cron` + `pg_net`)** using **OpenAI Web Search + direct website & podcast RSS scraping**.

## How It Works

1. **Weekly Trigger (`pg_cron` + `pg_net`)**: Every week (Monday 09:00 AEST / Sunday 23:00 UTC), Postgres invokes the `find-collaborators` Supabase Edge Function via `public.invoke_find_collaborators(20, 'cron')`.
2. **Rotating Discovery Tracks (`config.ts`)**: Cycles through 16 tailored AU/NZ + Global English discovery tracks (founder & leadership podcasts, adventure/resilience YouTube channels, BuzzFeed-style social media studios, HR/team-culture shows, LinkedIn B2B video series, podcast networks, etc.) so consecutive weeks consistently yield fresh leads.
3. **Candidate Discovery (`openai_search.ts`)**: Calls the OpenAI Responses API (`web_search` tool + strict `json_schema` output) while excluding brands already in `collaboration_leads` and already-collaborated brands (such as `Agency Podcast` / `agencypodcast`).
4. **Direct Email & Contact Verification (`scraper.ts`)**:
   - **Podcast RSS feeds**: Looks up official podcast RSS feeds (including via the free Apple iTunes Search API) and extracts `<itunes:owner>` / `<managingEditor>` producer & host emails directly.
   - **Official websites & contact pages**: Scrapes each brand's homepage, JSON-LD metadata, and `/contact`, `/about`, `/work-with-us` pages for real outreach emails and social profile links (`youtube`, `instagram`, `linkedin`, `facebook`, `tiktok`).
   - Ranks multiple discovered emails to prefer `bookings@`, `guests@`, `podcast@`, `partnerships@`, `collabs@`, or POC-name addresses on the brand's own domain while filtering `noreply@`, `privacy@`, and tracking/asset addresses.
5. **Persistence & Audit Logging**: Inserts at least **20 new deduplicated leads per run** into `public.collaboration_leads` and records run metrics in `public.collaboration_scrape_runs`.

---

## Project Structure

```text
├── .env.example
├── package.json
├── prompts/
│   └── 191126_find_collaborations.txt
└── supabase/
    ├── config.toml
    ├── migrations/
    │   ├── 20261119000001_create_collaboration_leads.sql
    │   ├── 20261119000002_schedule_weekly_collaboration_finder.sql
    │   └── 20261119000003_allow_nullable_unverified_email.sql
    └── functions/
        └── find-collaborators/
            ├── deno.json
            ├── index.ts          # Edge Function HTTP entrypoint
            ├── pipeline.ts       # Multi-batch orchestration & deduplication
            ├── openai_search.ts  # OpenAI Responses API + web_search client
            ├── scraper.ts        # Podcast RSS (iTunes) + website/contact scraper
            ├── config.ts         # Persona context, exclusions & 16 rotating tracks
            ├── utils.ts          # Email scoring, extraction, normalization, SSRF/auth helpers
            ├── types.ts          # TypeScript interfaces
            └── __tests__/
                └── pipeline.test.ts
```

---

## Database Schema

### `public.collaboration_leads`
Stores every discovered potential collaborator with:
- `brand_name`, `brand_name_normalized` (unique deduplication key), `brand_type`
- `poc_name`, `poc_role`, `email` (nullable — **only populated when 100% verified directly on official RSS feed or brand website**; otherwise `NULL`), `email_normalized`
- `email_source` (`rss_feed` | `website_scrape` | `manual` | `NULL`)
- `email_verified_on_source` (`boolean` — `true` whenever a verified email is saved, `false` when saved POC-only)
- `website_url`, `rss_feed_url`, `source_url`
- `platforms` (`text[]`), `platform_urls` (`jsonb`)
- `region`, `niche`, `audience_notes`, `outreach_status`, `run_id`, `discovered_at`

### `public.collaboration_scrape_runs`
Audit log of every weekly or manual execution (`trigger_source`, `status`, `target_count`, `rotation_week`, `candidates_found`, `leads_inserted`, `leads_skipped_duplicate`, `leads_skipped_no_email`, `queries_executed`, `error_message`).

---

## Deployment & Setup

### 1. Link your Supabase project & push migrations
```bash
supabase login
supabase link --project-ref <YOUR_PROJECT_REF>
supabase db push
```

### 2. Set Edge Function secrets
Generate a strong random `CRON_SECRET` and set secrets on Supabase:
```bash
supabase secrets set OPENAI_API_KEY="sk-..."
supabase secrets set CRON_SECRET="<STRONG_RANDOM_CRON_SECRET>"
# Optional: override model (defaults to gpt-4.1-mini; gpt-4.1 or gpt-5 also work)
supabase secrets set OPENAI_MODEL="gpt-4.1-mini"
```

### 3. Deploy the Edge Function
```bash
supabase functions deploy find-collaborators --no-verify-jwt
```
*(The function validates either `x-cron-secret` matching `CRON_SECRET` or `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` using constant-time comparison.)*

### 4. Configure Vault secrets for weekly `pg_cron` automation
Run this once in the **Supabase SQL Editor**:
```sql
select vault.create_secret('https://<YOUR_PROJECT_REF>.supabase.co', 'project_url');
select vault.create_secret('<STRONG_RANDOM_CRON_SECRET>', 'find_collaborators_cron_secret');
```

Verify the weekly cron job is registered:
```sql
select jobid, jobname, schedule, command, active
from cron.job
where jobname = 'weekly-find-collaborators';
```

---

## Testing & Manual Triggers

### Run unit tests locally (Node 22+)
```bash
npm test
```

### Dry-run test via HTTP (does not write to DB)
```bash
curl -X POST "https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/find-collaborators" \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: <STRONG_RANDOM_CRON_SECRET>" \
  -d '{
    "target_count": 5,
    "dry_run": true,
    "trigger_source": "manual"
  }'
```

### Run a live batch manually (20+ leads)
```bash
curl -X POST "https://<YOUR_PROJECT_REF>.supabase.co/functions/v1/find-collaborators" \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: <STRONG_RANDOM_CRON_SECRET>" \
  -d '{
    "target_count": 20,
    "trigger_source": "manual"
  }'
```

Or trigger directly from SQL Editor:
```sql
select public.invoke_find_collaborators(20, 'manual');
```

### Request body options
| Field | Default | Description |
| --- | --- | --- |
| `target_count` | `20` | Minimum number of new leads to collect (1–100) |
| `trigger_source` | `"manual"` | `"cron"`, `"manual"`, or `"api"` |
| `dry_run` | `false` | If `true`, returns found leads in response JSON without writing to Postgres |
| `require_verified_email` | `false` | If `true`, keeps only leads whose email was directly confirmed on RSS feed or official website |
| `max_batches` | `5` | Max discovery tracks to query in one run (1–10) |
| `rotation_week` | auto | Overrides the weekly track rotation counter |
