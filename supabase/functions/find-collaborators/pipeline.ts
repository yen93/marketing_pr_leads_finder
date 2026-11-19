import { DEFAULT_EXCLUDED_BRANDS, selectTracksForRun } from "./config.ts";
import {
  type OpenAISearchParams,
  searchCollaboratorsWithOpenAI,
} from "./openai_search.ts";
import { type EnrichOptions, enrichCandidateContact } from "./scraper.ts";
import type {
  EnrichedCollaboratorLead,
  QueryExecutionLog,
  RawCollaboratorCandidate,
} from "./types.ts";
import {
  brandSlug,
  mapWithConcurrency,
  normalizeBrandName,
  normalizeEmail,
} from "./utils.ts";

export interface PipelineInput {
  openaiApiKey: string;
  openaiModel: string;
  targetCount: number;
  rotationWeek: number;
  maxBatches: number;
  requireVerifiedEmail: boolean;
  existingBrandNames: string[];
  existingEmails: string[];
  wallClockBudgetMs?: number;
  enrichmentConcurrency?: number;
  searchFn?: (params: OpenAISearchParams) => Promise<RawCollaboratorCandidate[]>;
  enrichFn?: (
    candidate: RawCollaboratorCandidate,
    options?: EnrichOptions,
  ) => Promise<EnrichedCollaboratorLead | null>;
}

export interface PipelineResult {
  leads: EnrichedCollaboratorLead[];
  candidatesFound: number;
  skippedDuplicate: number;
  skippedNoEmail: number;
  verifiedEmailCount: number;
  queriesExecuted: QueryExecutionLog[];
  elapsedMs: number;
}

export async function runDiscoveryPipeline(
  input: PipelineInput,
): Promise<PipelineResult> {
  const startedAt = Date.now();
  const wallClockBudgetMs = input.wallClockBudgetMs ?? 115_000;
  const enrichmentConcurrency = input.enrichmentConcurrency ?? 5;
  const searchFn = input.searchFn ?? searchCollaboratorsWithOpenAI;
  const enrichFn = input.enrichFn ?? enrichCandidateContact;

  // Build deduplication & exclusion sets
  const seenBrandNormalized = new Set<string>();
  const seenBrandSlugs = new Set<string>();
  const seenEmails = new Set<string>();
  const promptExcludeList: string[] = [];

  function registerExcludedBrand(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    seenBrandNormalized.add(normalizeBrandName(trimmed));
    const slug = brandSlug(trimmed);
    if (slug) seenBrandSlugs.add(slug);
    promptExcludeList.push(trimmed);
  }

  for (const name of DEFAULT_EXCLUDED_BRANDS) registerExcludedBrand(name);
  for (const name of input.existingBrandNames) registerExcludedBrand(name);
  for (const email of input.existingEmails) {
    const norm = normalizeEmail(email);
    if (norm) seenEmails.add(norm);
  }

  const tracks = selectTracksForRun(input.rotationWeek, input.maxBatches);
  const collectedLeads: EnrichedCollaboratorLead[] = [];
  const queriesExecuted: QueryExecutionLog[] = [];

  let candidatesFound = 0;
  let skippedDuplicate = 0;
  let skippedNoEmail = 0;
  let verifiedEmailCount = 0;

  for (const track of tracks) {
    if (collectedLeads.length >= input.targetCount) break;
    if (Date.now() - startedAt >= wallClockBudgetMs) break;

    const remaining = input.targetCount - collectedLeads.length;
    // Keep per-call batch size compact (6-8) so OpenAI Responses API structured JSON never truncates
    const desiredCount = Math.min(8, Math.max(6, remaining + 2));

    const logEntry: QueryExecutionLog = {
      track_id: track.id,
      track_label: track.label,
      candidates_returned: 0,
      qualified_added: 0,
      skipped_duplicate: 0,
      skipped_no_email: 0,
    };

    let rawCandidates: RawCollaboratorCandidate[];
    try {
      rawCandidates = await searchFn({
        apiKey: input.openaiApiKey,
        model: input.openaiModel,
        track,
        desiredCount,
        excludeBrandNames: promptExcludeList,
      });
    } catch (err) {
      logEntry.error = err instanceof Error ? err.message : String(err);
      queriesExecuted.push(logEntry);
      continue;
    }

    logEntry.candidates_returned = rawCandidates.length;
    candidatesFound += rawCandidates.length;

    // Pre-filter duplicate/excluded brands before running website & RSS scraping
    const freshCandidates: RawCollaboratorCandidate[] = [];
    const batchSeenSlugs = new Set<string>();

    for (const candidate of rawCandidates) {
      const name = candidate.brand_name?.trim();
      if (!name) continue;
      const normName = normalizeBrandName(name);
      const slug = brandSlug(name);

      if (
        seenBrandNormalized.has(normName) ||
        (slug && seenBrandSlugs.has(slug)) ||
        (slug && batchSeenSlugs.has(slug))
      ) {
        skippedDuplicate++;
        logEntry.skipped_duplicate++;
        continue;
      }

      if (slug) batchSeenSlugs.add(slug);
      freshCandidates.push(candidate);
    }

    // Enrich & verify contacts in bounded parallel batches
    const enrichedResults = await mapWithConcurrency(
      freshCandidates,
      enrichmentConcurrency,
      (candidate) =>
        enrichFn(candidate, {
          requireVerifiedEmail: input.requireVerifiedEmail,
        }),
    );

    for (const lead of enrichedResults) {
      if (!lead) {
        skippedNoEmail++;
        logEntry.skipped_no_email++;
        continue;
      }

      const normBrand = normalizeBrandName(lead.brand_name);
      const slug = brandSlug(lead.brand_name);
      const normEmail = lead.email ? normalizeEmail(lead.email) : null;

      if (
        seenBrandNormalized.has(normBrand) ||
        (slug && seenBrandSlugs.has(slug)) ||
        (normEmail && seenEmails.has(normEmail))
      ) {
        skippedDuplicate++;
        logEntry.skipped_duplicate++;
        continue;
      }

      seenBrandNormalized.add(normBrand);
      if (slug) seenBrandSlugs.add(slug);
      if (normEmail) seenEmails.add(normEmail);
      promptExcludeList.unshift(lead.brand_name);

      collectedLeads.push(lead);
      logEntry.qualified_added++;
      if (lead.email_verified_on_source) {
        verifiedEmailCount++;
      }
    }

    queriesExecuted.push(logEntry);
  }

  return {
    leads: collectedLeads,
    candidatesFound,
    skippedDuplicate,
    skippedNoEmail,
    verifiedEmailCount,
    queriesExecuted,
    elapsedMs: Date.now() - startedAt,
  };
}
