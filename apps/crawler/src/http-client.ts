/**
 * HTTP client for Crawler V2
 * - Cheerio-first HTML fetching with per-domain semaphore
 * - Playwright fallback for JS-heavy pages
 * - Sitemap + robots.txt fetching
 * - UA rotation, jitter, 429/403 backoff
 */
import http from 'node:http';
import https from 'node:https';
import axios, { type AxiosInstance, type AxiosResponse } from 'axios';
import * as cheerio from 'cheerio';
import { chromium, type Browser } from 'playwright';

/* ------------------------------------------------------------------ */
/*  User-Agent rotation                                                */
/* ------------------------------------------------------------------ */
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function jitter(baseMs: number): number {
  return baseMs + Math.floor(Math.random() * 400);
}

/* ------------------------------------------------------------------ */
/*  Per-domain concurrency semaphore                                   */
/* ------------------------------------------------------------------ */
const domainSemaphores = new Map<string, { count: number; queue: Array<() => void> }>();
const MAX_CONCURRENT_PER_DOMAIN = 2;

async function acquireDomainSlot(domain: string): Promise<void> {
  let sem = domainSemaphores.get(domain);
  if (!sem) {
    sem = { count: 0, queue: [] };
    domainSemaphores.set(domain, sem);
  }
  if (sem.count < MAX_CONCURRENT_PER_DOMAIN) {
    sem.count++;
    return;
  }
  return new Promise<void>((resolve) => {
    sem!.queue.push(() => {
      sem!.count++;
      resolve();
    });
  });
}

function releaseDomainSlot(domain: string): void {
  const sem = domainSemaphores.get(domain);
  if (!sem) return;
  sem.count--;
  const next = sem.queue.shift();
  if (next) next();
}

/* ------------------------------------------------------------------ */
/*  Shared Axios instance with keep-alive                              */
/* ------------------------------------------------------------------ */
const keepAliveHttpAgent = new http.Agent({ keepAlive: true, maxSockets: 10 });
const keepAliveHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: 10 });

const httpClient: AxiosInstance = axios.create({
  timeout: 15_000,
  maxRedirects: 5,
  headers: {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Accept-Encoding': 'gzip, deflate',
  },
  httpAgent: keepAliveHttpAgent,
  httpsAgent: keepAliveHttpsAgent,
});

/* ------------------------------------------------------------------ */
/*  Cheerio-based HTML fetch                                           */
/* ------------------------------------------------------------------ */

export interface CheerioFetchResult {
  html: string;
  $: cheerio.CheerioAPI;
  contentType: string;
  statusCode: number;
  redirectedUrl?: string;
}

/**
 * Fetch a URL with Cheerio. Handles per-domain concurrency, jitter,
 * and 429/403 backoff with one retry.
 */
export async function fetchWithCheerio(
  url: string,
  timeoutMs = 12_000,
): Promise<CheerioFetchResult> {
  const domain = new URL(url).hostname;
  await acquireDomainSlot(domain);

  try {
    // Jitter to avoid thundering herd
    await new Promise((r) => setTimeout(r, jitter(80)));

    const res: AxiosResponse<string> = await httpClient.get(url, {
      timeout: timeoutMs,
      headers: { 'User-Agent': randomUA() },
      responseType: 'text',
      validateStatus: (s) => s < 500,
    });

    // Handle rate-limit / block with one retry
    if (res.status === 429 || res.status === 403) {
      const retryAfter = parseInt(res.headers['retry-after'] || '3', 10) * 1000;
      await new Promise((r) => setTimeout(r, Math.min(retryAfter, 10_000)));
      const retry: AxiosResponse<string> = await httpClient.get(url, {
        timeout: timeoutMs,
        headers: { 'User-Agent': randomUA() },
        responseType: 'text',
        validateStatus: (s) => s < 500,
      });
      const $ = cheerio.load(retry.data || '');
      return {
        html: retry.data || '',
        $,
        contentType: String(retry.headers['content-type'] || ''),
        statusCode: retry.status,
        redirectedUrl: (retry.request as { res?: { responseUrl?: string } })?.res?.responseUrl,
      };
    }

    const $ = cheerio.load(res.data || '');
    return {
      html: res.data || '',
      $,
      contentType: String(res.headers['content-type'] || ''),
      statusCode: res.status,
      redirectedUrl: (res.request as { res?: { responseUrl?: string } })?.res?.responseUrl,
    };
  } finally {
    releaseDomainSlot(domain);
  }
}

