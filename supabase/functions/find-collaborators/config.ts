import type { DiscoveryTrack } from "./types.ts";

export const TARGET_PERSONA_CONTEXT = `
We are finding high-fit media, podcast, and social-media collaboration partners for James Castrission, founder of My Adventure Group (Australia).
- Who James is: Australian explorer, endurance adventurer (kayaked across the Tasman Sea, skied unsupported to the South Pole and back), keynote speaker, and corporate team-building/leadership entrepreneur running My Adventure Group.
- Collaboration goal: Boost James Castrission's and My Adventure Group's social media presence and reach via podcast guest appearances, video interviews, co-hosted challenges/segments, panels, and creator/media collaborations.
- Style benchmarks (think similar formats, reach, or multi-platform distribution):
  1. The Diary of a CEO (high-production long-form video podcasts with strong YouTube/IG/LinkedIn clip ecosystems)
  2. BuzzFeed (social-first media companies, digital studios, creator collectives running challenges, interviews, and viral collaborations)
  3. Agency Podcast (NOTE: James has ALREADY collaborated with Agency Podcast — DO NOT return Agency Podcast or agencypodcast)
- Target platforms: YouTube, Instagram, LinkedIn, Facebook, and major Podcast platforms. Every lead should have an active presence on at least one of these platforms.
- Target geography: Prioritize Australia / New Zealand AND strong Global English-speaking (US, UK, Canada) shows, channels, and social media companies.
`.trim();

/**
 * Brand slugs/names that must never be inserted as new leads
 * (already collaborated with James, or James's own brands).
 */
export const DEFAULT_EXCLUDED_BRANDS: readonly string[] = [
  "agencypodcast",
  "agency podcast",
  "the agency podcast",
  "my adventure group",
  "james castrission",
  "cas and jonesy",
  "crossing the ditch",
];

/**
 * 16 rotating discovery tracks so weekly runs consistently surface >= 20
 * fresh, non-duplicate collaborators across platforms and niches.
 */
