import type { BrandType, PlatformName, PlatformUrls } from "./types.ts";

const EMAIL_FORMAT_REGEX = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

const BLOCKED_EMAIL_DOMAINS = new Set([
  "example.com",
  "example.org",
  "example.net",
  "test.com",
  "localhost",
  "domain.com",
  "email.com",
  "yoursite.com",
  "yourdomain.com",
  "sentry.io",
  "sentry-next.wixpress.com",
  "wixpress.com",
  "wix.com",
  "squarespace.com",
  "wordpress.org",
  "wordpress.com",
  "w3.org",
  "schema.org",
  "gravatar.com",
  "apple.com",
  "google.com",
  "googletagmanager.com",
  "facebook.com",
  "instagram.com",
  "youtube.com",
  "linkedin.com",
  "twitter.com",
  "x.com",
  "tiktok.com",
  "spotify.com",
  "cloudflare.com",
  "jsdelivr.net",
  "amazonaws.com",
  "mailchimp.com",
  "hubspot.com",
  "intercom.io",
  "zendesk.com",
  "shopify.com",
  "stripe.com",
  "patreon.com",
  "omnycontent.com",
  "megaphone.fm",
  "buzzsprout.com",
  "libsyn.com",
  "anchor.fm",
  "podbean.com",
  "transistor.fm",
  "acast.com",
  "simplecast.com",
]);

const BLOCKED_EMAIL_LOCAL_PREFIXES = [
  "noreply",
  "no-reply",
  "no_reply",
  "donotreply",
  "do-not-reply",
  "mailer-daemon",
  "postmaster",
  "hostmaster",
  "webmaster",
  "abuse",
  "dmca",
  "privacy",
  "dpo",
  "gdpr",
  "legal",
  "compliance",
  "security",
  "unsubscribe",
  "bounce",
  "notifications",
  "wordpress",
  "admin-ajax",
  "root",
  "copyright",
  "trademark",
];

const BLOCKED_FILE_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".ico",
  ".css",
  ".js",
  ".mjs",
  ".woff",
  ".woff2",
  ".ttf",
  ".pdf",
  ".mp3",
  ".mp4",
];

const ALLOWED_BRAND_TYPES = new Set<BrandType>([
  "podcast",
  "youtube_channel",
  "media_company",
  "social_media_brand",
  "influencer_network",
  "event_host",
  "other",
]);

const ALLOWED_PLATFORMS = new Set<PlatformName>([
  "youtube",
  "instagram",
  "linkedin",
  "facebook",
  "podcast",
  "tiktok",
  "x",
]);

/** Matches the SQL generated column `brand_name_normalized`. */
export function normalizeBrandName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Strips leading "the", punctuation, and spaces for fuzzy duplicate/exclusion checks
 * (e.g., "The Agency Podcast" -> "agencypodcast", "Agency Podcast" -> "agencypodcast").
 */
export function brandSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/^the\s+/i, "")
    .replace(/[^a-z0-9]/g, "");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidOutreachEmail(raw: string | null | undefined): boolean {
  if (!raw) return false;
  const email = normalizeEmail(raw);
  if (email.length > 254) return false;
  if (!EMAIL_FORMAT_REGEX.test(email)) return false;

  const atIdx = email.indexOf("@");
  if (atIdx <= 0) return false;

  const local = email.slice(0, atIdx);
  const domain = email.slice(atIdx + 1);

  if (domain.includes("..") || local.includes("..")) return false;
  if (BLOCKED_EMAIL_DOMAINS.has(domain)) return false;

  // Check if domain ends with a blocked asset extension (common false positive like icon@2x.png)
  for (const ext of BLOCKED_FILE_EXTENSIONS) {
    if (domain.endsWith(ext) || email.endsWith(ext)) return false;
  }

  // Reject automated/system/legal mailboxes
  for (const prefix of BLOCKED_EMAIL_LOCAL_PREFIXES) {
    if (
      local === prefix ||
      local.startsWith(`${prefix}+`) ||
      local.startsWith(`${prefix}.`) ||
      local.startsWith(`${prefix}-`)
    ) {
      return false;
    }
  }

  // Reject long hex hashes (e.g. Sentry / tracking IDs)
  if (/^[a-f0-9]{20,}$/i.test(local)) return false;

  return true;
}

