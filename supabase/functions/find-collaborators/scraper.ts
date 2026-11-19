import type {
  EmailSource,
  EnrichedCollaboratorLead,
  PlatformUrls,
  RawCollaboratorCandidate,
} from "./types.ts";
import {
  brandSlug,
  decodeBasicHtmlEntities,
  extractEmailsFromText,
  extractSocialLinksFromHtml,
  isValidOutreachEmail,
  mergePlatforms,
  normalizeBrandType,
  normalizeEmail,
  normalizeUrl,
  pickBestEmail,
  sanitizePlatformUrls,
} from "./utils.ts";

const USER_AGENT =
  "Mozilla/5.0 (compatible; MyAdventureGroupCollabFinder/1.0; +https://myadventuregroup.com.au)";
const MAX_RESPONSE_CHARS = 350_000;
const DEFAULT_FETCH_TIMEOUT_MS = 6_000;

/**
 * Third-party directory/social hosts whose HTML pages should NOT be scraped for
 * generic contact emails (to avoid accidentally picking up directory footer emails).
 */
const DIRECTORY_OR_SOCIAL_HOSTS = new Set([
  "podcasts.apple.com",
  "open.spotify.com",
  "spotify.com",
  "podtail.com",
  "listennotes.com",
  "podchaser.com",
  "podbay.fm",
  "player.fm",
  "chartable.com",
  "stitcher.com",
  "iheart.com",
  "audible.com",
  "audible.com.au",
  "youtube.com",
  "youtu.be",
  "instagram.com",
  "linkedin.com",
  "facebook.com",
  "tiktok.com",
  "twitter.com",
  "x.com",
]);

