import { createClient } from "@supabase/supabase-js";
import { runDiscoveryPipeline } from "./pipeline.ts";
import type {
  RunRequestOptions,
  RunSummary,
  TriggerSource,
} from "./types.ts";
import { constantTimeEqual } from "./utils.ts";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
    },
  });
}

function isAuthorized(
  req: Request,
  cronSecret: string | undefined,
  serviceRoleKey: string | undefined,
): boolean {
  const headerCronSecret = req.headers.get("x-cron-secret")?.trim();
  if (
    cronSecret &&
    headerCronSecret &&
    constantTimeEqual(headerCronSecret, cronSecret)
  ) {
    return true;
  }

  const authHeader = req.headers.get("authorization")?.trim();
  if (serviceRoleKey && authHeader?.toLowerCase().startsWith("bearer ")) {
    const token = authHeader.slice(7).trim();
    if (token && constantTimeEqual(token, serviceRoleKey)) {
      return true;
    }
  }

  return false;
}

function clampInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(num)));
}

function parseTriggerSource(value: unknown): TriggerSource {
  if (value === "cron" || value === "manual" || value === "api") {
    return value;
  }
  return "manual";
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed. Use POST." }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const cronSecret = Deno.env.get("CRON_SECRET");
  const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
  const openaiModel = Deno.env.get("OPENAI_MODEL") || "gpt-4.1-mini";

  if (!isAuthorized(req, cronSecret, serviceRoleKey)) {
    return jsonResponse(
      {
        error:
          "Unauthorized. Provide a valid x-cron-secret header or SUPABASE_SERVICE_ROLE_KEY Bearer token.",
      },
      401,
    );
  }

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse(
      { error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable." },
      500,
    );
  }

  if (!openaiApiKey) {
    return jsonResponse(
      { error: "Missing OPENAI_API_KEY secret. Configure it with `supabase secrets set OPENAI_API_KEY=...`." },
      500,
    );
  }

  let body: RunRequestOptions = {};
  try {
    const rawText = await req.text();
    if (rawText.trim()) {
      body = JSON.parse(rawText) as RunRequestOptions;
    }
  } catch {
    return jsonResponse({ error: "Invalid JSON request body." }, 400);
  }

  const targetCount = clampInt(body.target_count, 20, 1, 100);
  const maxBatches = clampInt(body.max_batches, 6, 1, 10);
  const triggerSource = parseTriggerSource(body.trigger_source);
  const dryRun = body.dry_run === true;
  const requireVerifiedEmail = body.require_verified_email === true;

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let runId: string | null = null;

  try {
    // 1. Load existing leads for cross-week deduplication
    const { data: existingLeads, error: leadsErr } = await supabase
      .from("collaboration_leads")
      .select("brand_name, email_normalized")
      .order("discovered_at", { ascending: false })
      .limit(5000);

    if (leadsErr) {
      throw new Error(`Failed loading existing leads: ${leadsErr.message}`);
    }

    const existingBrandNames = (existingLeads ?? [])
      .map((row) => row.brand_name)
      .filter((v): v is string => typeof v === "string" && v.length > 0);
    const existingEmails = (existingLeads ?? [])
      .map((row) => row.email_normalized)
      .filter((v): v is string => typeof v === "string" && v.length > 0);

    // 2. Determine weekly rotation counter
    let rotationWeek: number;
    if (body.rotation_week !== undefined) {
      rotationWeek = clampInt(body.rotation_week, 1, 1, 10000);
    } else {
      const { count: priorRunsCount, error: countErr } = await supabase
        .from("collaboration_scrape_runs")
        .select("id", { count: "exact", head: true });
      if (countErr) {
        throw new Error(`Failed counting prior runs: ${countErr.message}`);
      }
      rotationWeek = (priorRunsCount ?? 0) + 1;
    }

    // 3. Create audit run log row (unless dry_run)
    if (!dryRun) {
      const { data: runRow, error: runInsertErr } = await supabase
        .from("collaboration_scrape_runs")
        .insert({
          trigger_source: triggerSource,
          status: "running",
          target_count: targetCount,
          rotation_week: rotationWeek,
        })
        .select("id")
        .single();

      if (runInsertErr) {
        throw new Error(`Failed creating scrape run record: ${runInsertErr.message}`);
      }
      runId = runRow.id;
    }

    // 4. Execute OpenAI Web Search + RSS/Website Scraping discovery pipeline
    const pipelineResult = await runDiscoveryPipeline({
      openaiApiKey,
      openaiModel,
      targetCount,
      rotationWeek,
      maxBatches,
      requireVerifiedEmail,
      existingBrandNames,
      existingEmails,
    });

    if (dryRun) {
      const drySummary: RunSummary = {
        run_id: null,
        status: "dry_run",
        target_count: targetCount,
        rotation_week: rotationWeek,
        candidates_found: pipelineResult.candidatesFound,
        leads_qualified: pipelineResult.leads.length,
        leads_inserted: 0,
        leads_skipped_duplicate: pipelineResult.skippedDuplicate,
        leads_skipped_no_email: pipelineResult.skippedNoEmail,
        verified_email_count: pipelineResult.verifiedEmailCount,
        elapsed_ms: pipelineResult.elapsedMs,
        queries_executed: pipelineResult.queriesExecuted,
        leads: pipelineResult.leads,
      };
      return jsonResponse(drySummary, 200);
    }

    // 5. Persist qualified leads idempotently
    let leadsInserted = 0;
    if (pipelineResult.leads.length > 0) {
      const rowsToInsert = pipelineResult.leads.map((lead) => ({
        brand_name: lead.brand_name,
        brand_type: lead.brand_type,
        poc_name: lead.poc_name,
        poc_role: lead.poc_role,
        email: lead.email,
        email_source: lead.email_source,
        email_verified_on_source: lead.email_verified_on_source,
        website_url: lead.website_url,
        rss_feed_url: lead.rss_feed_url,
        source_url: lead.source_url,
        platforms: lead.platforms,
        platform_urls: lead.platform_urls,
        region: lead.region,
        niche: lead.niche,
        audience_notes: lead.audience_notes,
        run_id: runId,
      }));

      const { data: insertedRows, error: insertErr } = await supabase
        .from("collaboration_leads")
        .upsert(rowsToInsert, {
          onConflict: "brand_name_normalized",
          ignoreDuplicates: true,
        })
        .select("id");

      if (insertErr) {
        throw new Error(`Failed inserting collaboration leads: ${insertErr.message}`);
      }

      leadsInserted = insertedRows?.length ?? 0;
    }

    const finalStatus: "completed" | "partial" | "failed" =
      leadsInserted >= targetCount
        ? "completed"
        : leadsInserted > 0
          ? "partial"
          : "failed";

    const errorMessage =
      finalStatus === "failed"
        ? "No new qualified collaboration leads were inserted during this run."
        : null;

    // 6. Finalize scrape run log
    if (runId) {
      await supabase
        .from("collaboration_scrape_runs")
        .update({
          status: finalStatus,
          queries_executed: pipelineResult.queriesExecuted,
          candidates_found: pipelineResult.candidatesFound,
          leads_inserted: leadsInserted,
          leads_with_verified_email: pipelineResult.verifiedEmailCount,
          leads_skipped_duplicate: pipelineResult.skippedDuplicate,
          leads_skipped_no_email: pipelineResult.skippedNoEmail,
          error_message: errorMessage,
          completed_at: new Date().toISOString(),
        })
        .eq("id", runId);
    }

    const summary: RunSummary = {
      run_id: runId,
      status: finalStatus,
      target_count: targetCount,
      rotation_week: rotationWeek,
      candidates_found: pipelineResult.candidatesFound,
      leads_qualified: pipelineResult.leads.length,
      leads_inserted: leadsInserted,
      leads_skipped_duplicate: pipelineResult.skippedDuplicate,
      leads_skipped_no_email: pipelineResult.skippedNoEmail,
      verified_email_count: pipelineResult.verifiedEmailCount,
      elapsed_ms: pipelineResult.elapsedMs,
      queries_executed: pipelineResult.queriesExecuted,
    };

    return jsonResponse(summary, 200);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (runId) {
      await supabase
        .from("collaboration_scrape_runs")
        .update({
          status: "failed",
          error_message: message,
          completed_at: new Date().toISOString(),
        })
        .eq("id", runId);
    }

    return jsonResponse({ run_id: runId, status: "failed", error: message }, 500);
  }
});