export function normalizeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let cleaned = raw.trim();
  if (!cleaned) return null;
  if (!/^https?:\/\//i.test(cleaned)) {
    if (/^[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(cleaned)) {
      cleaned = `https://${cleaned}`;
    } else {
      return null;
    }
  }
  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

export function getRootDomain(urlOrHost: string | null | undefined): string | null {
  if (!urlOrHost) return null;
  try {
    const parsed = urlOrHost.includes("://")
      ? new URL(urlOrHost)
      : new URL(`https://${urlOrHost}`);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const parts = host.split(".");
    if (parts.length <= 2) return host;
    // Handle common 2-level TLDs like .com.au, .co.uk, .co.nz, .org.au
    const lastTwo = parts.slice(-2).join(".");
    if (
      ["com.au", "net.au", "org.au", "co.uk", "org.uk", "co.nz", "com.nz"].includes(
        lastTwo,
      )
    ) {
      return parts.slice(-3).join(".");
    }
    return parts.slice(-2).join(".");
  } catch {
    return null;
  }
}

export function decodeBasicHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#64;|&commat;/gi, "@")
    .replace(/&#46;|&period;/gi, ".")
    .replace(/%40/gi, "@");
}

/**
 * Extracts unique, valid outreach emails from HTML, RSS XML, or plain text.
 * Supports mailto: links, HTML-encoded @ symbols, and simple [at] / (at) obfuscation.
 */
export function extractEmailsFromText(rawText: string): string[] {
  if (!rawText) return [];
  const decoded = decodeBasicHtmlEntities(rawText);
  const found = new Set<string>();

  // 1. Explicit mailto: links
  const mailtoRegex = /mailto:([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/gi;
  for (const match of decoded.matchAll(mailtoRegex)) {
    const email = normalizeEmail(match[1]);
    if (isValidOutreachEmail(email)) found.add(email);
  }

  // 2. Standard email patterns
  const standardRegex = /\b([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})\b/gi;
  for (const match of decoded.matchAll(standardRegex)) {
    const email = normalizeEmail(match[1]);
    if (isValidOutreachEmail(email)) found.add(email);
  }

  // 3. Light obfuscation: name [at] domain [dot] com or name (at) domain.com
  const obfuscatedRegex =
    /\b([a-z0-9._%+-]+)\s*(?:\[at\]|\(at\))\s*([a-z0-9.-]+(?:\s*(?:\[dot\]|\(dot\))\s*[a-z0-9-]+)+|[a-z0-9.-]+\.[a-z]{2,})\b/gi;
  for (const match of decoded.matchAll(obfuscatedRegex)) {
    const local = match[1];
    const domain = match[2].replace(/\s*(?:\[dot\]|\(dot\))\s*/gi, ".");
    const email = normalizeEmail(`${local}@${domain}`);
    if (isValidOutreachEmail(email)) found.add(email);
  }

  return Array.from(found);
}

/**
 * Scores an email for podcast / media collaboration outreach priority.
 * Higher score = better outreach target.
 */
export function scoreEmailForOutreach(
  email: string,
  websiteUrl?: string | null,
  pocName?: string | null,
): number {
  const normalized = normalizeEmail(email);
  const [local, domain] = normalized.split("@");
  if (!local || !domain) return -100;

  let score = 0;

  // Domain match with the brand's official website is a strong signal
  const siteRoot = getRootDomain(websiteUrl);
  const emailRoot = getRootDomain(domain);
  if (siteRoot && emailRoot && siteRoot === emailRoot) {
    score += 35;
  } else if (
    ["gmail.com", "outlook.com", "hotmail.com", "icloud.com", "me.com", "proton.me", "protonmail.com"].includes(
      domain,
    )
  ) {
    // Common & legitimate for independent podcasters/YouTubers, slight preference for custom domain when both exist
    score += 5;
  } else {
    // Possibly management agency, podcast network, or talent rep
    score += 15;
  }

  // High-intent collaboration/booking local parts
  if (
    /^(booking|bookings|guest|guests|podcast|podcasts|collab|collabs|collaborations|partner|partners|partnerships|producer|production|talent|speaking|appearances|pitch|pitches)/.test(
      local,
    )
  ) {
    score += 45;
  } else if (/^(media|press|pr|editorial|content|studio|show|episodes|sponsorship|sponsors|business|enquiries|inquiries)/.test(local)) {
    score += 30;
  } else if (/^(hello|hi|contact|team|info|connect|hey|admin)/.test(local)) {
    score += 18;
  } else if (/^(support|help|billing|accounts|sales|careers|jobs|hr|orders|shop|store)/.test(local)) {
    score -= 15;
  }

  // Bonus if email local part contains POC's first or last name
  if (pocName) {
    const tokens = pocName
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((t) => t.length >= 3);
    for (const token of tokens) {
      if (local.includes(token)) {
        score += 30;
        break;
      }
    }
  }

  return score;
}

export function pickBestEmail(
  emails: string[],
  websiteUrl?: string | null,
  pocName?: string | null,
): string | null {
  const valid = Array.from(new Set(emails.map(normalizeEmail))).filter(
    isValidOutreachEmail,
  );
  if (valid.length === 0) return null;
  valid.sort(
    (a, b) =>
      scoreEmailForOutreach(b, websiteUrl, pocName) -
      scoreEmailForOutreach(a, websiteUrl, pocName),
  );
  return valid[0];
}

export function normalizeBrandType(raw: string | null | undefined): BrandType {
  if (!raw) return "other";
  const cleaned = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (ALLOWED_BRAND_TYPES.has(cleaned as BrandType)) {
    return cleaned as BrandType;
  }
  if (cleaned.includes("podcast")) return "podcast";
  if (cleaned.includes("youtube")) return "youtube_channel";
  if (cleaned.includes("media") || cleaned.includes("studio") || cleaned.includes("publisher")) {
    return "media_company";
  }
  if (cleaned.includes("social")) return "social_media_brand";
  if (cleaned.includes("influencer") || cleaned.includes("creator") || cleaned.includes("network")) {
    return "influencer_network";
  }
  if (cleaned.includes("event") || cleaned.includes("conference") || cleaned.includes("host")) {
    return "event_host";
  }
  return "other";
}

export function normalizePlatformName(raw: string): PlatformName | null {
  const cleaned = raw.trim().toLowerCase();
  if (cleaned === "ig" || cleaned === "insta" || cleaned === "instagram") {
    return "instagram";
  }
  if (cleaned === "fb" || cleaned === "facebook") return "facebook";
  if (cleaned === "yt" || cleaned === "youtube") return "youtube";
  if (cleaned === "li" || cleaned === "linkedin") return "linkedin";
  if (
    cleaned === "podcast" ||
    cleaned === "podcasts" ||
    cleaned === "apple podcasts" ||
    cleaned === "spotify"
  ) {
    return "podcast";
  }
  if (cleaned === "tiktok" || cleaned === "tik tok") return "tiktok";
  if (cleaned === "x" || cleaned === "twitter") return "x";
  if (ALLOWED_PLATFORMS.has(cleaned as PlatformName)) {
    return cleaned as PlatformName;
  }
  return null;
}

export function sanitizePlatformUrls(
  rawUrls?: Partial<Record<string, string | null | undefined>>,
): PlatformUrls {
  const result: PlatformUrls = {};
  if (!rawUrls) return result;
  for (const [key, value] of Object.entries(rawUrls)) {
    const platform = normalizePlatformName(key);
    const normalized = normalizeUrl(value);
    if (platform && normalized) {
      result[platform] = normalized;
    }
  }
  return result;
}

export function mergePlatforms(
  rawPlatforms: string[] | undefined,
  urls: PlatformUrls,
): PlatformName[] {
  const set = new Set<PlatformName>();
  for (const raw of rawPlatforms ?? []) {
    const normalized = normalizePlatformName(raw);
    if (normalized) set.add(normalized);
  }
  for (const key of Object.keys(urls) as PlatformName[]) {
    if (urls[key]) set.add(key);
  }
  return Array.from(set);
}

/**
 * Extracts major social profile URLs from an official brand HTML page.
 */
export function extractSocialLinksFromHtml(html: string): PlatformUrls {
  const urls: PlatformUrls = {};
  if (!html) return urls;

  const patterns: Array<[PlatformName, RegExp]> = [
    [
      "youtube",
      /https?:\/\/(?:www\.)?(?:youtube\.com\/(?:@|channel\/|c\/|user\/)[a-z0-9._%-]+|youtu\.be\/[a-z0-9._%-]+)/i,
    ],
    [
      "instagram",
      /https?:\/\/(?:www\.)?instagram\.com\/(?!p\/|reel\/|explore\/|accounts\/)[a-z0-9._]{2,35}\/?/i,
    ],
    [
      "linkedin",
      /https?:\/\/(?:www\.)?linkedin\.com\/(?:company|in)\/[a-z0-9._%-]+\/?/i,
    ],
    [
      "facebook",
      /https?:\/\/(?:www\.)?facebook\.com\/(?!sharer|share\.php|dialog|tr\?)[a-z0-9._%-]+\/?/i,
    ],
    [
      "tiktok",
      /https?:\/\/(?:www\.)?tiktok\.com\/@[a-z0-9._%-]+\/?/i,
    ],
  ];

  for (const [platform, regex] of patterns) {
    const match = html.match(regex);
    if (match?.[0]) {
      const clean = normalizeUrl(match[0].replace(/[)"'<>]+$/, ""));
      if (clean) urls[platform] = clean;
    }
  }

  return urls;
}

/**
 * Constant-time string comparison to avoid timing attacks on shared secrets.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Runs an async mapper with bounded concurrency.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await mapper(items[current], current);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
