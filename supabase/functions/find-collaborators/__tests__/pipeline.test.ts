import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { selectTracksForRun } from "../config.ts";
import {
  buildDiscoveryPrompt,
  extractTextFromResponsesApi,
  parseCandidatesJson,
} from "../openai_search.ts";
import { runDiscoveryPipeline } from "../pipeline.ts";
import {
  discoverLinksFromHtml,
  enrichCandidateContact,
  extractApplePodcastId,
  extractJsonLdContacts,
  isDirectoryOrSocialUrl,
  isSafePublicUrl,
  parsePodcastRss,
} from "../scraper.ts";
import type { RawCollaboratorCandidate } from "../types.ts";
import {
  brandSlug,
  constantTimeEqual,
  extractEmailsFromText,
  extractSocialLinksFromHtml,
  isValidOutreachEmail,
  pickBestEmail,
} from "../utils.ts";

describe("utils", () => {
  it("normalizes brand slugs so Agency Podcast variants match", () => {
    assert.equal(brandSlug("agencypodcast"), "agencypodcast");
    assert.equal(brandSlug("Agency Podcast"), "agencypodcast");
    assert.equal(brandSlug("The Agency Podcast!"), "agencypodcast");
  });

  it("extracts valid emails and filters noise/system/asset addresses", () => {
    const html = `
      <a href="mailto:bookings@adventuremedia.com.au">Book</a>
      <p>Producer: sarah&#64;adventuremedia.com.au</p>
      <p>Alt: guest [at] adventuremedia [dot] com [dot] au</p>
      <img src="logo@2x.png" />
      <span>noreply@adventuremedia.com.au privacy@adventuremedia.com.au test@example.com</span>
      <span>0123456789abcdef0123456789abcdef@sentry.io</span>
    `;
    const emails = extractEmailsFromText(html);
    assert.deepEqual(
      new Set(emails),
      new Set([
        "bookings@adventuremedia.com.au",
        "sarah@adventuremedia.com.au",
        "guest@adventuremedia.com.au",
      ]),
    );
    assert.equal(isValidOutreachEmail("noreply@brand.com"), false);
    assert.equal(isValidOutreachEmail("icon@2x.png"), false);
    assert.equal(isValidOutreachEmail("bookings@brand.com.au"), true);
  });

  it("ranks booking/partnership emails on brand domain above generic support or free domains", () => {
    const best = pickBestEmail(
      [
        "support@peakshow.com.au",
        "peakshow@gmail.com",
        "hello@peakshow.com.au",
        "bookings@peakshow.com.au",
      ],
      "https://www.peakshow.com.au",
      "Alex Taylor",
    );
    assert.equal(best, "bookings@peakshow.com.au");
  });

  it("extracts social platform URLs from HTML", () => {
    const html = `
      <a href="https://www.youtube.com/@PeakLeadersShow">YouTube</a>
      <a href="https://instagram.com/peakleaders/">IG</a>
      <a href="https://www.linkedin.com/company/peak-leaders-media/">LI</a>
      <a href="https://www.facebook.com/peakleadersmedia">FB</a>
    `;
    const socials = extractSocialLinksFromHtml(html);
    assert.equal(socials.youtube, "https://www.youtube.com/@PeakLeadersShow");
    assert.equal(socials.instagram, "https://instagram.com/peakleaders/");
    assert.equal(
      socials.linkedin,
      "https://www.linkedin.com/company/peak-leaders-media/",
    );
    assert.equal(socials.facebook, "https://www.facebook.com/peakleadersmedia");
  });

  it("compares secrets in constant time", () => {
    assert.equal(constantTimeEqual("secret-123", "secret-123"), true);
    assert.equal(constantTimeEqual("secret-123", "secret-124"), false);
    assert.equal(constantTimeEqual("short", "longer-string"), false);
  });
});

