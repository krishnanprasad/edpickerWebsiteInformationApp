/**
 * URL utilities for Crawler V2
 * - Canonicalization (preserve path case, strip tracking params)
 * - Skip lists (hard skip gallery/blog/wp-content etc.)
 * - Tier classification (0=mandatory disclosure, 1=must, 2=should, 3=nice)
 * - Fingerprint hashing for facts + URLs
 */
import crypto from 'node:crypto';

/* ------------------------------------------------------------------ */
/*  Tracking params to strip                                           */
/* ------------------------------------------------------------------ */
const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'ref', 'source', 'mc_cid', 'mc_eid',
  '_ga', '_gl', 'hsCtaTracking', 'mkt_tok',
]);

/* ------------------------------------------------------------------ */
/*  Hard-skip URL patterns (never enqueue)                             */
/* ------------------------------------------------------------------ */
const HARD_SKIP_PATTERNS: RegExp[] = [
  /\/(gallery|galleries|photo|photos|video|videos|media)\b/i,
  /\/(blog|blogs|news|newsletter|press)\b/i,
  /\/(wp-content|wp-admin|wp-includes|wp-json)\b/i,
  /\/(cart|checkout|shop|store|product)\b/i,
  /\/(login|signup|register|auth|account)\b/i,
  /\/(cdn-cgi|assets\/img|static\/images)\b/i,
  /\.(jpg|jpeg|png|gif|svg|webp|ico|bmp|mp4|mp3|avi|mov|woff|woff2|eot|ttf|css|js)(\?.*)?$/i,
  /\/(tag|category|archive|page\/\d+)\b/i,
  /\/(feed|rss|atom)\b/i,
  /^javascript:/i,
  /^mailto:/i,
  /^tel:/i,
  /^data:/i,
];

/* ------------------------------------------------------------------ */
/*  Tier classification patterns                                       */
/* ------------------------------------------------------------------ */

/** Tier 0: mandatory disclosure / affiliation docs (highest priority) */
const TIER_0_PATTERNS: RegExp[] = [
  /mandatory[-_]?disclosure/i,
  /mandatory[-_]?public[-_]?disclosure/i,
  /public[-_]?disclosure/i,
  /cbse[-_]?disclosure/i,
  /affiliation[-_]?certificate/i,
  /noc[-_]?certificate/i,
];

/**
 * Tier 1: must-crawl pages that parents care about most.
 * Patterns use \b (word boundary) so keywords match anywhere in the path,
 * e.g. /apl-curriculum, /school-about-us, /our-admissions etc.
 */
const TIER_1_PATTERNS: RegExp[] = [
  /\b(about[-_]?us|aboutus|about)\b/i,
  /\b(admissions?|apply|enrol(?:l?ment)?)\b/i,
  /\b(fees?|fee[-_]?structure)\b/i,
  /\b(contact[-_]?us|contactus|reach[-_]?us|contact)\b/i,
  /\b(safety|mandatory|disclosure)\b/i,
  /\b(faculty|staff|teachers?|principal|leadership|management)\b/i,
  /\b(results?|achievements?|toppers)\b/i,
  /\b(curriculum|academics?|programs?|programmes?|syllabus)\b/i,
];

/**
 * Tier 2: should-crawl pages with useful information.
 * Same \b approach for prefix-tolerant matching.
 */
const TIER_2_PATTERNS: RegExp[] = [
  /\b(infrastructure|facilit(?:y|ies))\b/i,
  /\b(transport|bus|transportation)\b/i,
  /\b(campus|virtual[-_]?tour)\b/i,
  /\b(parents?|pta|ptm)\b/i,
  /\b(cbse|icse|board)\b/i,
  /\b(co[-_]?curricular|extracurricular|sports|activities|clubs)\b/i,
  /\b(calendar|events|notices|circular)\b/i,
  /\b(hostel|boarding|residential)\b/i,
  /\b(alumni|placement)\b/i,
  /\b(framework|vision|mission)\b/i,
];

/* ------------------------------------------------------------------ */
/*  Exports                                                            */
/* ------------------------------------------------------------------ */

/**
 * Canonicalize a URL: lowercase host, preserve path case,
 * strip tracking params, remove fragments, normalize trailing slash.
 */
export function canonicalizeUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    // Remove fragment
    u.hash = '';
    // Strip tracking query params
    for (const key of [...u.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase())) {
        u.searchParams.delete(key);
      }
    }
    // Normalize trailing slash (remove unless root)
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1);
    }
    // Lowercase host only, preserve path case
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname}${u.search}`;
  } catch {
    return rawUrl;
  }
}

/**
 * Returns true if this URL should never be enqueued for crawling.
 */
export function shouldSkipUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const full = u.pathname + u.search;
    return HARD_SKIP_PATTERNS.some((p) => p.test(full)) || HARD_SKIP_PATTERNS.some((p) => p.test(url));
  } catch {
    return true;
  }
}

/**
 * Classify a URL into tier 0-3 based on path keywords.
 * Tier 0 = mandatory disclosure (highest priority)
 * Tier 1 = must-crawl (admissions, fees, about, contact, safety)
 * Tier 2 = should-crawl (infrastructure, transport, sports)
 * Tier 3 = nice-to-have (everything else same-domain)
 */
export function classifyUrlTier(url: string, originHost: string): 0 | 1 | 2 | 3 {
  try {
    const u = new URL(url);
    // Off-domain links are tier 3
    if (u.hostname.toLowerCase() !== originHost.toLowerCase()) return 3;
    const path = u.pathname;

    // Check for tier 0 (mandatory disclosure PDFs/pages)
    if (TIER_0_PATTERNS.some((p) => p.test(path))) return 0;
    if (path.toLowerCase().endsWith('.pdf') && TIER_1_PATTERNS.some((p) => p.test(path))) return 0;
    // Tier 1
    if (TIER_1_PATTERNS.some((p) => p.test(path))) return 1;
    // Tier 2
    if (TIER_2_PATTERNS.some((p) => p.test(path))) return 2;
    // Everything else
    return 3;
  } catch {
    return 3;
  }
}

/** SHA-256 hash of a string, returned as hex. */
export function hashString(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/** Hash a URL for dedup / DB storage. */
export function hashUrl(url: string): string {
  return hashString(canonicalizeUrl(url));
}

/** Fingerprint a fact for idempotent storage. */
export function hashFact(sessionId: string, factKey: string, factValue: string): string {
  return hashString(`${sessionId}:${factKey}:${factValue}`);
}

/* ------------------------------------------------------------------ */
/*  SeenUrls — in-memory dedup tracker for a single crawl session      */
/* ------------------------------------------------------------------ */
export class SeenUrls {
  private seen = new Set<string>();

  /** Add a URL. Returns true if it was new (not seen before). */
  add(url: string): boolean {
    const canonical = canonicalizeUrl(url);
    if (this.seen.has(canonical)) return false;
    this.seen.add(canonical);
    return true;
  }

  has(url: string): boolean {
    return this.seen.has(canonicalizeUrl(url));
  }

  get size(): number {
    return this.seen.size;
  }
}
