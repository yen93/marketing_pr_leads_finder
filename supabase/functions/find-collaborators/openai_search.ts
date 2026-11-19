import { TARGET_PERSONA_CONTEXT } from "./config.ts";
import type { DiscoveryTrack, RawCollaboratorCandidate } from "./types.ts";

export interface OpenAISearchParams {
  apiKey: string;
  model: string;
  track: DiscoveryTrack;
  desiredCount: number;
  excludeBrandNames: string[];
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

const COLLABORATOR_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["candidates"],
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "brand_name",
          "brand_type",
          "poc_name",
          "poc_role",
          "email",
          "website_url",
          "rss_feed_url",
          "source_url",
          "platforms",
          "platform_urls",
          "region",
          "niche",
          "audience_notes",
        ],
        properties: {
          brand_name: { type: "string" },
          brand_type: {
            type: "string",
            enum: [
              "podcast",
              "youtube_channel",
              "media_company",
              "social_media_brand",
              "influencer_network",
              "event_host",
              "other",
            ],
          },
          poc_name: { type: "string" },
          poc_role: { type: "string" },
          email: { type: "string" },
          website_url: { type: "string" },
          rss_feed_url: { type: "string" },
          source_url: { type: "string" },
          platforms: {
            type: "array",
            items: {
              type: "string",
              enum: [
                "youtube",
                "instagram",
                "linkedin",
                "facebook",
                "podcast",
                "tiktok",
                "x",
              ],
            },
          },
          platform_urls: {
            type: "object",
            additionalProperties: false,
            required: ["youtube", "instagram", "linkedin", "facebook", "podcast"],
            properties: {
              youtube: { type: "string" },
              instagram: { type: "string" },
              linkedin: { type: "string" },
              facebook: { type: "string" },
              podcast: { type: "string" },
            },
          },
          region: { type: "string" },
          niche: { type: "string" },
          audience_notes: { type: "string" },
        },
      },
    },
  },
} as const;

interface OpenAIResponsesPayload {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  error?: {
    message?: string;
  };
}

export function extractTextFromResponsesApi(
  payload: OpenAIResponsesPayload,
): string {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  // Prefer the final assistant message block rather than concatenating multiple blocks
  const messages = (payload.output ?? []).filter(
    (item) => item.type === "message" && Array.isArray(item.content),
  );
  for (let i = messages.length - 1; i >= 0; i--) {
    const parts: string[] = [];
    for (const contentItem of messages[i].content ?? []) {
      if (
        (contentItem.type === "output_text" || contentItem.type === "text") &&
        typeof contentItem.text === "string"
      ) {
        parts.push(contentItem.text);
      }
    }
    const joined = parts.join("").trim();
    if (joined) return joined;
  }
  return "";
}

/**
 * Parses {"candidates": [...]} JSON safely. If an upstream response was truncated
 * mid-array, salvages all complete top-level candidate objects already emitted.
 */
export function parseCandidatesJson(
  rawText: string,
): RawCollaboratorCandidate[] {
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    const parsed = JSON.parse(cleaned) as {
      candidates?: RawCollaboratorCandidate[];
    };
    return Array.isArray(parsed.candidates) ? parsed.candidates : [];
  } catch {
    // Salvage complete objects inside `"candidates":[ ...` if truncated mid-stream
    const arrayStart = cleaned.search(/"candidates"\s*:\s*\[/);
    if (arrayStart === -1) {
      throw new Error(`Invalid JSON from OpenAI: ${cleaned.slice(0, 200)}`);
    }
    const bracketPos = cleaned.indexOf("[", arrayStart);
    const salvaged: RawCollaboratorCandidate[] = [];

    let depth = 0;
    let inString = false;
    let escaped = false;
    let objStart = -1;

    for (let i = bracketPos + 1; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
      } else if (ch === "{") {
        if (depth === 0) objStart = i;
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0 && objStart !== -1) {
          const slice = cleaned.slice(objStart, i + 1);
          try {
            const obj = JSON.parse(slice) as RawCollaboratorCandidate;
            if (obj && typeof obj.brand_name === "string" && obj.brand_name.trim()) {
              salvaged.push(obj);
            }
          } catch {
            // Skip malformed object
          }
          objStart = -1;
        }
      }
    }

    if (salvaged.length > 0) return salvaged;
    throw new Error(`Unterminated or unparseable JSON from OpenAI (len=${cleaned.length})`);
  }
}