export const DISCOVERY_TRACKS: readonly DiscoveryTrack[] = [
  {
    id: "au-founder-business-podcasts",
    label: "AU/NZ Founder & Business Video Podcasts",
    regionFocus: "AU/NZ",
    niche: "business_leadership",
    primaryPlatforms: ["podcast", "youtube", "instagram", "linkedin"],
    searchFocus:
      "Active Australian and New Zealand business, entrepreneurship, and founder interview podcasts (with YouTube/Instagram/LinkedIn video presence) that regularly interview entrepreneurs, keynote speakers, and inspiring leaders.",
  },
  {
    id: "global-leadership-performance-podcasts",
    label: "Global Executive Leadership & High-Performance Podcasts",
    regionFocus: "Global",
    niche: "leadership_performance",
    primaryPlatforms: ["podcast", "youtube", "linkedin"],
    searchFocus:
      "Established English-speaking leadership, CEO mindset, organizational culture, and peak performance video podcasts similar in format to Diary of a CEO that book external guests and publish clips on YouTube and LinkedIn.",
  },
  {
    id: "adventure-endurance-podcasts-youtube",
    label: "Adventure, Endurance & Resilience Podcasts and YouTube Channels",
    regionFocus: "AU/NZ + Global",
    niche: "adventure_resilience",
    primaryPlatforms: ["youtube", "podcast", "instagram"],
    searchFocus:
      "Adventure, extreme endurance, exploration, outdoor survival, and human grit podcasts or YouTube interview channels in Australia, NZ, UK, and US that feature explorers, ultra-endurance athletes, and expedition stories.",
  },
  {
    id: "au-social-media-studios-collab-teams",
    label: "AU/NZ Social Media Production Houses & Creator Collectives",
    regionFocus: "AU/NZ",
    niche: "social_media_entertainment",
    primaryPlatforms: ["instagram", "youtube", "facebook", "tiktok"],
    searchFocus:
      "Australian and New Zealand social-first media brands, digital video publishers, creator collectives, and challenge/interview channels (BuzzFeed-style or lifestyle media teams) active on Instagram, Facebook, and YouTube that run brand or guest collaborations.",
  },
  {
    id: "corporate-culture-hr-team-podcasts",
    label: "Workplace Culture, HR & Team-Building Podcasts and Media",
    regionFocus: "AU/NZ + Global",
    niche: "team_culture_hr",
    primaryPlatforms: ["podcast", "linkedin", "youtube"],
    searchFocus:
      "Australian and global HR, People & Culture, employee engagement, and corporate team-building podcasts or LinkedIn video shows whose audiences are corporate decision-makers interested in experiential team development.",
  },
  {
    id: "mindset-mental-toughness-podcasts",
    label: "Mindset, Mental Toughness & Overcoming Adversity Shows",
    regionFocus: "AU/NZ + Global",
    niche: "mindset_resilience",
    primaryPlatforms: ["podcast", "youtube", "instagram"],
    searchFocus:
      "Active podcasts and YouTube interview shows in Australia, UK, and US focused on mental resilience, psychology of grit, overcoming adversity, and men's or general wellbeing that regularly host inspiring guest speakers.",
  },
  {
    id: "global-social-first-media-companies",
    label: "Global Social-First Digital Media & Challenge Brands",
    regionFocus: "Global",
    niche: "social_media_entertainment",
    primaryPlatforms: ["youtube", "instagram", "facebook"],
    searchFocus:
      "English-speaking social-first digital media companies, documentary/interview publishers, and multi-host YouTube/Facebook/Instagram content networks (in the spirit of BuzzFeed, LADbible, Yes Theory-adjacent media teams) open to collaborations and guest stories.",
  },
  {
    id: "au-podcast-networks-hosts",
    label: "Australian Independent Podcast Networks & Multi-Show Studios",
    regionFocus: "AU/NZ",
    niche: "media_networks",
    primaryPlatforms: ["podcast", "instagram", "linkedin", "youtube"],
    searchFocus:
      "Independent Australian and NZ podcast networks, studio-run interview shows, and media companies hosting multiple business, lifestyle, or inspiration podcasts with clear producer or booking contacts.",
  },
  {
    id: "linkedin-b2b-video-shows",
    label: "LinkedIn B2B Executive Video Series & Creator Media",
    regionFocus: "AU/NZ + Global",
    niche: "b2b_linkedin_media",
    primaryPlatforms: ["linkedin", "youtube", "podcast"],
    searchFocus:
      "LinkedIn-first B2B media brands, executive interview series, and leadership creator channels in Australia, UK, and US that run live streams, panels, or video podcasts featuring founders and keynote speakers.",
  },
  {
    id: "youtube-longform-interview-creators",
    label: "YouTube Long-Form Interview & Documentary Channels",
    regionFocus: "Global",
    niche: "youtube_interviews",
    primaryPlatforms: ["youtube", "instagram"],
    searchFocus:
      "Mid-to-large English-speaking YouTube interview and mini-documentary channels (50k+ subscribers) that interview extraordinary people, founders, athletes, and adventurers and list business/booking inquiries.",
  },
  {
    id: "au-marketing-agency-growth-podcasts",
    label: "AU/NZ Marketing, Brand & Agency Podcasts",
    regionFocus: "AU/NZ",
    niche: "marketing_growth",
    primaryPlatforms: ["podcast", "linkedin", "instagram", "youtube"],
    searchFocus:
      "Australian and New Zealand marketing, brand-building, PR, and agency podcasts (similar to Agency Podcast, excluding Agency Podcast itself) that interview standout founders and high-energy storytellers.",
  },
  {
    id: "keynote-conference-event-media",
    label: "Conference, Speaker & Leadership Event Media Channels",
    regionFocus: "AU/NZ + Global",
    niche: "events_keynotes",
    primaryPlatforms: ["youtube", "linkedin", "facebook", "instagram"],
    searchFocus:
      "Business conferences, leadership summits, speaker bureaus with active podcasts/YouTube shows, and live-event media hosts in Australia, NZ, UK, and US that produce year-round video interviews and collaborations.",
  },
  {
    id: "outdoor-travel-expedition-media",
    label: "Outdoor, Travel & Expedition Digital Publishers",
    regionFocus: "AU/NZ + Global",
    niche: "travel_adventure_media",
    primaryPlatforms: ["facebook", "instagram", "youtube", "podcast"],
    searchFocus:
      "Outdoor lifestyle, expedition, ocean/mountain adventure, and active travel digital magazines, Facebook/Instagram communities, and YouTube media brands that publish interviews, guest features, and video collaborations.",
  },
  {
    id: "uk-entrepreneur-interview-podcasts",
    label: "UK Business, Creator & Ambition Podcasts",
    regionFocus: "Global",
    niche: "business_leadership",
    primaryPlatforms: ["podcast", "youtube", "instagram", "linkedin"],
    searchFocus:
      "Active UK-based entrepreneur, founder, and human-potential video podcasts (Diary of a CEO ecosystem / peers) with active YouTube and Instagram channels and published producer or booking contacts.",
  },
  {
    id: "us-high-performance-storytelling-podcasts",
    label: "US Storytelling, Grit & Leadership Podcasts",
    regionFocus: "Global",
    niche: "mindset_resilience",
    primaryPlatforms: ["podcast", "youtube", "instagram"],
    searchFocus:
      "Active US podcasts and media shows focused on remarkable human stories, high-stakes decision making, teamwork under pressure, and leadership lessons with clear guest booking or producer contacts.",
  },
  {
    id: "au-wellbeing-fitness-community-brands",
    label: "AU/NZ Wellbeing, Endurance Fitness & Community Media Channels",
    regionFocus: "AU/NZ",
    niche: "health_endurance",
    primaryPlatforms: ["instagram", "facebook", "youtube", "podcast"],
    searchFocus:
      "Australian and NZ endurance sports, running/ocean-swimming/fitness community brands, podcasts, and social media channels that host guest episodes, live events, and social collaborations.",
  },
];

/**
 * Selects a rotated slice of discovery tracks for a given run/week so consecutive
 * weekly runs cover different tracks first and can spill into additional tracks
 * if needed to hit the weekly target (>= 20 leads).
 */
export function selectTracksForRun(
  rotationWeek: number,
  count: number,
): DiscoveryTrack[] {
  const total = DISCOVERY_TRACKS.length;
  const normalizedWeek = Math.max(1, Math.floor(rotationWeek));
  // Advance by 4 tracks each week so every week starts on a fresh quartet
  const startIndex = ((normalizedWeek - 1) * 4) % total;
  const limit = Math.min(Math.max(1, count), total);

  const selected: DiscoveryTrack[] = [];
  for (let i = 0; i < limit; i++) {
    selected.push(DISCOVERY_TRACKS[(startIndex + i) % total]);
  }
  return selected;
}