export function isDirectoryOrSocialUrl(rawUrl: string | null | undefined): boolean {
  if (!rawUrl) return false;
  try {
    const host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, "");
    if (DIRECTORY_OR_SOCIAL_HOSTS.has(host)) return true;
    for (const blocked of DIRECTORY_OR_SOCIAL_HOSTS) {
      if (host.endsWith(`.${blocked}`)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export interface RssContactResult {
  emails: string[];
  ownerName: string | null;
  authorName: string | null;
  websiteUrl: string | null;
}

export interface JsonLdContactResult {
  emails: string[];
  pocName: string | null;
  pocRole: string | null;
}

export interface EnrichOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  requireVerifiedEmail?: boolean;
}

/**
 * Basic SSRF guard: only allow public HTTP(S) hosts.
 */
export function isSafePublicUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    const host = parsed.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "0.0.0.0" ||
      host === "::1" ||
      host.endsWith(".local") ||
      host.endsWith(".internal")
    ) {
      return false;
    }
    // Block private IPv4 ranges
    const ipv4Match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4Match) {
      const [a, b] = [Number(ipv4Match[1]), Number(ipv4Match[2])];
      if (
        a === 10 ||
        a === 127 ||
        a === 0 ||
        (a === 169 && b === 254) ||
        (a === 192 && b === 168) ||
        (a === 172 && b >= 16 && b <= 31)
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

async function safeFetchText(
  url: string,
  fetchFn: typeof fetch,
  timeoutMs: number,
  accept = "text/html,application/xhtml+xml,application/xml,text/xml;q=0.9,*/*;q=0.8",
): Promise<{ text: string; finalUrl: string } | null> {
  if (!isSafePublicUrl(url)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: accept,
      },
    });
    if (!res.ok) return null;

    const finalUrl = res.url || url;
    if (!isSafePublicUrl(finalUrl)) return null;

    const text = await res.text();
    return {
      text: text.length > MAX_RESPONSE_CHARS ? text.slice(0, MAX_RESPONSE_CHARS) : text,
      finalUrl,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function stripCdataAndTags(raw: string): string {
  return decodeBasicHtmlEntities(
    raw
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

/**
 * Extracts contact info from a podcast RSS XML feed.
 * Podcast RSS feeds frequently publish real producer/host contact emails in
 * <itunes:owner><itunes:email> and <managingEditor>.
 */
export function parsePodcastRss(xml: string): RssContactResult {
  const emails = new Set<string>();
  let ownerName: string | null = null;
  let authorName: string | null = null;
  let websiteUrl: string | null = null;

  // Focus on the channel header (before the first <item>) to avoid scanning hundreds of episodes
  const firstItemIdx = xml.search(/<item[\s>]/i);
  const channelXml = firstItemIdx > 0 ? xml.slice(0, firstItemIdx) : xml.slice(0, 40_000);

  // 1. <itunes:owner> block
  const ownerBlock = channelXml.match(/<itunes:owner\b[^>]*>([\s\S]*?)<\/itunes:owner>/i);
  if (ownerBlock?.[1]) {
    const emailMatch = ownerBlock[1].match(
      /<itunes:email\b[^>]*>([\s\S]*?)<\/itunes:email>/i,
    );
    if (emailMatch?.[1]) {
      const candidate = normalizeEmail(stripCdataAndTags(emailMatch[1]));
      if (isValidOutreachEmail(candidate)) emails.add(candidate);
    }
    const nameMatch = ownerBlock[1].match(
      /<itunes:name\b[^>]*>([\s\S]*?)<\/itunes:name>/i,
    );
    if (nameMatch?.[1]) {
      const name = stripCdataAndTags(nameMatch[1]);
      if (name && name.length <= 100) ownerName = name;
    }
  }

  // 2. <managingEditor> (often formatted as "email@domain.com (Name)")
  const editorMatch = channelXml.match(
    /<managingEditor\b[^>]*>([\s\S]*?)<\/managingEditor>/i,
  );
  if (editorMatch?.[1]) {
    const editorText = stripCdataAndTags(editorMatch[1]);
    for (const email of extractEmailsFromText(editorText)) {
      emails.add(email);
    }
    const parenName = editorText.match(/\(([^)]+)\)/);
    if (!ownerName && parenName?.[1]?.trim()) {
      ownerName = parenName[1].trim();
    }
  }

  // 3. <itunes:author>
  const authorMatch = channelXml.match(
    /<itunes:author\b[^>]*>([\s\S]*?)<\/itunes:author>/i,
  );
  if (authorMatch?.[1]) {
    const author = stripCdataAndTags(authorMatch[1]);
    if (author && author.length <= 100) authorName = author;
  }

  // 4. Channel <link>
  const linkMatch = channelXml.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i);
  if (linkMatch?.[1]) {
    websiteUrl = normalizeUrl(stripCdataAndTags(linkMatch[1]));
  }

  // 5. Fallback: any valid outreach email in channel <description> / <itunes:summary>
  const descMatch = channelXml.match(
    /<description\b[^>]*>([\s\S]*?)<\/description>/i,
  );
  if (descMatch?.[1]) {
    for (const email of extractEmailsFromText(stripCdataAndTags(descMatch[1]))) {
      emails.add(email);
    }
  }

  return {
    emails: Array.from(emails),
    ownerName,
    authorName,
    websiteUrl,
  };
}

/**
 * Extracts an Apple Podcasts numeric ID from URLs like
 * https://podcasts.apple.com/au/podcast/startup-diaries/id1479491840
 */
export function extractApplePodcastId(
  ...urls: Array<string | null | undefined>
): string | null {
  for (const url of urls) {
    if (!url) continue;
    const match = url.match(/podcasts\.apple\.com\/[^?#]*\/id(\d+)/i);
    if (match?.[1]) return match[1];
  }
  return null;
}

/**
 * Looks up a podcast's exact RSS feed URL via Apple iTunes Lookup API by ID.
 */
export async function lookupPodcastRssByAppleId(
  appleId: string,
  fetchFn: typeof fetch = fetch,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<{ feedUrl: string; artistName: string | null } | null> {
  const url = `https://itunes.apple.com/lookup?id=${encodeURIComponent(appleId)}&entity=podcast`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, {
      method: "GET",
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      results?: Array<{ artistName?: string; feedUrl?: string }>;
    };
    const first = data.results?.[0];
    const normalizedFeed = normalizeUrl(first?.feedUrl);
    if (!normalizedFeed) return null;
    return {
      feedUrl: normalizedFeed,
      artistName: first?.artistName?.trim() || null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Looks up a podcast's official RSS feed via the free Apple iTunes Search API
 * (no API key required). Requires a tight brand name match to avoid unrelated shows.
 */
export async function findPodcastRssViaItunes(
  brandName: string,
  fetchFn: typeof fetch = fetch,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<{ feedUrl: string; artistName: string | null } | null> {
  const query = encodeURIComponent(brandName.trim());
  const url = `https://itunes.apple.com/search?media=podcast&entity=podcast&limit=5&term=${query}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, {
      method: "GET",
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      results?: Array<{
        collectionName?: string;
        trackName?: string;
        artistName?: string;
        feedUrl?: string;
      }>;
    };
    const results = data.results ?? [];
    const targetSlug = brandSlug(brandName);
    if (!targetSlug) return null;

    for (const item of results) {
      if (!item.feedUrl) continue;
      const itemTitle = item.collectionName || item.trackName || "";
      const itemSlug = brandSlug(itemTitle);
      if (!itemSlug) continue;

      // Accept exact slug match or strong containment (e.g., "Diary of a CEO" vs "The Diary Of A CEO with Steven Bartlett")
      const isMatch =
        itemSlug === targetSlug ||
        (targetSlug.length >= 6 && itemSlug.includes(targetSlug)) ||
        (itemSlug.length >= 6 && targetSlug.includes(itemSlug));

      if (isMatch) {
        const normalizedFeed = normalizeUrl(item.feedUrl);
        if (normalizedFeed) {
          return {
            feedUrl: normalizedFeed,
            artistName: item.artistName?.trim() || null,
          };
        }
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extracts emails and optional contact/founder names from JSON-LD <script> blocks.
 */
export function extractJsonLdContacts(html: string): JsonLdContactResult {
  const emails = new Set<string>();
  let pocName: string | null = null;
  let pocRole: string | null = null;

  const scriptRegex =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  function visitNode(node: unknown) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visitNode(item);
      return;
    }

    const obj = node as Record<string, unknown>;
    if (typeof obj.email === "string") {
      const cleaned = normalizeEmail(obj.email.replace(/^mailto:/i, ""));
      if (isValidOutreachEmail(cleaned)) emails.add(cleaned);
    }

    if (obj.contactPoint) {
      const points = Array.isArray(obj.contactPoint)
        ? obj.contactPoint
        : [obj.contactPoint];
      for (const pt of points) {
        if (pt && typeof pt === "object") {
          const p = pt as Record<string, unknown>;
          if (typeof p.email === "string") {
            const cleaned = normalizeEmail(p.email.replace(/^mailto:/i, ""));
            if (isValidOutreachEmail(cleaned)) emails.add(cleaned);
          }
          if (!pocRole && typeof p.contactType === "string" && p.contactType.trim()) {
            pocRole = p.contactType.trim();
          }
        }
      }
    }

    for (const key of ["founder", "author", "creator"]) {
      const person = obj[key];
      const first = Array.isArray(person) ? person[0] : person;
      if (first && typeof first === "object") {
        const p = first as Record<string, unknown>;
        if (!pocName && typeof p.name === "string" && p.name.trim()) {
          pocName = p.name.trim();
          if (!pocRole) {
            pocRole = key === "founder" ? "Founder" : "Host / Creator";
          }
        }
      }
    }

    if (obj["@graph"]) visitNode(obj["@graph"]);
  }

  for (const match of html.matchAll(scriptRegex)) {
    try {
      const parsed = JSON.parse(match[1].trim());
      visitNode(parsed);
    } catch {
      // Ignore malformed JSON-LD blocks
    }
  }

  return {
    emails: Array.from(emails),
    pocName,
    pocRole,
  };
}

/**
 * Discovers same-origin contact/about/booking pages and any linked RSS feed from HTML.
 */
export function discoverLinksFromHtml(
  html: string,
  baseUrl: string,
): { contactUrls: string[]; rssUrl: string | null } {
  const contactUrls = new Set<string>();
  let rssUrl: string | null = null;

  let baseParsed: URL;
  try {
    baseParsed = new URL(baseUrl);
  } catch {
    return { contactUrls: [], rssUrl: null };
  }

  // 1. Discover <link rel="alternate" type="application/rss+xml" href="...">
  const rssLinkRegex =
    /<link\b[^>]*type=["']application\/(?:rss|atom)\+xml["'][^>]*href=["']([^"']+)["'][^>]*>/i;
  const rssLinkAltRegex =
    /<link\b[^>]*href=["']([^"']+)["'][^>]*type=["']application\/(?:rss|atom)\+xml["'][^>]*>/i;
  const rssMatch = html.match(rssLinkRegex) || html.match(rssLinkAltRegex);
  if (rssMatch?.[1]) {
    try {
      rssUrl = normalizeUrl(new URL(rssMatch[1], baseParsed).toString());
    } catch {
      // ignore invalid relative URL
    }
  }

  // 2. Discover internal contact / booking / guest / media / about / team links
  const hrefRegex = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>/gi;
  const contactPathPattern =
    /\/(contact|contact-us|about|about-us|book|booking|bookings|guest|guests|be-a-guest|podcast|partner|partners|partnerships|collab|collaborate|work-with-us|press|media|team|enquiries|inquiries)(\/|$|\?)/i;

  for (const match of html.matchAll(hrefRegex)) {
    const rawHref = match[1].trim();
    if (!rawHref || rawHref.startsWith("mailto:") || rawHref.startsWith("tel:")) {
      continue;
    }
    try {
      const resolved = new URL(rawHref, baseParsed);
      if (resolved.hostname !== baseParsed.hostname) continue;
      if (contactPathPattern.test(resolved.pathname)) {
        // Strip query/hash for clean page fetch
        resolved.hash = "";
        contactUrls.add(resolved.toString());
        if (contactUrls.size >= 4) break;
      }
    } catch {
      // skip malformed href
    }
  }

  return {
    contactUrls: Array.from(contactUrls),
    rssUrl,
  };
}

/**
 * Enriches and verifies a raw candidate from OpenAI Web Search using direct
 * podcast RSS feeds (including iTunes Search lookup) and official website scraping.
 * Returns null if no valid outreach email can be established (or if requireVerifiedEmail
 * is true and no email could be verified directly on RSS/website).
 */
export async function enrichCandidateContact(
  candidate: RawCollaboratorCandidate,
  options: EnrichOptions = {},
): Promise<EnrichedCollaboratorLead | null> {
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const requireVerifiedEmail = options.requireVerifiedEmail ?? false;

  const brandName = candidate.brand_name?.trim();
  if (!brandName) return null;

  const brandType = normalizeBrandType(candidate.brand_type);
  let websiteUrl = normalizeUrl(candidate.website_url);
  let rssFeedUrl = normalizeUrl(candidate.rss_feed_url);
  const candidateSourceUrl = normalizeUrl(candidate.source_url);

  const platformUrls: PlatformUrls = sanitizePlatformUrls(candidate.platform_urls);
  const rssEmails: string[] = [];
  const siteEmails: string[] = [];

  let discoveredPocName: string | null = candidate.poc_name?.trim() || null;
  let discoveredPocRole: string | null = candidate.poc_role?.trim() || null;
  let verifiedSourceUrl: string | null = null;

  // Step 1: Podcast RSS feed enrichment (highest-accuracy source for podcast producer/host emails)
  const isLikelyPodcast =
    brandType === "podcast" ||
    (candidate.platforms ?? []).some((p) => p.toLowerCase().includes("podcast"));

  if (!rssFeedUrl && isLikelyPodcast) {
    const appleId = extractApplePodcastId(
      candidateSourceUrl,
      websiteUrl,
      platformUrls.podcast,
    );
    const itunesResult = appleId
      ? (await lookupPodcastRssByAppleId(appleId, fetchFn, timeoutMs)) ||
        (await findPodcastRssViaItunes(brandName, fetchFn, timeoutMs))
      : await findPodcastRssViaItunes(brandName, fetchFn, timeoutMs);

    if (itunesResult) {
      rssFeedUrl = itunesResult.feedUrl;
      if (!discoveredPocName && itunesResult.artistName) {
        discoveredPocName = itunesResult.artistName;
        if (!discoveredPocRole) discoveredPocRole = "Host / Creator";
      }
    }
  }

  if (rssFeedUrl) {
    const rssResp = await safeFetchText(
      rssFeedUrl,
      fetchFn,
      timeoutMs,
      "application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.8",
    );
    if (rssResp) {
      const parsedRss = parsePodcastRss(rssResp.text);
      rssEmails.push(...parsedRss.emails);
      if (parsedRss.emails.length > 0 && !verifiedSourceUrl) {
        verifiedSourceUrl = rssFeedUrl;
      }
      if (!discoveredPocName && (parsedRss.ownerName || parsedRss.authorName)) {
        discoveredPocName = parsedRss.ownerName || parsedRss.authorName;
        if (!discoveredPocRole) discoveredPocRole = "Podcast Host / Producer";
      }
      if (
        parsedRss.websiteUrl &&
        !isDirectoryOrSocialUrl(parsedRss.websiteUrl) &&
        (!websiteUrl || isDirectoryOrSocialUrl(websiteUrl))
      ) {
        websiteUrl = parsedRss.websiteUrl;
      }
    }
  }

  // Step 2: Official website & contact pages scraping (skip third-party directory/social hosts)
  if (websiteUrl && !isDirectoryOrSocialUrl(websiteUrl)) {
    const homeResp = await safeFetchText(websiteUrl, fetchFn, timeoutMs);
    if (homeResp) {
      websiteUrl = homeResp.finalUrl;

      // Enrich social profile URLs found on the brand's own website
      const scrapedSocials = extractSocialLinksFromHtml(homeResp.text);
      for (const [k, v] of Object.entries(scrapedSocials)) {
        const key = k as keyof PlatformUrls;
        if (!platformUrls[key] && v) {
          platformUrls[key] = v;
        }
      }

      const jsonLd = extractJsonLdContacts(homeResp.text);
      const homeEmails = [
        ...jsonLd.emails,
        ...extractEmailsFromText(homeResp.text),
      ];
      if (homeEmails.length > 0) {
        siteEmails.push(...homeEmails);
        if (!verifiedSourceUrl) verifiedSourceUrl = homeResp.finalUrl;
      }

      if (!discoveredPocName && jsonLd.pocName) {
        discoveredPocName = jsonLd.pocName;
      }
      if (!discoveredPocRole && jsonLd.pocRole) {
        discoveredPocRole = jsonLd.pocRole;
      }

      const discovered = discoverLinksFromHtml(homeResp.text, homeResp.finalUrl);

      // If homepage linked to an RSS feed we hadn't scraped yet, scrape it!
      if (!rssFeedUrl && discovered.rssUrl) {
        rssFeedUrl = discovered.rssUrl;
        const rssResp = await safeFetchText(rssFeedUrl, fetchFn, timeoutMs);
        if (rssResp) {
          const parsedRss = parsePodcastRss(rssResp.text);
          rssEmails.push(...parsedRss.emails);
          if (parsedRss.emails.length > 0) {
            verifiedSourceUrl = rssFeedUrl;
          }
          if (!discoveredPocName && parsedRss.ownerName) {
            discoveredPocName = parsedRss.ownerName;
            if (!discoveredPocRole) discoveredPocRole = "Podcast Host / Producer";
          }
        }
      }

      // If we still don't have a verified email, check discovered contact/about/booking subpages
      if (rssEmails.length === 0 && siteEmails.length === 0) {
        const origin = new URL(homeResp.finalUrl).origin;
        const candidatePages = new Set<string>(discovered.contactUrls);
        if (candidatePages.size < 3) {
          candidatePages.add(`${origin}/contact`);
          candidatePages.add(`${origin}/about`);
          candidatePages.add(`${origin}/work-with-us`);
        }

        const pagesToFetch = Array.from(candidatePages).slice(0, 4);
        const subResponses = await Promise.all(
          pagesToFetch.map((pageUrl) => safeFetchText(pageUrl, fetchFn, timeoutMs)),
        );

        for (const subResp of subResponses) {
          if (!subResp) continue;
          const subJsonLd = extractJsonLdContacts(subResp.text);
          const subEmails = [
            ...subJsonLd.emails,
            ...extractEmailsFromText(subResp.text),
          ];
          if (subEmails.length > 0) {
            siteEmails.push(...subEmails);
            if (!verifiedSourceUrl) verifiedSourceUrl = subResp.finalUrl;
          }
          if (!discoveredPocName && subJsonLd.pocName) {
            discoveredPocName = subJsonLd.pocName;
          }
        }
      }
    }
  }

  // Step 3: If OpenAI returned a distinct first-party source_url and we still haven't verified an email, fetch source_url directly
  if (
    rssEmails.length === 0 &&
    siteEmails.length === 0 &&
    candidateSourceUrl &&
    candidateSourceUrl !== websiteUrl &&
    !isDirectoryOrSocialUrl(candidateSourceUrl)
  ) {
    const srcResp = await safeFetchText(candidateSourceUrl, fetchFn, timeoutMs);
    if (srcResp) {
      const srcEmails = extractEmailsFromText(srcResp.text);
      if (srcEmails.length > 0) {
        siteEmails.push(...srcEmails);
        verifiedSourceUrl = srcResp.finalUrl;
      }
    }
  }

  // Step 4: Only save 100% source-verified emails (directly extracted from official RSS feed or brand website).
  // Unverified/AI-only emails are discarded; the lead is still saved with poc_name & poc_role and email = null.
  let chosenEmail: string | null = null;
  let emailSource: EmailSource | null = null;
  let emailVerifiedOnSource = false;

  const bestRssEmail = pickBestEmail(rssEmails, websiteUrl, discoveredPocName);
  const bestSiteEmail = pickBestEmail(siteEmails, websiteUrl, discoveredPocName);

  if (bestRssEmail && bestSiteEmail) {
    // Prefer whichever verified email is stronger for outreach (e.g., bookings@brand.com on site vs host@gmail.com in RSS)
    const bestOverall = pickBestEmail(
      [bestRssEmail, bestSiteEmail],
      websiteUrl,
      discoveredPocName,
    );
    chosenEmail = bestOverall;
    emailSource = bestOverall === bestSiteEmail ? "website_scrape" : "rss_feed";
    emailVerifiedOnSource = true;
  } else if (bestRssEmail) {
    chosenEmail = bestRssEmail;
    emailSource = "rss_feed";
    emailVerifiedOnSource = true;
  } else if (bestSiteEmail) {
    chosenEmail = bestSiteEmail;
    emailSource = "website_scrape";
    emailVerifiedOnSource = true;
  }

  if (!chosenEmail && requireVerifiedEmail) {
    return null;
  }

  // Ensure POC name & role are always populated cleanly
  const finalPocName =
    discoveredPocName && discoveredPocName.length > 1
      ? discoveredPocName
      : `${brandName} Partnerships Team`;

  const finalPocRole =
    discoveredPocRole && discoveredPocRole.length > 1
      ? discoveredPocRole
      : brandType === "podcast"
        ? "Podcast Host / Producer"
        : "Partnerships & Collaborations";

  const finalPlatforms = mergePlatforms(candidate.platforms, platformUrls);
  if (finalPlatforms.length === 0 && brandType === "podcast") {
    finalPlatforms.push("podcast");
  }

  return {
    brand_name: brandName,
    brand_type: brandType,
    poc_name: finalPocName,
    poc_role: finalPocRole,
    email: chosenEmail,
    email_source: emailSource,
    email_verified_on_source: emailVerifiedOnSource,
    website_url: websiteUrl,
    rss_feed_url: rssFeedUrl,
    source_url: verifiedSourceUrl || candidateSourceUrl || websiteUrl || rssFeedUrl,
    platforms: finalPlatforms,
    platform_urls: platformUrls,
    region: candidate.region?.trim() || null,
    niche: candidate.niche?.trim() || null,
    audience_notes: candidate.audience_notes?.trim() || null,
  };
}