export function buildDiscoveryPrompt(
  track: DiscoveryTrack,
  desiredCount: number,
  excludeBrandNames: string[],
): string {
  const cappedExclusions = excludeBrandNames.slice(0, 150);
  const exclusionBlock =
    cappedExclusions.length > 0
      ? `DO NOT include any of these already-found or excluded brands:\n- ${cappedExclusions.join("\n- ")}`
      : "";

  return [
    TARGET_PERSONA_CONTEXT,
    "",
    `DISCOVERY TRACK: ${track.label}`,
    `REGION FOCUS: ${track.regionFocus}`,
    `NICHE: ${track.niche}`,
    `TARGET PLATFORMS: ${track.primaryPlatforms.join(", ")}`,
    `SEARCH BRIEF: ${track.searchFocus}`,
    "",
    `TASK: Use live web search to find ${desiredCount} REAL, currently active potential collaborators matching this discovery track.`,
    "",
    "STRICT DATA QUALITY RULES:",
    "1. Every candidate must be a real, verifiable podcast, YouTube channel, media company, social-media team, or host with an active social presence.",
    "2. POC RULE: Find the actual NAMED person (first + last name) who runs or books the show/brand — such as Host, Founder, Executive Producer, Managing Director, or Head of Partnerships. Only use a generic team name if no individual is publicly named.",
    "3. CRITICAL EMAIL RULE: NEVER invent, guess, or default to generic emails like info@domain.com or contact@domain.com. Only fill `email` if that EXACT email address literally appeared in a web search result. If you did not see a literal email address in search results, set `email` to \"\" and MUST provide the official `website_url` and/or Apple Podcasts / `rss_feed_url` so our scraper extracts the real email directly.",
    "4. Always provide the real official `website_url` and `source_url` where you verified the brand/contact, plus real social URLs in `platform_urls` (use \"\" for platforms not found). Keep `audience_notes` concise (1 short sentence, max 120 characters).",
    "5. Prefer shows and media companies that actively invite guests, co-hosts, speakers, or brand collaborations.",
    exclusionBlock,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function searchCollaboratorsWithOpenAI(
  params: OpenAISearchParams,
): Promise<RawCollaboratorCandidate[]> {
  const fetchFn = params.fetchFn ?? fetch;
  const timeoutMs = params.timeoutMs ?? 45_000;

  const prompt = buildDiscoveryPrompt(
    params.track,
    params.desiredCount,
    params.excludeBrandNames,
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchFn("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: params.model,
        max_output_tokens: 4500,
        input: [
          {
            role: "system",
            content:
              "You are a precision media & PR lead researcher. Use web search to find real, active podcasts, YouTube channels, influencer collectives, and social media companies with named POC details and official websites. Never fabricate email addresses.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        tools: [{ type: "web_search" }],
        text: {
          format: {
            type: "json_schema",
            name: "collaborator_candidates",
            strict: true,
            schema: COLLABORATOR_JSON_SCHEMA,
          },
        },
      }),
    });

    const rawBody = await response.text();
    let payload: OpenAIResponsesPayload;
    try {
      payload = JSON.parse(rawBody) as OpenAIResponsesPayload;
    } catch {
      throw new Error(
        `OpenAI returned non-JSON response (HTTP ${response.status}): ${rawBody.slice(0, 300)}`,
      );
    }

    if (!response.ok) {
      const msg = payload.error?.message || rawBody.slice(0, 300);
      throw new Error(`OpenAI API error (HTTP ${response.status}): ${msg}`);
    }

    const outputText = extractTextFromResponsesApi(payload);
    if (!outputText) {
      throw new Error("OpenAI Responses API returned empty output_text.");
    }

    return parseCandidatesJson(outputText);
  } finally {
    clearTimeout(timer);
  }
}
