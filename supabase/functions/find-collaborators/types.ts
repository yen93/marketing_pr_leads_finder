export type BrandType =
  | "podcast"
  | "youtube_channel"
  | "media_company"
  | "social_media_brand"
  | "influencer_network"
  | "event_host"
  | "other";

export type EmailSource =
  | "rss_feed"
  | "website_scrape"
  | "openai_web_search"
  | "manual";

export type TriggerSource = "cron" | "manual" | "api";

export type PlatformName =
  | "youtube"
  | "instagram"
  | "linkedin"
  | "facebook"
  | "podcast"
  | "tiktok"
  | "x";

export interface PlatformUrls {
  youtube?: string;
  instagram?: string;
  linkedin?: string;
  facebook?: string;
  podcast?: string;
  tiktok?: string;
  x?: string;
}

export interface DiscoveryTrack {
  id: string;
  label: string;
  regionFocus: "AU/NZ" | "Global" | "AU/NZ + Global";
  niche: string;
  primaryPlatforms: PlatformName[];
  searchFocus: string;
}

export interface RawCollaboratorCandidate {
  brand_name: string;
  brand_type: string;
  poc_name: string;
  poc_role: string;
  email: string;
  website_url: string;
  rss_feed_url: string;
  source_url: string;
  platforms: string[];
  platform_urls: PlatformUrls;
  region: string;
  niche: string;
  audience_notes: string;
}

export interface EnrichedCollaboratorLead {
  brand_name: string;
  brand_type: BrandType;
  poc_name: string;
  poc_role: string;
  email: string | null;
  email_source: EmailSource | null;
  email_verified_on_source: boolean;
  website_url: string | null;
  rss_feed_url: string | null;
  source_url: string | null;
  platforms: PlatformName[];
  platform_urls: PlatformUrls;
  region: string | null;
  niche: string | null;
  audience_notes: string | null;
}

export interface RunRequestOptions {
  target_count?: number;
  trigger_source?: TriggerSource;
  dry_run?: boolean;
  require_verified_email?: boolean;
  max_batches?: number;
  rotation_week?: number;
}

export interface QueryExecutionLog {
  track_id: string;
  track_label: string;
  candidates_returned: number;
  qualified_added: number;
  skipped_duplicate: number;
  skipped_no_email: number;
  error?: string;
}

export interface RunSummary {
  run_id: string | null;
  status: "completed" | "partial" | "failed" | "dry_run";
  target_count: number;
  rotation_week: number;
  candidates_found: number;
  leads_qualified: number;
  leads_inserted: number;
  leads_skipped_duplicate: number;
  leads_skipped_no_email: number;
  verified_email_count: number;
  elapsed_ms: number;
  queries_executed: QueryExecutionLog[];
  leads?: EnrichedCollaboratorLead[];
}