describe("scraper", () => {
  it("extracts Apple Podcasts IDs for exact iTunes lookup", () => {
    assert.equal(
      extractApplePodcastId(
        "https://podcasts.apple.com/au/podcast/startup-diaries/id1479491840",
      ),
      "1479491840",
    );
    assert.equal(extractApplePodcastId("https://example.com/podcast"), null);
  });

  it("blocks private/local URLs to prevent SSRF", () => {
    assert.equal(isSafePublicUrl("https://myadventuregroup.com.au"), true);
    assert.equal(isSafePublicUrl("http://localhost:8080/admin"), false);
    assert.equal(isSafePublicUrl("http://127.0.0.1/secret"), false);
    assert.equal(isSafePublicUrl("http://169.254.169.254/latest/meta-data"), false);
    assert.equal(isSafePublicUrl("http://192.168.1.5/contact"), false);
    assert.equal(isSafePublicUrl("file:///etc/passwd"), false);
  });

  it("parses podcast RSS XML for itunes:owner email and host name", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
        <channel>
          <title>Grit &amp; Scale Australia</title>
          <link>https://gritandscale.com.au</link>
          <itunes:author>Liam Carter</itunes:author>
          <itunes:owner>
            <itunes:name><![CDATA[Emma Reid]]></itunes:name>
            <itunes:email>producer@gritandscale.com.au</itunes:email>
          </itunes:owner>
          <item><title>Ep 1</title></item>
        </channel>
      </rss>`;

    const parsed = parsePodcastRss(xml);
    assert.deepEqual(parsed.emails, ["producer@gritandscale.com.au"]);
    assert.equal(parsed.ownerName, "Emma Reid");
    assert.equal(parsed.authorName, "Liam Carter");
    assert.equal(parsed.websiteUrl, "https://gritandscale.com.au/");
  });

  it("extracts contacts from JSON-LD and discovers contact/RSS links", () => {
    const html = `
      <html>
        <head>
          <link rel="alternate" type="application/rss+xml" href="/feed.xml" />
          <script type="application/ld+json">
            {
              "@context": "https://schema.org",
              "@type": "Organization",
              "name": "Trailblaze Media",
              "founder": { "@type": "Person", "name": "Chloe Nguyen" },
              "contactPoint": {
                "@type": "ContactPoint",
                "contactType": "Partnerships",
                "email": "partnerships@trailblazemedia.com.au"
              }
            }
          </script>
        </head>
        <body>
          <a href="/contact-us">Contact</a>
          <a href="/work-with-us">Work With Us</a>
          <a href="https://external.org/contact">External</a>
        </body>
      </html>
    `;
    const jsonLd = extractJsonLdContacts(html);
    assert.deepEqual(jsonLd.emails, ["partnerships@trailblazemedia.com.au"]);
    assert.equal(jsonLd.pocName, "Chloe Nguyen");
    assert.equal(jsonLd.pocRole, "Partnerships");

    const links = discoverLinksFromHtml(html, "https://trailblazemedia.com.au");
    assert.equal(links.rssUrl, "https://trailblazemedia.com.au/feed.xml");
    assert.deepEqual(links.contactUrls, [
      "https://trailblazemedia.com.au/contact-us",
      "https://trailblazemedia.com.au/work-with-us",
    ]);
  });

  it("enriches a podcast with empty OpenAI email via iTunes RSS discovery", async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.startsWith("https://itunes.apple.com/search")) {
        return new Response(
          JSON.stringify({
            results: [
              {
                collectionName: "The Founder Edge Podcast",
                artistName: "Sam Brooks",
                feedUrl: "https://feeds.founderedge.com.au/rss.xml",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url === "https://feeds.founderedge.com.au/rss.xml") {
        return new Response(
          `<rss><channel><itunes:owner><itunes:name>Sam Brooks</itunes:name><itunes:email>guests@founderedge.com.au</itunes:email></itunes:owner></channel></rss>`,
          { status: 200 },
        );
      }
      if (url === "https://founderedge.com.au/") {
        return new Response(
          `<html><body><a href="https://youtube.com/@FounderEdge">YT</a></body></html>`,
          { status: 200 },
        );
      }
      return new Response("Not Found", { status: 404 });
    };

    const candidate: RawCollaboratorCandidate = {
      brand_name: "The Founder Edge Podcast",
      brand_type: "podcast",
      poc_name: "Sam Brooks",
      poc_role: "Host",
      email: "",
      website_url: "https://founderedge.com.au",
      rss_feed_url: "",
      source_url: "https://founderedge.com.au",
      platforms: ["podcast"],
      platform_urls: {},
      region: "AU",
      niche: "business_leadership",
      audience_notes: "Interviews Australian founders and keynote speakers.",
    };

    const enriched = await enrichCandidateContact(candidate, {
      fetchFn: mockFetch,
      requireVerifiedEmail: true,
    });

    assert.ok(enriched);
    assert.equal(enriched.email, "guests@founderedge.com.au");
    assert.equal(enriched.email_source, "rss_feed");
    assert.equal(enriched.email_verified_on_source, true);
    assert.equal(enriched.rss_feed_url, "https://feeds.founderedge.com.au/rss.xml");
    assert.ok(enriched.platforms.includes("youtube"));
    assert.equal(enriched.platform_urls.youtube, "https://youtube.com/@FounderEdge");
  });

  it("crawls /contact subpage to verify media company email", async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://boldsocialstudio.com.au/") {
        return new Response(
          `<html><body><a href="/contact">Contact Us</a><a href="https://instagram.com/boldsocialstudio">IG</a></body></html>`,
          { status: 200 },
        );
      }
      if (url === "https://boldsocialstudio.com.au/contact") {
        return new Response(
          `<html><body>For brand collabs email <a href="mailto:collabs@boldsocialstudio.com.au">collabs@boldsocialstudio.com.au</a></body></html>`,
          { status: 200 },
        );
      }
      return new Response("Not Found", { status: 404 });
    };

    const candidate: RawCollaboratorCandidate = {
      brand_name: "Bold Social Studio",
      brand_type: "social_media_brand",
      poc_name: "Jordan Lee",
      poc_role: "Head of Partnerships",
      email: "",
      website_url: "https://boldsocialstudio.com.au",
      rss_feed_url: "",
      source_url: "https://boldsocialstudio.com.au",
      platforms: ["instagram"],
      platform_urls: {},
      region: "AU",
      niche: "social_media_entertainment",
      audience_notes: "Australian BuzzFeed-style social video collective.",
    };

    const enriched = await enrichCandidateContact(candidate, {
      fetchFn: mockFetch,
      requireVerifiedEmail: true,
    });

    assert.ok(enriched);
    assert.equal(enriched.email, "collabs@boldsocialstudio.com.au");
    assert.equal(enriched.email_source, "website_scrape");
    assert.equal(enriched.email_verified_on_source, true);
    assert.equal(
      enriched.source_url,
      "https://boldsocialstudio.com.au/contact",
    );
  });

  it("discards unverified AI-only emails and saves POC name & role with email = null", async () => {
    const mockFetch: typeof fetch = async () =>
      new Response("<html><body>No email listed here</body></html>", {
        status: 200,
      });

    const candidate: RawCollaboratorCandidate = {
      brand_name: "Summit Founders Show",
      brand_type: "youtube_channel",
      poc_name: "Taylor Grant",
      poc_role: "Host & Executive Producer",
      email: "info@summitfounders.com.au", // unverified OpenAI guess
      website_url: "https://summitfounders.com.au",
      rss_feed_url: "",
      source_url: "https://podtail.com/podcast/summit-founders/",
      platforms: ["youtube", "linkedin"],
      platform_urls: { youtube: "https://youtube.com/@SummitFounders" },
      region: "AU",
      niche: "business_leadership",
      audience_notes: "Interviews founders and speakers.",
    };

    const enriched = await enrichCandidateContact(candidate, {
      fetchFn: mockFetch,
    });

    assert.ok(enriched);
    assert.equal(enriched.brand_name, "Summit Founders Show");
    assert.equal(enriched.poc_name, "Taylor Grant");
    assert.equal(enriched.poc_role, "Host & Executive Producer");
    assert.equal(enriched.email, null);
    assert.equal(enriched.email_source, null);
    assert.equal(enriched.email_verified_on_source, false);
    assert.equal(isDirectoryOrSocialUrl("https://podtail.com/podcast/x"), true);
    assert.equal(isDirectoryOrSocialUrl("https://summitfounders.com.au"), false);
  });

  it("skips unverified leads only when requireVerifiedEmail is explicitly true", async () => {
    const mockFetch: typeof fetch = async () =>
      new Response("<html><body>No email listed</body></html>", { status: 200 });

    const enriched = await enrichCandidateContact(
      {
        brand_name: "Unverified Show",
        brand_type: "youtube_channel",
        poc_name: "Casey Kim",
        poc_role: "Host",
        email: "guess@unverifiedshow.com",
        website_url: "https://unverifiedshow.com",
        rss_feed_url: "",
        source_url: "https://unverifiedshow.com",
        platforms: ["youtube"],
        platform_urls: {},
        region: "AU",
        niche: "business_leadership",
        audience_notes: "",
      },
      { fetchFn: mockFetch, requireVerifiedEmail: true },
    );
    assert.equal(enriched, null);
  });
});

describe("openai_search helpers & weekly pipeline", () => {
  it("extracts structured output text from nested Responses API payloads", () => {
    assert.equal(
      extractTextFromResponsesApi({ output_text: '{"candidates":[]}' }),
      '{"candidates":[]}',
    );
    assert.equal(
      extractTextFromResponsesApi({
        output: [
          { type: "web_search_call" },
          {
            type: "message",
            content: [{ type: "output_text", text: '{"candidates":[{"brand_name":"Test"}]}' }],
          },
        ],
      }),
      '{"candidates":[{"brand_name":"Test"}]}',
    );
  });

  it("salvages complete candidates if OpenAI JSON response truncates mid-string", () => {
    const truncated = `{"candidates":[{"brand_name":"Show One","brand_type":"podcast","poc_name":"Alex Reid","poc_role":"Host","email":"","website_url":"https://showone.com.au","rss_feed_url":"","source_url":"https://showone.com.au","platforms":["podcast"],"platform_urls":{"youtube":"","instagram":"","linkedin":"","facebook":"","podcast":""},"region":"AU","niche":"leadership","audience_notes":"Great fit."},{"brand_name":"Show Two","audience_notes":"Cut off mid-str`;
    const salvaged = parseCandidatesJson(truncated);
    assert.equal(salvaged.length, 1);
    assert.equal(salvaged[0].brand_name, "Show One");
    assert.equal(salvaged[0].poc_name, "Alex Reid");
  });

  it("rotates discovery tracks cleanly week to week", () => {
    const week1 = selectTracksForRun(1, 4).map((t) => t.id);
    const week2 = selectTracksForRun(2, 4).map((t) => t.id);
    assert.equal(week1.length, 4);
    assert.equal(week2.length, 4);
    assert.notEqual(week1[0], week2[0]);
    for (const id of week1) {
      assert.equal(week2.includes(id), false);
    }
  });

  it("builds discovery prompt with exclusions and no-fabrication rule", () => {
    const track = selectTracksForRun(1, 1)[0];
    const prompt = buildDiscoveryPrompt(track, 12, ["Agency Podcast", "Existing Show"]);
    assert.match(prompt, /NEVER invent, guess, or default to generic emails/i);
    assert.match(prompt, /Agency Podcast/);
    assert.match(prompt, /Existing Show/);
  });

  it("runs multi-batch pipeline, excludes agencypodcast & DB duplicates, and reaches >= 20 leads", async () => {
    let callCount = 0;

    const result = await runDiscoveryPipeline({
      openaiApiKey: "test-key",
      openaiModel: "gpt-4.1-mini",
      targetCount: 20,
      rotationWeek: 1,
      maxBatches: 5,
      requireVerifiedEmail: false,
      existingBrandNames: ["Already Stored Podcast"],
      existingEmails: ["existing@stored.com"],
      searchFn: async ({ track }) => {
        callCount++;
        // Simulate transient error on batch 2 to confirm fault tolerance
        if (callCount === 2) {
          throw new Error("Simulated transient OpenAI timeout");
        }
        const batchIdx = callCount;
        const items: RawCollaboratorCandidate[] = [
          // Should be excluded automatically (already collaborated)
          {
            brand_name: "Agency Podcast",
            brand_type: "podcast",
            poc_name: "Host",
            poc_role: "Host",
            email: "host@agencypodcast.com",
            website_url: "https://agencypodcast.com",
            rss_feed_url: "",
            source_url: "https://agencypodcast.com",
            platforms: ["podcast"],
            platform_urls: {},
            region: "AU",
            niche: track.niche,
            audience_notes: "",
          },
          // Should be skipped (already in DB)
          {
            brand_name: "Already Stored Podcast",
            brand_type: "podcast",
            poc_name: "Host",
            poc_role: "Host",
            email: "new@stored.com",
            website_url: "https://stored.com",
            rss_feed_url: "",
            source_url: "https://stored.com",
            platforms: ["podcast"],
            platform_urls: {},
            region: "AU",
            niche: track.niche,
            audience_notes: "",
          },
        ];

        // Add 8 fresh candidates per successful batch (6 verified email + 2 POC-only with email=null -> 3 successful batches = 24 >= 20)
        for (let i = 1; i <= 8; i++) {
          items.push({
            brand_name: `Show ${batchIdx}-${i}`,
            brand_type: "podcast",
            poc_name: `Producer ${batchIdx}-${i}`,
            poc_role: "Executive Producer",
            email: i <= 6 ? `bookings${batchIdx}_${i}@show${batchIdx}-${i}.com.au` : "",
            website_url: `https://show${batchIdx}-${i}.com.au`,
            rss_feed_url: "",
            source_url: `https://show${batchIdx}-${i}.com.au/contact`,
            platforms: ["podcast", "youtube"],
            platform_urls: { youtube: `https://youtube.com/@show${batchIdx}_${i}` },
            region: "AU",
            niche: track.niche,
            audience_notes: "Strong fit for James Castrission.",
          });
        }
        return items;
      },
      enrichFn: async (candidate) => {
        const hasVerified = Boolean(candidate.email);
        return {
          brand_name: candidate.brand_name,
          brand_type: "podcast",
          poc_name: candidate.poc_name,
          poc_role: candidate.poc_role,
          email: hasVerified ? candidate.email : null,
          email_source: hasVerified ? "rss_feed" : null,
          email_verified_on_source: hasVerified,
          website_url: candidate.website_url,
          rss_feed_url: null,
          source_url: candidate.source_url,
          platforms: ["podcast", "youtube"],
          platform_urls: candidate.platform_urls,
          region: candidate.region,
          niche: candidate.niche,
          audience_notes: candidate.audience_notes,
        };
      },
    });

    assert.ok(result.leads.length >= 20, `Expected >= 20 leads, got ${result.leads.length}`);
    assert.equal(result.leads.length, 24);
    assert.equal(result.verifiedEmailCount, 18);
    assert.equal(
      result.leads.filter((l) => l.email === null).length,
      6,
    );
    assert.equal(
      result.leads.some((l) => brandSlug(l.brand_name) === "agencypodcast"),
      false,
    );
    assert.equal(
      result.leads.some((l) => l.brand_name === "Already Stored Podcast"),
      false,
    );
    // Batch 2 failed, batches 1, 3, 4 succeeded -> 4 tracks logged
    assert.equal(result.queriesExecuted.length, 4);
    assert.ok(result.queriesExecuted[1].error?.includes("Simulated transient"));
  });
});