/* ------------------------------------------------------------------ */
/*  Playwright fallback (lazy browser, limited budget)                  */
/* ------------------------------------------------------------------ */
let _browser: Browser | null = null;

async function getPlaywrightBrowser(): Promise<Browser> {
  if (!_browser || !_browser.isConnected()) {
    _browser = await chromium.launch({ headless: true });
  }
  return _browser;
}

export interface PlaywrightFetchResult {
  html: string;
  text: string;
  title: string;
}

/**
 * Fetch a URL with Playwright (headless Chromium).
 * Used as fallback when Cheerio returns very little text.
 */
export async function fetchWithPlaywright(
  url: string,
  timeoutMs = 15_000,
): Promise<PlaywrightFetchResult> {
  const browser = await getPlaywrightBrowser();
  const context = await browser.newContext({
    userAgent: randomUA(),
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  try {
    await page.goto(url, { timeout: timeoutMs, waitUntil: 'domcontentloaded' });
    const title = await page.title();
    const text = await page.locator('body').innerText().catch(() => '');
    const html = await page.content();
    return { html, text, title };
  } finally {
    await page.close();
    await context.close();
  }
}

/** Gracefully close the shared Playwright browser (call on shutdown). */
export async function closePlaywrightBrowser(): Promise<void> {
  if (_browser) {
    await _browser.close().catch(() => {});
    _browser = null;
  }
}

/* ------------------------------------------------------------------ */
/*  HEAD check (for PDF size filtering)                                */
/* ------------------------------------------------------------------ */

export async function headCheck(
  url: string,
  timeoutMs = 5_000,
): Promise<{ contentType: string; contentLength: number; statusCode: number }> {
  const domain = new URL(url).hostname;
  await acquireDomainSlot(domain);
  try {
    const res = await httpClient.head(url, {
      timeout: timeoutMs,
      headers: { 'User-Agent': randomUA() },
      validateStatus: () => true,
    });
    return {
      contentType: String(res.headers['content-type'] || ''),
      contentLength: parseInt(String(res.headers['content-length'] || '0'), 10),
      statusCode: res.status,
    };
  } finally {
    releaseDomainSlot(domain);
  }
}

/* ------------------------------------------------------------------ */
/*  Sitemap + robots.txt                                               */
/* ------------------------------------------------------------------ */

/** Fetch robots.txt and return its text, or null if unavailable. */
export async function fetchRobotsTxt(origin: string): Promise<string | null> {
  try {
    const res = await httpClient.get(`${origin}/robots.txt`, {
      timeout: 5_000,
      headers: { 'User-Agent': randomUA() },
      responseType: 'text',
      validateStatus: (s) => s === 200,
    });
    return (res.data as string) || null;
  } catch {
    return null;
  }
}

/**
 * Extract sitemap URLs from robots.txt Sitemap: directives,
 * then fetch and parse sitemaps for <loc> URLs.
 */
export async function fetchSitemapUrls(origin: string): Promise<string[]> {
  const urls: string[] = [];
  const sitemapLocations: string[] = [];

  // Check robots.txt for Sitemap: directives
  const robotsTxt = await fetchRobotsTxt(origin);
  if (robotsTxt) {
    const sitemapMatches = robotsTxt.matchAll(/^Sitemap:\s*(.+)$/gim);
    for (const m of sitemapMatches) {
      if (m[1]) sitemapLocations.push(m[1].trim());
    }
  }

  // Fallback: try common sitemap locations
  if (sitemapLocations.length === 0) {
    sitemapLocations.push(
      `${origin}/sitemap.xml`,
      `${origin}/sitemap_index.xml`,
    );
  }

  // Fetch each sitemap and extract <loc> URLs
  for (const sitemapUrl of sitemapLocations.slice(0, 3)) {
    try {
      const res = await httpClient.get(sitemapUrl, {
        timeout: 8_000,
        headers: { 'User-Agent': randomUA() },
        responseType: 'text',
        validateStatus: (s) => s === 200,
      });
      const xml = (res.data as string) || '';
      const locMatches = xml.matchAll(/<loc>(.*?)<\/loc>/gi);
      for (const m of locMatches) {
        if (m[1]) urls.push(m[1].trim());
      }
      if (urls.length > 0) break; // Found URLs, stop trying other sitemaps
    } catch {
      continue;
    }
  }

  return urls;
}
