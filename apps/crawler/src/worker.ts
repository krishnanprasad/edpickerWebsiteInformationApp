/**
 * SchoolLens Crawler V2 — Workers
 *
 * 3-stage BullMQ pipeline: classify → crawl → score
 *
 * V2 crawl improvements:
 * - Cheerio-first HTML fetching (fast, low resource)
 * - Playwright fallback with 5-page hard budget
 * - Two-stage crawl: Discovery → Extraction
 * - URL canonicalization + skip lists + tier prioritization
 * - Per-page fact extraction with fingerprint dedup
 * - SSE real-time streaming via Redis
 * - Quality-based early stop
 * - Heartbeat for stall detection
 */
import 'dotenv/config';
import axios from 'axios';
import { Queue, Worker } from 'bullmq';
import http from 'node:http';
import { Redis as IORedisClient } from 'ioredis';

import {
  canonicalizeUrl, shouldSkipUrl, classifyUrlTier,
  hashUrl, SeenUrls,
} from './url-utils.js';
import { extractVisionMissionMotto } from './vm-extractor.js';

import {
  fetchWithCheerio, fetchWithPlaywright, closePlaywrightBrowser,
  fetchSitemapUrls, headCheck,
  type CheerioFetchResult,
} from './http-client.js';

import { emitEvent, emitTerminalEvent, closeSseClient } from './sse.js';

/* ------------------------------------------------------------------ */
/*  Configuration                                                      */
/* ------------------------------------------------------------------ */

function resolveRedisUrl(): string {
  const isLocal = process.env.IS_LOCAL === '1';
  const localUrl = process.env.REDIS_URL_LOCAL || process.env.REDIS_URL;
  const cloudUrl = process.env.REDIS_URL_CLOUD || process.env.REDIS_URL;
  const url = isLocal ? (localUrl || cloudUrl) : (cloudUrl || localUrl);
  if (!url) {
    console.error('[BOOT][REDIS] Missing REDIS URL. Set REDIS_URL_LOCAL / REDIS_URL_CLOUD and IS_LOCAL.');
    return 'redis://127.0.0.1:6379';
  }
  return url;
}

function buildRedisConnection(): { host: string; port: number; username?: string; password?: string; tls?: Record<string, unknown>; maxRetriesPerRequest: null; enableReadyCheck: boolean } {
  const raw = resolveRedisUrl();
  try {
    const parsed = new URL(raw);
    const isTls = parsed.protocol === 'rediss:';
    const conn = {
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 6379,
      username: decodeURIComponent(parsed.username || 'default'),
      password: decodeURIComponent(parsed.password || ''),
      tls: isTls ? {} as Record<string, unknown> : undefined,
      maxRetriesPerRequest: null as null,
      enableReadyCheck: true,
    };
    console.log(`[BOOT][REDIS] Parsed connection: host=${conn.host} port=${conn.port} tls=${isTls}`);
    return conn;
  } catch (err) {
    console.error('[BOOT][REDIS] Failed to parse URL:', err instanceof Error ? err.message : err);
    return { host: '127.0.0.1', port: 6379, maxRetriesPerRequest: null, enableReadyCheck: true };
  }
}

console.log('[BOOT] Worker module loading — commit c0cff63+fix');
const redisConnection = buildRedisConnection();

const apiBaseUrl = process.env.CRAWLER_API_BASE_URL ?? 'http://localhost:3000';
const internalApiKey = process.env.INTERNAL_API_KEY ?? 'change-me';
const openAiApiKey = process.env.OPENAI_API_KEY ?? '';
const openAiBaseUrl = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
const scoringModel = process.env.OPENAI_MODEL_SCORING ?? 'gpt-4o-mini';
const classifyQueueName = process.env.CLASSIFY_QUEUE_NAME || 'schoollens-classify';
const crawlQueueName = process.env.CRAWLER_QUEUE_NAME || 'schoollens-crawl';
const scoringQueueName = process.env.SCORING_QUEUE_NAME || 'schoollens-score';

const PLAYWRIGHT_HARD_BUDGET = Number(process.env.PLAYWRIGHT_BUDGET ?? 5);
const CHEERIO_MIN_TEXT_LENGTH = 500;
const HEARTBEAT_INTERVAL_MS = 10_000;
const WORKER_PORT = Number(process.env.PORT || 8080);

http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('ok');
}).listen(WORKER_PORT, () => {
  console.log(`Worker health server listening on ${WORKER_PORT}`);
});

function maskConnectionString(value?: string): string {
  if (!value) return '(missing)';
  try {
    const parsed = new URL(value);
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return '(invalid-url)';
  }
}

/* ------------------------------------------------------------------ */
/*  Education keywords + categories (for classification)               */
/* ------------------------------------------------------------------ */

const EDUCATION_KEYWORDS = [
  'school', 'academy', 'institute', 'college', 'university', 'vidyalaya', 'convent',
  'cbse', 'icse', 'matric', 'cambridge', 'igcse',
  'international baccalaureate', 'ib ', 'ib-pyp', 'ib-myp', 'ib-dp',
  'kindergarten', 'montessori', 'nursery', 'pre-school', 'preschool', 'early years',
  'campus', 'principal', 'headmaster', 'headmistress', 'faculty', 'teacher', 'educator',
  'admission', 'admissions', 'enrollment', 'enrolment', 'students', 'curriculum', 'syllabus', 'academic',
  'exam', 'education', 'diploma', 'learning', 'classroom',
  'tuition', 'boarding', 'residential school', 'co-curricular', 'extracurricular',
];

const EDUCATION_CATEGORIES: { name: string; terms: string[] }[] = [
  { name: 'institution', terms: ['school', 'academy', 'institute', 'college', 'university', 'vidyalaya', 'convent'] },
  { name: 'board', terms: ['cbse', 'icse', 'matric', 'cambridge', 'igcse', 'international baccalaureate', 'ib ', 'ib-pyp', 'ib-myp', 'ib-dp'] },
  { name: 'early-years', terms: ['kindergarten', 'montessori', 'nursery', 'pre-school', 'preschool', 'early years'] },
  { name: 'people', terms: ['campus', 'principal', 'headmaster', 'headmistress', 'faculty', 'teacher', 'educator'] },
  { name: 'academics', terms: ['admission', 'admissions', 'enrollment', 'enrolment', 'students', 'curriculum', 'syllabus', 'academic', 'exam', 'education', 'diploma', 'learning', 'classroom'] },
  { name: 'extras', terms: ['tuition', 'boarding', 'residential school', 'co-curricular', 'extracurricular'] },
];

const EDUCATION_CONFIDENCE_THRESHOLD = Number(process.env.EDUCATION_CONFIDENCE_THRESHOLD ?? 40);

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function post(path: string, body: Record<string, unknown>, timeout = 20_000) {
  return axios.post(`${apiBaseUrl}${path}`, body, {
    headers: { 'X-Internal-Key': internalApiKey },
    timeout,
  });
}

async function runStartupDiagnostics() {
  const startedAt = Date.now();
  const redisUrl = resolveRedisUrl();

  console.log('[DIAG] ===== Startup Diagnostics =====');
  console.log('[DIAG][ENV]', {
    node: process.version,
    port: WORKER_PORT,
    isLocal: process.env.IS_LOCAL,
    apiBaseUrl,
    redisUrl: maskConnectionString(redisUrl),
    hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
    hasPostgresHost: Boolean(process.env.POSTGRES_HOST),
  });

  try {
    const healthUrl = `${apiBaseUrl.replace(/\/+$/, '')}/health`;
    const response = await axios.get(healthUrl, { timeout: 8_000 });
    console.log(`[DIAG][API] OK status=${response.status} url=${healthUrl}`);
  } catch (error) {
    console.error('[DIAG][API] FAIL', error instanceof Error ? error.message : error);
  }

  try {
    const client = new IORedisClient(redisUrl, {
      lazyConnect: true,
      connectTimeout: 8_000,
      maxRetriesPerRequest: 1,
    });

    await client.connect();
    const ping = await client.ping();
    const key = `diag:worker:${Date.now()}`;
    await client.set(key, 'ok', 'EX', 30);
    const value = await client.get(key);
    await client.quit();
    console.log(`[DIAG][REDIS] OK ping=${ping} setGet=${value}`);
  } catch (error) {
    console.error('[DIAG][REDIS] FAIL', error instanceof Error ? error.message : error);
  }

  try {
    const databaseUrl = process.env.DATABASE_URL;
    if (databaseUrl) {
      // @ts-ignore - pg types not installed
      const pg = await import('pg') as any;
      const PgClient = pg.default?.Client ?? pg.Client;
      const client = new PgClient({
        connectionString: databaseUrl,
        connectionTimeoutMillis: 8_000,
      });

      await client.connect();
      const result = await client.query('select 1 as ok');
      await client.end();
      console.log(`[DIAG][POSTGRES] OK select1=${result.rows?.[0]?.ok}`);
    } else {
      const pgHost = process.env.POSTGRES_HOST;
      const pgPort = process.env.POSTGRES_PORT ?? '5432';
      const pgDb = process.env.POSTGRES_DB;
      const pgUser = process.env.POSTGRES_USER;
      const pgPassword = process.env.POSTGRES_PASSWORD;
      const pgSslMode = process.env.POSTGRES_SSLMODE ?? 'disable';

      if (!pgHost || !pgDb || !pgUser || !pgPassword) {
        console.warn('[DIAG][POSTGRES] SKIP missing DATABASE_URL and one or more POSTGRES_* vars');
      } else {
        // @ts-ignore - pg types not installed
        const pg = await import('pg') as any;
        const PgClient = pg.default?.Client ?? pg.Client;
        const client = new PgClient({
          connectionString: `postgresql://${pgUser}:${pgPassword}@${pgHost}:${pgPort}/${pgDb}?sslmode=${pgSslMode}`,
          connectionTimeoutMillis: 8_000,
        });
        await client.connect();
        const result = await client.query('select 1 as ok');
        await client.end();
        console.log(`[DIAG][POSTGRES] OK select1=${result.rows?.[0]?.ok}`);
      }
    }
  } catch (error) {
    console.error('[DIAG][POSTGRES] FAIL', error instanceof Error ? error.message : error);
  }

  console.log(`[DIAG] ===== Completed in ${Date.now() - startedAt}ms =====`);
}

/**
 * Extract clean text content from a Cheerio document.
 * Removes script, style, noscript, svg, and other non-content elements.
 */
function extractCleanText($: import('cheerio').CheerioAPI): string {
  // Clone the body to avoid modifying the original
  const $body = $('body').clone();
  
  // Remove script, style, noscript, svg, iframe, canvas, and other non-content elements
  $body.find('script, style, noscript, svg, iframe, canvas, template, [hidden], .sr-only, link[rel="stylesheet"]').remove();
  
  // Get text and clean it up
  let text = $body.text();
  
  // Remove any remaining inline JS/CSS patterns
  text = text
    // Remove :root blocks and CSS variables
    .replace(/:root\s*\{[\s\S]*?\}/gi, ' ')
    .replace(/--[\w-]+:\s*[^;]+;/g, ' ')
    .replace(/--wp[\w-]*:[^;]+;?/gi, ' ')
    // Remove var declarations
    .replace(/\bvar\s+[\w_]+\s*=\s*[^;]*;?/gi, ' ')
    // Remove function declarations and IIFEs
    .replace(/\bfunction\s*\([^)]*\)\s*\{[\s\S]*?\}/gi, ' ')
    .replace(/\(\s*function[\s\S]*?\}\s*\)\s*\(\s*\)/gi, ' ')
    // Remove common JS objects and methods
    .replace(/sessionStorage\.[^;]+;?/gi, ' ')
    .replace(/localStorage\.[^;]+;?/gi, ' ')
    .replace(/document\.\w+\s*[=\(][^;]+;?/gi, ' ')
    .replace(/Object\.defineProperty[\s\S]*?;/gi, ' ')
    .replace(/window\.\w+\s*[=\(][^;]+;?/gi, ' ')
    // Remove WordPress/LiteSpeed specific patterns
    .replace(/litespeed[\w_]*[\s\S]*?;/gi, ' ')
    .replace(/wp--preset[\w-]*:[^;]+;?/gi, ' ')
    // Remove CSS selectors
    .replace(/\.[a-z][\w-]*\s*\{[^}]*\}/gi, ' ')
    .replace(/\.\w+:before\s*\{[^}]*\}/gi, ' ')
    // Remove hex colors and rgba
    .replace(/#[0-9a-f]{3,8}\b/gi, ' ')
    .replace(/rgba?\s*\([^)]+\)/gi, ' ')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();
  
  return text;
}

/**
 * Check if text appears to be garbage (JS/CSS instead of real content).
 * Returns true if the text seems to be mostly code/CSS.
 */
function isGarbageText(text: string): boolean {
  if (text.length < 100) return true;
  
  // Count indicators of garbage
  const cssVarCount = (text.match(/--[\w-]+:/g) || []).length;
  const jsVarCount = (text.match(/\bvar\s+\w+\s*=/g) || []).length;
  const functionCount = (text.match(/\bfunction\s*\(/g) || []).length;
  const hexColorCount = (text.match(/#[0-9a-f]{3,8}\b/gi) || []).length;
  
  // More than a few of these = garbage
  if (cssVarCount > 5 || jsVarCount > 3 || functionCount > 3 || hexColorCount > 10) {
    return true;
  }
  
  // Check alphabetic ratio - real content has more letters than symbols
  const alphaCount = (text.match(/[a-zA-Z]/g) || []).length;
  const alphaRatio = alphaCount / text.length;
  
  if (alphaRatio < 0.4) return true;
  
  // Check for common education words - if none present after 500 chars, suspicious
  if (text.length > 500) {
    const hasSchoolWords = /\b(school|student|teacher|class|grade|admission|fee|campus|education|learn|principal|staff|academic|curriculum)\b/i.test(text);
    if (!hasSchoolWords) return true;
  }
  
  return false;
}

/* ------------------------------------------------------------------ */
/*  OpenAI helper                                                      */
/* ------------------------------------------------------------------ */

async function callOpenAiJson(systemPrompt: string, userPrompt: string, maxTokens = 800): Promise<Record<string, unknown> | null> {
  if (!openAiApiKey) return null;
  try {
    const res = await axios.post(
      `${openAiBaseUrl.replace(/\/+$/, '')}/chat/completions`,
      {
        model: scoringModel,
        temperature: 0,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${openAiApiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 60_000,
      },
    );
    const content = res.data?.choices?.[0]?.message?.content;
    return content ? JSON.parse(content) : null;
  } catch (err) {
    console.error('OpenAI call failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/* ================================================================== */
/*  WORKER 1 — Classification (unchanged from V1)                     */
/* ================================================================== */

function buildRejectionReasons(matched: string[], _confidence: number, fetchFailed: boolean): string[] {
  const reasons: string[] = [];

  if (fetchFailed) {
    reasons.push('We were unable to fully load this website — it may use heavy animations, pop-ups, or require JavaScript to display content.');
  }

  if (matched.length === 0) {
    reasons.push('We could not find any school-related terms (like "school", "campus", "admissions", "curriculum") on this website.');
  } else {
    reasons.push(`We found only ${matched.length} educational indicator(s): ${matched.slice(0, 5).join(', ')}. Most verified school websites show many more.`);
  }

  const missing: string[] = [];
  const coreTerms = ['school', 'academy', 'institute', 'college', 'university'];
  if (!coreTerms.some((t) => matched.includes(t))) missing.push('school name or institution type');
  const boardTerms = ['cbse', 'icse', 'matric', 'cambridge', 'igcse', 'international baccalaureate', 'ib '];
  if (!boardTerms.some((t) => matched.includes(t))) missing.push('board affiliation (CBSE, ICSE, IB, Cambridge)');
  if (!matched.includes('admissions') && !matched.includes('enrollment') && !matched.includes('admission') && !matched.includes('enrolment')) missing.push('admissions or enrollment information');
  if (!matched.includes('curriculum') && !matched.includes('syllabus') && !matched.includes('academic')) missing.push('curriculum or academic details');
  if (!matched.includes('campus') && !matched.includes('classroom')) missing.push('campus or facility information');

  if (missing.length > 0) {
    reasons.push(`Key information we could not find on this site: ${missing.join(', ')}.`);
  }

  reasons.push('This may be a business website, a non-educational portal, or a school site that loads content dynamically.');
  reasons.push('If you believe this is a real school, the website may need improvements in how it presents educational content.');

  return reasons.slice(0, 5);
}

async function classifyUrl(url: string): Promise<{
  isEducational: boolean;
  confidence: number;
  matchedKeywords: string[];
  missingIndicators: string[];
  rejectionReasons: string[];
  extractedText: string;
}> {
  let bodyText = '';
  let metaDescription = '';
  let pageTitle = '';
  let hrefText = '';
  let fetchFailed = false;

  try {
    let html = '';
    for (const attemptTimeout of [20_000, 30_000]) {
      try {
        const res = await axios.get(url, {
          timeout: attemptTimeout,
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
          maxRedirects: 5,
          responseType: 'text',
        });
        html = res.data ?? '';
        break;
      } catch (retryErr) {
        console.warn(`Classification fetch attempt (${attemptTimeout}ms) failed:`, retryErr instanceof Error ? retryErr.message : retryErr);
        if (attemptTimeout === 30_000) throw retryErr;
      }
    }

    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    pageTitle = titleMatch?.[1]?.trim() ?? '';
    const metaMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([\s\S]*?)["']/i);
    metaDescription = metaMatch?.[1]?.trim() ?? '';
    const hrefs = html.match(/href=["']([^"']*)["']/gi) ?? [];
    hrefText = hrefs.join(' ');
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const rawBody = bodyMatch?.[1] ?? html;
    bodyText = rawBody
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  } catch (err) {
    fetchFailed = true;
    console.error('Classification fetch failed:', err instanceof Error ? err.message : err);
  }

  const hasThinText = bodyText.trim().length < 80;
  if (hasThinText) {
    try {
      // Many modern school sites are JS-heavy SPAs; render once before rejecting.
      const pw = await fetchWithPlaywright(url, 25_000);
      if (pw.title?.trim()) pageTitle = pw.title.trim();
      if (pw.text?.trim()) bodyText = pw.text.trim();
      if (pw.html) {
        const hrefs = pw.html.match(/href=["']([^"']*)["']/gi) ?? [];
        hrefText = `${hrefText} ${hrefs.join(' ')}`.trim();
      }
      fetchFailed = false;
      console.log(`[CLASSIFY] Playwright fallback used for ${url} (textLen=${bodyText.length})`);
    } catch (pwErr) {
      console.warn('[CLASSIFY] Playwright fallback failed:', pwErr instanceof Error ? pwErr.message : pwErr);
    }
  }

  const combined = `${pageTitle} ${metaDescription} ${bodyText} ${hrefText}`.toLowerCase();
  const matched = EDUCATION_KEYWORDS.filter((kw) => combined.includes(kw));

  const matchedCats = EDUCATION_CATEGORIES.filter((cat) => cat.terms.some((t) => matched.includes(t)));
  const categoryScore = Math.round((matchedCats.length / EDUCATION_CATEGORIES.length) * 100);
  const keywordBonus = Math.max(0, (matched.length - 5) * 2);
  const confidence = Math.min(categoryScore + keywordBonus, 100);

  const hasCoreInstitution = ['school', 'academy', 'institute', 'college', 'university', 'vidyalaya', 'convent'].some((t) => matched.includes(t));
  const hasBoardTerm = ['cbse', 'icse', 'matric', 'cambridge', 'igcse', 'international baccalaureate', 'ib '].some((t) => matched.includes(t));
  const isEducational = (hasCoreInstitution && hasBoardTerm && matched.length >= 5) || confidence >= EDUCATION_CONFIDENCE_THRESHOLD;

  const missingIndicators: string[] = [];
  if (!['school', 'academy', 'institute', 'college', 'university'].some((t) => matched.includes(t))) missingIndicators.push('Institution identity');
  if (!['cbse', 'icse', 'matric', 'cambridge', 'igcse', 'international baccalaureate', 'ib '].some((t) => matched.includes(t))) missingIndicators.push('Board affiliation');
  if (!matched.includes('admissions') && !matched.includes('enrollment') && !matched.includes('admission') && !matched.includes('enrolment')) missingIndicators.push('Admissions info');
  if (!matched.includes('curriculum') && !matched.includes('syllabus') && !matched.includes('academic')) missingIndicators.push('Academic details');
  if (!matched.includes('campus') && !matched.includes('classroom')) missingIndicators.push('Campus details');

  const rejectionReasons = isEducational ? [] : buildRejectionReasons(matched, confidence, fetchFailed);

  return { isEducational, confidence, matchedKeywords: matched, missingIndicators, rejectionReasons, extractedText: combined.slice(0, 5000) };
}

const classifyWorker = new Worker(
  classifyQueueName,
  async (job) => {
    const { sessionId, url, maxPages } = job.data as { sessionId: string; url: string; maxPages: number };
    const result = await classifyUrl(url);
    await post('/internal/classify-result', {
      sessionId, url, maxPages,
      isEducational: result.isEducational,
      confidence: result.confidence,
      matchedKeywords: result.matchedKeywords,
      missingIndicators: result.missingIndicators,
      rejectionReasons: result.rejectionReasons,
    });
  },
  { connection: redisConnection },
);

/* ================================================================== */
/*  WORKER 2 — Crawl V2 (Cheerio-first, two-stage, SSE streaming)    */
/* ================================================================== */

interface PageEntry { url: string; title: string; text: string }

interface CrawlFact {
  key: string;
  value: string;
  confidence: number;
  sourceUrl: string;
  sourceType: string;
  evidence?: string;
}

/* ------------------------------------------------------------------ */
/*  Fact extraction patterns                                           */
/* ------------------------------------------------------------------ */

const SAFETY_PATTERNS: { key: string; patterns: string[]; relatedTerms: string[] }[] = [
  { key: 'fire_certificate', patterns: ['fire certificate', 'fire noc', 'fire safety', 'fire extinguisher', 'fire drill'], relatedTerms: ['fire'] },
  { key: 'sanitary_certificate', patterns: ['sanitary certificate', 'health certificate', 'sanitation', 'hygiene certificate'], relatedTerms: ['sanitary', 'hygiene'] },
  { key: 'cctv_mention', patterns: ['cctv', 'surveillance', 'security camera', 'monitoring system'], relatedTerms: ['security'] },
  { key: 'transport_safety', patterns: ['transport safety', 'bus safety', 'gps tracking', 'school bus', 'school transport'], relatedTerms: ['transport', 'bus'] },
  { key: 'anti_bullying_policy', patterns: ['anti-bullying', 'anti bullying', 'bullying policy', 'discipline policy', 'harassment policy'], relatedTerms: ['bullying', 'discipline'] },
];

const CLARITY_PATTERNS: { key: string; check: (text: string) => boolean }[] = [
  { key: 'admission_dates_visible', check: (t) => t.includes('admission') && /\d{1,2}[\s/\-]\w+[\s/\-]\d{2,4}/.test(t) },
  { key: 'fee_clarity', check: (t) => t.includes('fee') && /₹|rs\.?|inr|\d{3,}/i.test(t) },
  { key: 'academic_calendar', check: (t) => /academic calendar|term dates|session \d{4}/i.test(t) },
  { key: 'contact_and_map', check: (t) => (t.includes('contact') || t.includes('phone')) && /\d{10}|\d{3}[\s-]\d{3,4}[\s-]\d{4}/.test(t) },
  { key: 'results_published', check: (t) => /results|pass percentage|board results|toppers/i.test(t) },
];

function extractFacts(text: string, sourceUrl: string, sourceType: string): CrawlFact[] {
  const facts: CrawlFact[] = [];
  const lowerText = text.toLowerCase();

  for (const { key, patterns, relatedTerms } of SAFETY_PATTERNS) {
    const exactMatch = patterns.some((p) => lowerText.includes(p));
    const partialMatch = relatedTerms.some((p) => lowerText.includes(p));

    if (exactMatch) {
      let evidence: string | undefined;
      for (const p of patterns) {
        const idx = lowerText.indexOf(p);
        if (idx >= 0) {
          const start = Math.max(0, idx - 20);
          const end = Math.min(text.length, idx + p.length + 80);
          evidence = text.slice(start, end).trim();
          break;
        }
      }
      facts.push({ key, value: 'found', confidence: 0.85, sourceUrl, sourceType, evidence });
    } else if (partialMatch) {
      facts.push({ key, value: 'unclear', confidence: 0.4, sourceUrl, sourceType });
    }
  }

  for (const { key, check } of CLARITY_PATTERNS) {
    if (check(lowerText)) {
      facts.push({ key, value: 'true', confidence: 0.8, sourceUrl, sourceType });
    }
  }

  return facts;
}

/* ------------------------------------------------------------------ */
/*  Early identity extraction (Cheerio-based)                          */
/* ------------------------------------------------------------------ */

interface EarlyIdentity {
  schoolName?: string;
  principalName?: string;
  foundingYear?: string;
  vision?: string;
  mission?: string;
  motto?: string;
  visionConfidence?: 'high' | 'medium' | 'low';
  missionConfidence?: 'high' | 'medium' | 'low';
  mottoConfidence?: 'high' | 'medium' | 'low';
  socialUrls?: Record<string, string>;
  phone?: string;
  email?: string;
  address?: string;
}

function extractIdentity($: import('cheerio').CheerioAPI, _html: string, _url: string): EarlyIdentity {
  const identity: EarlyIdentity = {};

  // Helper to clean school names from common junk
  const cleanSchoolName = (name: string): string => {
    if (!name) return '';
    return name
      // Remove common prefixes
      .replace(/^(Homepage?\s*[-–—]\s*|Home\s*[-–—]\s*|Welcome\s+to\s+)/i, '')
      // Fix concatenated board names (e.g., "CBSESharp" -> "")
      .replace(/(CBSE|ICSE|IB|IGCSE)([A-Z][a-z])/g, '$1 $2')
      // Remove chat widget and third-party tool suffixes
      .replace(/\s*(Sharp\s*(AI)?\s*(Chat)?\s*(Widget)?|Chat\s+Widget|Chatbot|Live\s+Chat|WhatsApp\s+Chat).*$/i, '')
      // Remove marketing suffixes
      .replace(/\s*[-–—|:]\s*(home|welcome|official|website|homepage|main|best|top|leading|premier|no\.?\s*1|#1).*$/i, '')
      .replace(/,\s*(best|top|leading|premier|#1).*$/i, '')
      // Clean up
      .replace(/\s{2,}/g, ' ')
      .replace(/[-–—,|:]+$/, '')
      .trim();
  };

  // Helper to check if name looks like a proper school name (not just abbreviation)
  const isProperSchoolName = (name: string): boolean => {
    if (!name || name.length < 5) return false;
    // Must contain "school" type indicator and be reasonably long
    const hasSchoolWord = /\b(school|academy|vidyalaya|college|institute|convent|mandir|secondary|matriculation|public)\b/i.test(name);
    // Short abbreviations like "KSN" are NOT proper names
    const isAbbreviation = /^[A-Z.\s]{2,10}$/.test(name.trim());
    return hasSchoolWord && !isAbbreviation && name.length > 10;
  };

  // Collect all potential school names with their source priority
  const candidates: Array<{ name: string; priority: number; source: string }> = [];

  // Source 1: Header/banner area headings (H1-H3)
  $('header h1, header h2, .header h1, .header h2, .logo-text, .site-title, .school-name, .brand').each((_, el) => {
    const text = $(el).text().trim();
    const cleaned = cleanSchoolName(text);
    if (cleaned.length > 3) {
      candidates.push({ name: cleaned, priority: isProperSchoolName(cleaned) ? 1 : 5, source: 'header' });
    }
  });

  // Source 2: All H1 elements
  $('h1').each((_, el) => {
    const text = $(el).text().trim();
    const cleaned = cleanSchoolName(text);
    if (cleaned.length > 3 && cleaned.length < 150) {
      candidates.push({ name: cleaned, priority: isProperSchoolName(cleaned) ? 2 : 6, source: 'h1' });
    }
  });

  // Source 3: H2 elements that look like school names
  $('h2').each((_, el) => {
    const text = $(el).text().trim();
    const cleaned = cleanSchoolName(text);
    if (isProperSchoolName(cleaned) && cleaned.length < 150) {
      candidates.push({ name: cleaned, priority: 3, source: 'h2' });
    }
  });

  // Source 4: og:site_name
  const ogSiteName = $('meta[property="og:site_name"]').attr('content')?.trim();
  if (ogSiteName) {
    const cleaned = cleanSchoolName(ogSiteName);
    candidates.push({ name: cleaned, priority: isProperSchoolName(cleaned) ? 2 : 7, source: 'og:site_name' });
  }

  // Source 5: og:title
  const ogTitle = $('meta[property="og:title"]').attr('content')?.trim();
  if (ogTitle) {
    const cleaned = cleanSchoolName(ogTitle);
    candidates.push({ name: cleaned, priority: isProperSchoolName(cleaned) ? 3 : 8, source: 'og:title' });
  }

  // Source 6: Title tag
  const pageTitle = $('title').text().trim();
  if (pageTitle) {
    const cleaned = cleanSchoolName(pageTitle);
    candidates.push({ name: cleaned, priority: isProperSchoolName(cleaned) ? 4 : 9, source: 'title' });
  }

  // Source 7: Alt text of logo images
  $('img[alt]').each((_, el) => {
    const alt = $(el).attr('alt')?.trim() || '';
    const cleaned = cleanSchoolName(alt);
    if (isProperSchoolName(cleaned) && cleaned.length < 150) {
      candidates.push({ name: cleaned, priority: 4, source: 'logo-alt' });
    }
  });

  // Sort by priority (lower is better) and pick the best one
  candidates.sort((a, b) => a.priority - b.priority);
  
  // Debug: log candidates for troubleshooting
  // console.log('School name candidates:', candidates.slice(0, 5));

  if (candidates.length > 0) {
    identity.schoolName = candidates[0].name.slice(0, 120);
  }

  const socialUrls: Record<string, string> = {};
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const lower = href.toLowerCase();
    if (lower.includes('facebook.com') && !socialUrls.facebook) socialUrls.facebook = href;
    else if (lower.includes('instagram.com') && !socialUrls.instagram) socialUrls.instagram = href;
    else if ((lower.includes('youtube.com') || lower.includes('youtu.be')) && !socialUrls.youtube) socialUrls.youtube = href;
    else if ((lower.includes('twitter.com') || lower.includes('x.com')) && !socialUrls.twitter) socialUrls.twitter = href;
    else if (lower.includes('linkedin.com') && !socialUrls.linkedin) socialUrls.linkedin = href;
  });
  if (Object.keys(socialUrls).length > 0) identity.socialUrls = socialUrls;

  const bodyText = extractCleanText($);

  /* -- Principal extraction (honorific REQUIRED to avoid false positives) -- */
  const HONORIFIC = `(?:Mr\\.?|Mrs\\.?|Ms\\.?|Dr\\.?|Shri\\.?|Smt\\.?|Prof\\.?|Sri\\.?|Thiru\\.?)`;
  // Name part allows initials like "R." and multi-word names
  const NAME_PART = `${HONORIFIC}\\s+([A-Z](?:[a-z]+|\\.)?(?:\\s+[A-Z](?:[a-z]+|\\.)?){0,4})`;
  const principalPatterns = [
    // "Principal: Mrs. R. Kalaivani" or "Principal - Dr. Ramesh Kumar"
    new RegExp(`(?:principal|head\\s+(?:of\\s+)?school|headmaster|headmistress|director|chairman|chairperson)\\s*(?:[:,\\-–]|is|name)?\\s*${NAME_PART}`, 'i'),
    // "Mrs. R. Kalaivani, Principal"
    new RegExp(`${NAME_PART}\\s*,?\\s*(?:principal|head\\s+(?:of\\s+)?school|headmaster|headmistress|director)`, 'i'),
  ];
  for (const pat of principalPatterns) {
    const m = bodyText.match(pat);
    if (m?.[1]) {
      const candidateName = m[1].trim().replace(/\s+/g, ' ');
      // Reject if the "name" is clearly a school/org name (contains school indicators)
      if (!/\b(school|academy|vidya|mandhir|mandir|college|institute|foundation)\b/i.test(candidateName)) {
        identity.principalName = candidateName.slice(0, 80);
        break;
      }
    }
  }

  // Fallback: "NAME, Principal" or "NAME Principal" without honorific (capitalized words only)
  if (!identity.principalName) {
    const noHonorificPatterns = [
      // "RAJA SUNDARI N, Principal" or "Ramesh Kumar, Principal"
      /([A-Z][A-Za-z.]+(?:\s+[A-Z][A-Za-z.]*){0,4})\s*,?\s*(?:principal|head\s+(?:of\s+)?school|headmaster|headmistress)\b/i,
      // "Principal: RAJA SUNDARI N" / "Principal - Ramesh Kumar"
      /(?:principal|head\s+(?:of\s+)?school|headmaster|headmistress)\s*[:.–\-,]?\s*([A-Z][A-Za-z.]+(?:\s+[A-Z][A-Za-z.]*){0,4})/,
    ];
    for (const pat of noHonorificPatterns) {
      const m = bodyText.match(pat);
      if (m?.[1]) {
        const candidateName = m[1].trim().replace(/\s+/g, ' ');
        if (candidateName.length >= 4 && candidateName.length <= 60
            && !/\b(school|academy|vidya|mandhir|mandir|college|institute|foundation|desk|message|welcome)\b/i.test(candidateName)) {
          identity.principalName = candidateName.slice(0, 80);
          break;
        }
      }
    }
  }

  // DOM-based: heading near "Principal" heading/text (for structured pages)
  if (!identity.principalName) {
    $('h1, h2, h3, h4, h5, strong, b').each((_, el) => {
      if (identity.principalName) return;
      const text = $(el).text().trim();
      if (/^principal/i.test(text) && text.length < 40) {
        // The adjacent heading or next sibling might be the name
        const prev = $(el).prev('h1, h2, h3, h4, h5, strong, b, p').text().trim().replace(/\s+/g, ' ');
        const next = $(el).next('h1, h2, h3, h4, h5, strong, b, p').text().trim().replace(/\s+/g, ' ');
        for (const candidate of [prev, next]) {
          if (!candidate || candidate.length < 3 || candidate.length > 60) continue;
          if (/\b(school|academy|vidya|college|institute|foundation|desk|message|welcome|phone|email|address)\b/i.test(candidate)) continue;
          // Must look like a name: capitalized words, no long sentences
          if (/^[A-Z][A-Za-z.]+(?:\s+[A-Z][A-Za-z.]*){0,4},?$/.test(candidate.replace(/,\s*$/, ''))) {
            identity.principalName = candidate.replace(/,\s*$/, '').slice(0, 80);
            return;
          }
        }
      }
    });
  }

  /* -- Phone extraction -- */
  // First: tel: links
  const telLink = $('a[href^="tel:"]').first().attr('href');
  if (telLink) {
    identity.phone = telLink.replace('tel:', '').replace(/\s+/g, '').trim();
  }
  if (!identity.phone) {
    // Indian phone patterns: +91-xxx, 0xxx-xxxxxxx, 10-digit mobile
    const phonePatterns = [
      /(?:phone|tel|call|contact|mob(?:ile)?)\s*(?:no\.?|number|#)?\s*[:.\-–]?\s*(\+?91[\s\-]?\d[\d\s\-]{8,12}\d)/i,
      /(?:phone|tel|call|contact|mob(?:ile)?)\s*(?:no\.?|number|#)?\s*[:.\-–]?\s*(0\d{2,4}[\s\-]?\d{6,8})/i,
      /(?:phone|tel|call|contact|mob(?:ile)?)\s*(?:no\.?|number|#)?\s*[:.\-–]?\s*(\d{10})/i,
    ];
    for (const pat of phonePatterns) {
      const m = bodyText.match(pat);
      if (m?.[1]) {
        identity.phone = m[1].replace(/\s+/g, ' ').trim();
        break;
      }
    }
  }

  /* -- Email extraction -- */
  // First: mailto: links
  const mailtoLink = $('a[href^="mailto:"]').first().attr('href');
  if (mailtoLink) {
    const addr = mailtoLink.replace('mailto:', '').split('?')[0].trim();
    if (addr.includes('@')) identity.email = addr;
  }
  if (!identity.email) {
    // Match email followed by word boundary to avoid capturing trailing text like "school"
    const emailMatch = bodyText.match(/(?:email|e-mail|mail\s*(?:us)?)\s*[:.\-–]?\s*([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,6})(?=[^a-zA-Z]|$)/i);
    if (emailMatch?.[1]) {
      identity.email = emailMatch[1].trim();
    } else {
      // Fallback: any email-like string with word boundary
      const anyEmail = bodyText.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,6}(?=[^a-zA-Z]|$)/);
      if (anyEmail?.[0] && !/\.(png|jpg|gif|svg|css|js)$/i.test(anyEmail[0])) {
        identity.email = anyEmail[0];
      }
    }
  }

  /* -- Address extraction -- */
  // Try <address> HTML tag first
  const addressTag = $('address').first().text().trim().replace(/\s+/g, ' ');
  if (addressTag && addressTag.length > 10 && addressTag.length < 300) {
    identity.address = addressTag.slice(0, 200);
  }
  if (!identity.address) {
    // Schema.org structured data
    const schemaAddr = $('[itemprop="address"], [itemprop="streetAddress"]').first().text().trim().replace(/\s+/g, ' ');
    if (schemaAddr && schemaAddr.length > 10 && schemaAddr.length < 300) {
      identity.address = schemaAddr.slice(0, 200);
    }
  }
  if (!identity.address) {
    // Footer / contact-info sections: look for text blocks containing Indian PIN code
    const contactSections = $('footer, [class*="contact"], [class*="footer"], [id*="contact"], [id*="footer"]');
    contactSections.each((_, el) => {
      if (identity.address) return;
      const sectionText = $(el).text().replace(/\s+/g, ' ').trim();
      const m = sectionText.match(/([A-Z][A-Za-z .,'&\-]{8,180}?\b\d{6}\b\.?)/i);
      if (m?.[1] && /[a-zA-Z]/.test(m[1]) && m[1].split(/[,.]/).length >= 2) {
        identity.address = m[1].trim().replace(/\s+/g, ' ').slice(0, 200);
      }
    });
  }
  if (!identity.address) {
    // Pattern: Look for explicit "address:" / "location:" prefix + PIN code
    const addrMatch = bodyText.match(/(?:address|location|located at|situated at|contact\s*(?:info|us)?)\s*[:.–\-]?\s*(.{10,200}?\b\d{6}\b)/i);
    if (addrMatch?.[1]) {
      identity.address = addrMatch[1].trim().replace(/\s+/g, ' ').slice(0, 200);
    }
  }
  if (!identity.address) {
    // Broad fallback: any sentence containing Indian state name + 6-digit PIN
    const INDIAN_STATES_RE = 'andhra pradesh|arunachal pradesh|assam|bihar|chhattisgarh|goa|gujarat|haryana|himachal pradesh|jharkhand|karnataka|kerala|madhya pradesh|maharashtra|manipur|meghalaya|mizoram|nagaland|odisha|punjab|rajasthan|sikkim|tamil\\s?nadu|telangana|tripura|uttar pradesh|uttarakhand|west bengal|delhi|chandigarh|puducherry|tamilnadu';
    const statePin = new RegExp('([A-Za-z][A-Za-z .,\'&\\-]{8,180}?(?:' + INDIAN_STATES_RE + ')[A-Za-z .,\\-]*\\b\\d{6}\\b\\.?)', 'i');
    const spm = bodyText.match(statePin);
    if (spm?.[1] && spm[1].split(/[,.]/).length >= 2) {
      identity.address = spm[1].trim().replace(/\s+/g, ' ').slice(0, 200);
    }
  }

  /* -- Founding year -- */
  const yearPatterns = [
    /(?:established|founded|since|est\.?|inception)\s*(?:in\s+|:?\s*)(\d{4})/i,
    /(?:started|begun|commenced)\s+(?:in\s+)?(\d{4})/i,
  ];
  for (const pat of yearPatterns) {
    const m = bodyText.match(pat);
    if (m?.[1]) {
      const yr = parseInt(m[1], 10);
      if (yr >= 1800 && yr <= new Date().getFullYear()) {
        identity.foundingYear = m[1];
        break;
      }
    }
  }

  /* -- Vision, Mission, and Motto extraction using vm-extractor -- */
  const vmData = extractVisionMissionMotto($, _url, bodyText);
  if (vmData.vision && !identity.vision) {
    identity.vision = vmData.vision.value;
    identity.visionConfidence = vmData.vision.confidence;
  }
  if (vmData.mission && !identity.mission) {
    identity.mission = vmData.mission.value;
    identity.missionConfidence = vmData.mission.confidence;
  }
  if (vmData.motto && !identity.motto) {
    identity.motto = vmData.motto.value;
    identity.mottoConfidence = vmData.motto.confidence;
  }

  return identity;
}

/**
 * Refine identity from an inner page (contact, about, principal, etc.).
 * Only fills in fields that are still missing in the existing identity.
 */
function refineIdentity(existing: EarlyIdentity, $: import('cheerio').CheerioAPI, pageUrl: string): boolean {
  let changed = false;
  const bodyText = extractCleanText($);
  const lowerUrl = pageUrl.toLowerCase();

  /* -- Principal from principal/about pages -- */
  if (!existing.principalName && /\b(principal|headmaster|headmistress|director|about)\b/i.test(lowerUrl)) {
    const HONORIFIC = `(?:Mr\\.?|Mrs\\.?|Ms\\.?|Dr\\.?|Shri\\.?|Smt\\.?|Prof\\.?|Sri\\.?|Thiru\\.?)`;
    const NAME_PART = `${HONORIFIC}\\s+([A-Z](?:[a-z]+|\\.)?(?:\\s+[A-Z](?:[a-z]+|\\.)?){0,4})`;
    const patterns = [
      new RegExp(`(?:principal|head\\s*(?:of\\s+)?school|headmaster|headmistress|director)\\s*(?:[:,\\-–]|is|name)?\\s*${NAME_PART}`, 'i'),
      new RegExp(`${NAME_PART}\\s*,?\\s*(?:principal|head\\s*(?:of\\s+)?school|headmaster|headmistress|director)`, 'i'),
      // On a principal page, just find an honorific + name (high confidence it's the principal)
      new RegExp(`${NAME_PART}`, 'i'),
    ];
    for (const pat of patterns) {
      const m = bodyText.match(pat);
      if (m?.[1]) {
        const candidateName = m[1].trim().replace(/\s+/g, ' ');
        if (!/\b(school|academy|vidya|mandhir|mandir|college|institute|foundation)\b/i.test(candidateName)) {
          existing.principalName = candidateName.slice(0, 80);
          changed = true;
          break;
        }
      }
    }
    // Fallback: "NAME, Principal" without honorific
    if (!existing.principalName) {
      const noHonorificPatterns = [
        /([A-Z][A-Za-z.]+(?:\s+[A-Z][A-Za-z.]*){0,4})\s*,?\s*(?:principal|head\s+(?:of\s+)?school|headmaster|headmistress)\b/i,
        /(?:principal|head\s+(?:of\s+)?school|headmaster|headmistress)\s*[:.–\-,]?\s*([A-Z][A-Za-z.]+(?:\s+[A-Z][A-Za-z.]*){0,4})/,
      ];
      for (const pat of noHonorificPatterns) {
        const m = bodyText.match(pat);
        if (m?.[1]) {
          const candidateName = m[1].trim().replace(/\s+/g, ' ');
          if (candidateName.length >= 4 && candidateName.length <= 60
              && !/\b(school|academy|vidya|mandhir|mandir|college|institute|foundation|desk|message|welcome)\b/i.test(candidateName)) {
            existing.principalName = candidateName.slice(0, 80);
            changed = true;
            break;
          }
        }
      }
    }
    // DOM-based: heading adjacent to "Principal" heading
    if (!existing.principalName) {
      $('h1, h2, h3, h4, h5, strong, b').each((_, el) => {
        if (existing.principalName) return;
        const text = $(el).text().trim();
        if (/^principal/i.test(text) && text.length < 40) {
          const prev = $(el).prev('h1, h2, h3, h4, h5, strong, b, p').text().trim().replace(/\s+/g, ' ');
          const next = $(el).next('h1, h2, h3, h4, h5, strong, b, p').text().trim().replace(/\s+/g, ' ');
          for (const candidate of [prev, next]) {
            if (!candidate || candidate.length < 3 || candidate.length > 60) continue;
            if (/\b(school|academy|vidya|college|institute|foundation|desk|message|welcome|phone|email|address)\b/i.test(candidate)) continue;
            if (/^[A-Z][A-Za-z.]+(?:\s+[A-Z][A-Za-z.]*){0,4},?$/.test(candidate.replace(/,\s*$/, ''))) {
              existing.principalName = candidate.replace(/,\s*$/, '').slice(0, 80);
              changed = true;
              return;
            }
          }
        }
      });
    }
  }

  /* -- Phone from contact/about pages -- */
  if (!existing.phone) {
    const telLink = $('a[href^="tel:"]').first().attr('href');
    if (telLink) {
      existing.phone = telLink.replace('tel:', '').replace(/\s+/g, '').trim();
      changed = true;
    } else {
      const phonePatterns = [
        /(?:phone|tel|call|contact|mob(?:ile)?)\s*(?:no\.?|number|#)?\s*[:.\-–]?\s*(\+?91[\s\-]?\d[\d\s\-]{8,12}\d)/i,
        /(?:phone|tel|call|contact|mob(?:ile)?)\s*(?:no\.?|number|#)?\s*[:.\-–]?\s*(0\d{2,4}[\s\-]?\d{6,8})/i,
        /(?:phone|tel|call|contact|mob(?:ile)?)\s*(?:no\.?|number|#)?\s*[:.\-–]?\s*(\d{10})/i,
      ];
      for (const pat of phonePatterns) {
        const m = bodyText.match(pat);
        if (m?.[1]) {
          existing.phone = m[1].replace(/\s+/g, ' ').trim();
          changed = true;
          break;
        }
      }
    }
  }

  /* -- Email from contact/about pages -- */
  if (!existing.email) {
    const mailtoLink = $('a[href^="mailto:"]').first().attr('href');
    if (mailtoLink) {
      const addr = mailtoLink.replace('mailto:', '').split('?')[0].trim();
      if (addr.includes('@')) { existing.email = addr; changed = true; }
    }
    if (!existing.email) {
      const emailMatch = bodyText.match(/(?:email|e-mail|mail\s*(?:us)?)\s*[:.\-–]?\s*([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/i);
      if (emailMatch?.[1]) { existing.email = emailMatch[1].trim(); changed = true; }
      else {
        const anyEmail = bodyText.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
        if (anyEmail?.[0] && !/\.(png|jpg|gif|svg|css|js)$/i.test(anyEmail[0])) {
          existing.email = anyEmail[0]; changed = true;
        }
      }
    }
  }

  /* -- Address from contact/about pages -- */
  if (!existing.address) {
    const addressTag = $('address').first().text().trim().replace(/\s+/g, ' ');
    if (addressTag && addressTag.length > 10 && addressTag.length < 300) {
      existing.address = addressTag.slice(0, 200); changed = true;
    }
    if (!existing.address) {
      const schemaAddr = $('[itemprop="address"], [itemprop="streetAddress"]').first().text().trim().replace(/\s+/g, ' ');
      if (schemaAddr && schemaAddr.length > 10 && schemaAddr.length < 300) {
        existing.address = schemaAddr.slice(0, 200); changed = true;
      }
    }
    if (!existing.address) {
      // Footer / contact-info sections containing Indian PIN code
      const contactSections = $('footer, [class*="contact"], [class*="footer"], [id*="contact"], [id*="footer"]');
      contactSections.each((_, el) => {
        if (existing.address) return;
        const sectionText = $(el).text().replace(/\s+/g, ' ').trim();
        const m = sectionText.match(/([A-Z][A-Za-z .,'&\-]{8,180}?\b\d{6}\b\.?)/i);
        if (m?.[1] && /[a-zA-Z]/.test(m[1]) && m[1].split(/[,.]/).length >= 2) {
          existing.address = m[1].trim().replace(/\s+/g, ' ').slice(0, 200); changed = true;
        }
      });
    }
    if (!existing.address) {
      const addrMatch = bodyText.match(/(?:address|location|located at|situated at|contact\s*(?:info|us)?)\s*[:.–\-]?\s*(.{10,200}?\b\d{6}\b)/i);
      if (addrMatch?.[1]) {
        existing.address = addrMatch[1].trim().replace(/\s+/g, ' ').slice(0, 200); changed = true;
      }
    }
    if (!existing.address) {
      // Broad fallback: sentence with Indian state name + 6-digit PIN
      const INDIAN_STATES_RE = 'andhra pradesh|arunachal pradesh|assam|bihar|chhattisgarh|goa|gujarat|haryana|himachal pradesh|jharkhand|karnataka|kerala|madhya pradesh|maharashtra|manipur|meghalaya|mizoram|nagaland|odisha|punjab|rajasthan|sikkim|tamil\\s?nadu|telangana|tripura|uttar pradesh|uttarakhand|west bengal|delhi|chandigarh|puducherry|tamilnadu';
      const statePin = new RegExp('([A-Za-z][A-Za-z .,\'&\\-]{8,180}?(?:' + INDIAN_STATES_RE + ')[A-Za-z .,\\-]*\\b\\d{6}\\b\\.?)', 'i');
      const spm = bodyText.match(statePin);
      if (spm?.[1] && spm[1].split(/[,.]/).length >= 2) {
        existing.address = spm[1].trim().replace(/\s+/g, ' ').slice(0, 200); changed = true;
      }
    }
  }

  /* -- Vision, Mission, and Motto fallback from inner pages -- */
  const vmData = extractVisionMissionMotto($, pageUrl, bodyText);
  if (!existing.vision && vmData.vision) {
    existing.vision = vmData.vision.value;
    existing.visionConfidence = vmData.vision.confidence;
    changed = true;
  }
  if (!existing.mission && vmData.mission) {
    existing.mission = vmData.mission.value;
    existing.missionConfidence = vmData.mission.confidence;
    changed = true;
  }
  if (!existing.motto && vmData.motto) {
    existing.motto = vmData.motto.value;
    existing.mottoConfidence = vmData.motto.confidence;
    changed = true;
  }

  return changed;
}

/* ------------------------------------------------------------------ */
/*  Quality-based early stop                                           */
/* ------------------------------------------------------------------ */

const ALL_FACT_KEYS = [
  ...SAFETY_PATTERNS.map((p) => p.key),
  ...CLARITY_PATTERNS.map((p) => p.key),
];

function shouldEarlyStop(facts: CrawlFact[]): boolean {
  const foundKeys = new Set(facts.filter((f) => f.value === 'found' || f.value === 'true').map((f) => f.key));
  return foundKeys.size >= Math.ceil(ALL_FACT_KEYS.length * 0.8);
}

/* ------------------------------------------------------------------ */
/*  Preliminary keyword-based scoring (from facts)                     */
/* ------------------------------------------------------------------ */

interface PreliminaryScore { safety: number; clarity: number; overall: number }

function computePreliminaryScore(facts: CrawlFact[]): PreliminaryScore {
  let safetyTotal = 0;
  for (const { key } of SAFETY_PATTERNS) {
    const best = facts.filter((f) => f.key === key).sort((a, b) => b.confidence - a.confidence)[0];
    if (best?.value === 'found') safetyTotal += 20;
    else if (best?.value === 'unclear') safetyTotal += 10;
  }

  let clarityTotal = 0;
  for (const { key } of CLARITY_PATTERNS) {
    if (facts.some((f) => f.key === key && f.value === 'true')) clarityTotal += 20;
  }

  return { safety: safetyTotal, clarity: clarityTotal, overall: Math.round((safetyTotal + clarityTotal) / 2) };
}

/* ------------------------------------------------------------------ */
/*  Main crawl V2 function                                             */
/* ------------------------------------------------------------------ */

async function crawlV2(sessionId: string, url: string, maxPages: number): Promise<void> {
  const origin = new URL(url).origin;
  const originHost = new URL(url).hostname.toLowerCase();
  const seen = new SeenUrls();
  const allFacts: CrawlFact[] = [];
  const pageEntries: PageEntry[] = [];
  let playwrightBudget = PLAYWRIGHT_HARD_BUDGET;
  let pdfsFound = 0;
  let imagesFound = 0;
  const startTime = Date.now();

  const heartbeatTimer = setInterval(() => {
    post('/internal/heartbeat', { sessionId }).catch(() => {});
  }, HEARTBEAT_INTERVAL_MS);

  try {
    /* ============================================================ */
    /*  DISCOVERY PHASE                                              */
    /* ============================================================ */
    await emitEvent(sessionId, 'discovery_start', {});
    console.log(`[${sessionId.slice(0, 8)}] Discovery — ${url}`);

    // 1. Fetch homepage with Cheerio
    let homepageResult: CheerioFetchResult;
    let homepageUsedPlaywright = false;
    try {
      homepageResult = await fetchWithCheerio(url, 15_000);
      
      // Check if Cheerio result is garbage (JS/CSS instead of content)
      const cheerioText = extractCleanText(homepageResult.$);
      if ((cheerioText.length < CHEERIO_MIN_TEXT_LENGTH || isGarbageText(cheerioText)) && playwrightBudget > 0) {
        console.log(`[${sessionId.slice(0, 8)}] Homepage Cheerio got garbage (${cheerioText.length} chars), trying Playwright`);
        const pwResult = await fetchWithPlaywright(url, 20_000);
        const cheerioMod = await import('cheerio');
        const $ = cheerioMod.load(pwResult.html);
        homepageResult = { html: pwResult.html, $, contentType: 'text/html', statusCode: 200 };
        playwrightBudget--;
        homepageUsedPlaywright = true;
      }
    } catch (err) {
      console.warn(`[${sessionId.slice(0, 8)}] Homepage Cheerio failed, trying Playwright:`, err instanceof Error ? err.message : err);
      const pwResult = await fetchWithPlaywright(url, 20_000);
      const cheerioMod = await import('cheerio');
      const $ = cheerioMod.load(pwResult.html);
      homepageResult = { html: pwResult.html, $, contentType: 'text/html', statusCode: 200 };
      playwrightBudget--;
      homepageUsedPlaywright = true;
    }
    seen.add(url);

    // 2. Extract early identity
    const identity = extractIdentity(homepageResult.$, homepageResult.html, url);
    if (Object.keys(identity).length > 0) {
      post('/internal/early-identity', { sessionId, identity }).catch(() => {});
      await emitEvent(sessionId, 'identity', identity as unknown as Record<string, unknown>);
    }

    // 3. Homepage text + facts
    const homepageTitle = homepageResult.$('title').text().trim() || url;
    const homepageText = extractCleanText(homepageResult.$);
    pageEntries.push({ url, title: homepageTitle, text: homepageText });
    const homepageFacts = extractFacts(homepageText, url, 'homepage');
    allFacts.push(...homepageFacts);
    imagesFound += homepageResult.$('img').length;

    await emitEvent(sessionId, 'page_crawled', {
      url, method: 'cheerio', tier: -1, factsFound: homepageFacts.length,
    });

    // 4. Discover links from homepage
    const discoveredUrls: { url: string; tier: 0 | 1 | 2 | 3 }[] = [];
    homepageResult.$('a[href]').each((_, el) => {
      const href = homepageResult.$(el).attr('href');
      if (!href) return;
      try {
        const absolute = new URL(href, origin).toString();
        const canonical = canonicalizeUrl(absolute);
        if (new URL(canonical).hostname.toLowerCase() !== originHost) return;
        if (shouldSkipUrl(canonical)) return;
        if (!seen.add(canonical)) return;
        discoveredUrls.push({ url: canonical, tier: classifyUrlTier(canonical, originHost) });
      } catch { /* invalid URL */ }
    });

    // 5. Sitemap URLs
    try {
      const sitemapUrls = await fetchSitemapUrls(origin);
      for (const su of sitemapUrls) {
        try {
          const canonical = canonicalizeUrl(su);
          if (new URL(canonical).hostname.toLowerCase() !== originHost) continue;
          if (shouldSkipUrl(canonical)) continue;
          if (!seen.add(canonical)) continue;
          discoveredUrls.push({ url: canonical, tier: classifyUrlTier(canonical, originHost) });
        } catch { /* invalid URL */ }
      }
    } catch (err) {
      console.warn(`[${sessionId.slice(0, 8)}] Sitemap failed:`, err instanceof Error ? err.message : err);
    }

    // 6. Sort by tier priority
    discoveredUrls.sort((a, b) => a.tier - b.tier);

    const tierCounts = {
      t0: discoveredUrls.filter((u) => u.tier === 0).length,
      t1: discoveredUrls.filter((u) => u.tier === 1).length,
      t2: discoveredUrls.filter((u) => u.tier === 2).length,
      t3: discoveredUrls.filter((u) => u.tier === 3).length,
    };

    await emitEvent(sessionId, 'discovery_complete', { totalUrls: discoveredUrls.length, tiers: tierCounts });
    console.log(`[${sessionId.slice(0, 8)}] Discovery: ${discoveredUrls.length} URLs (T0:${tierCounts.t0} T1:${tierCounts.t1} T2:${tierCounts.t2} T3:${tierCounts.t3})`);

    /* ============================================================ */
    /*  EXTRACTION PHASE                                             */
    /* ============================================================ */
    let pagesScanned = 1; // homepage counted
    const urlLimit = Math.min(maxPages - 1, discoveredUrls.length);

    for (let i = 0; i < urlLimit; i++) {
      const { url: pageUrl, tier } = discoveredUrls[i];

      try {
        // PDF handling
        if (pageUrl.toLowerCase().endsWith('.pdf')) {
          pdfsFound++;
          try {
            const head = await headCheck(pageUrl);
            if (head.contentLength > 2 * 1024 * 1024) {
              console.log(`[${sessionId.slice(0, 8)}] Skipping large PDF (${Math.round(head.contentLength / 1024)}KB): ${pageUrl}`);
              continue;
            }
          } catch { /* proceed anyway */ }
          await emitEvent(sessionId, 'page_crawled', { url: pageUrl, method: 'pdf_skip', tier, factsFound: 0 });
          continue;
        }

        // Cheerio-first fetch
        let pageText = '';
        let pageTitle = '';
        let usedMethod = 'cheerio';

        try {
          const result = await fetchWithCheerio(pageUrl, 12_000);
          if (result.statusCode >= 400) {
            console.warn(`[${sessionId.slice(0, 8)}] HTTP ${result.statusCode}: ${pageUrl}`);
            continue;
          }
          pageTitle = result.$('title').text().trim() || pageUrl;
          pageText = extractCleanText(result.$);
          imagesFound += result.$('img').length;

          // Playwright fallback for thin content OR garbage content
          if ((pageText.length < CHEERIO_MIN_TEXT_LENGTH || isGarbageText(pageText)) && playwrightBudget > 0) {
            console.log(`[${sessionId.slice(0, 8)}] Cheerio ${pageText.length} chars (garbage: ${isGarbageText(pageText)}) → Playwright: ${pageUrl}`);
            try {
              const pwResult = await fetchWithPlaywright(pageUrl, 15_000);
              if (pwResult.text.length > pageText.length || !isGarbageText(pwResult.text)) {
                pageText = pwResult.text;
                pageTitle = pwResult.title || pageTitle;
                usedMethod = 'playwright';
              }
            } catch (pwErr) {
              console.warn(`[${sessionId.slice(0, 8)}] Playwright fallback failed:`, pwErr instanceof Error ? pwErr.message : pwErr);
            }
            playwrightBudget--;
          }
        } catch (fetchErr) {
          if (playwrightBudget > 0) {
            try {
              const pwResult = await fetchWithPlaywright(pageUrl, 15_000);
              pageText = pwResult.text;
              pageTitle = pwResult.title || pageUrl;
              usedMethod = 'playwright';
              playwrightBudget--;
            } catch {
              console.warn(`[${sessionId.slice(0, 8)}] Both methods failed: ${pageUrl}`);
              continue;
            }
          } else {
            console.warn(`[${sessionId.slice(0, 8)}] Cheerio failed, no PW budget: ${pageUrl}`);
            continue;
          }
        }

        if (pageText.length < 50) continue;

        pagesScanned++;
        pageEntries.push({ url: pageUrl, title: pageTitle, text: pageText });

        // Extract facts
        const sourceType = tier === 0 ? 'mandatory' : 'inner_page';
        const pageFacts = extractFacts(pageText, pageUrl, sourceType);
        allFacts.push(...pageFacts);

        // Refine identity from inner pages (contact, about, principal, etc.)
        if (/\b(contact|about|principal|headmaster|headmistress|director|staff|faculty|address|reach)\b/i.test(pageUrl)) {
          try {
            const cheerioMod = await import('cheerio');
            // Re-fetch page for Cheerio API if we used Playwright, else reconstruct
            let innerPage$: import('cheerio').CheerioAPI;
            if (usedMethod === 'cheerio') {
              const innerResult = await fetchWithCheerio(pageUrl, 10_000);
              innerPage$ = innerResult.$;
            } else {
              innerPage$ = cheerioMod.load(`<body>${pageText}</body>`);
            }
            const refined = refineIdentity(identity, innerPage$, pageUrl);
            if (refined) {
              post('/internal/early-identity', { sessionId, identity }).catch(() => {});
              await emitEvent(sessionId, 'identity', identity as unknown as Record<string, unknown>);
            }
          } catch (refineErr) {
            console.warn(`[${sessionId.slice(0, 8)}] Refine identity failed for ${pageUrl}:`, refineErr instanceof Error ? refineErr.message : refineErr);
          }
        }

        await emitEvent(sessionId, 'page_crawled', {
          url: pageUrl, method: usedMethod, tier, factsFound: pageFacts.length,
        });

        // Quality-based early stop (only after scanning at least 5 pages)
        if (pagesScanned >= 5 && shouldEarlyStop(allFacts)) {
          console.log(`[${sessionId.slice(0, 8)}] Early stop: quality ok after ${pagesScanned} pages`);
          await emitEvent(sessionId, 'early_stop', { reason: 'quality_threshold_met', pagesScanned });
          break;
        }
      } catch (err) {
        console.warn(`[${sessionId.slice(0, 8)}] Error: ${pageUrl}:`, err instanceof Error ? err.message : err);
      }
    }

    /* ============================================================ */
    /*  POST-CRAWL: scoring + results                                */
    /* ============================================================ */

    const preliminary = computePreliminaryScore(allFacts);
    const scanDurationMs = Date.now() - startTime;

    console.log(`[${sessionId.slice(0, 8)}] Done: ${pagesScanned} pages, ${allFacts.length} facts, ${scanDurationMs}ms`);
    console.log(`[${sessionId.slice(0, 8)}] Preliminary: S=${preliminary.safety} C=${preliminary.clarity} O=${preliminary.overall}`);

    await emitEvent(sessionId, 'preliminary_score', {
      safety: preliminary.safety, clarity: preliminary.clarity, overall: preliminary.overall,
    });

    await emitEvent(sessionId, 'crawl_complete', {
      pagesScanned, pdfsFound, factsExtracted: allFacts.length,
      durationMs: scanDurationMs,
      playwrightBudgetUsed: PLAYWRIGHT_HARD_BUDGET - playwrightBudget,
    });

    // Scan confidence
    let scanConfidence = Math.min(pagesScanned * 7, 85);
    if (pdfsFound > 0) scanConfidence += 5;
    if (allFacts.length > 5) scanConfidence += 5;
    scanConfidence = Math.min(scanConfidence, 100);
    const scanConfidenceLabel = scanConfidence >= 80 ? 'High' : scanConfidence >= 50 ? 'Medium' : 'Low — Limited data available';

    // Combined text for scoring
    const combinedText = pageEntries
      .map((p) => `\n\nURL: ${p.url}\n${p.text}`)
      .join('')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 50_000);

    // POST results
    await post('/internal/crawl-result', {
      sessionId,
      pageUrl: url,
      title: pageEntries[0]?.title || url,
      extractedText: combinedText,
      pages: pageEntries.map((p) => ({
        url: p.url,
        title: p.title,
        text: p.text.replace(/\s+/g, ' ').trim().slice(0, 10_000),
      })),
      pagesScanned,
      pdfsScanned: pdfsFound,
      imagesScanned: imagesFound,
      maxDepthReached: 1,
      structuredDataDetected: false,
      scanDurationMs,
      scanConfidence,
      scanConfidenceLabel,
      facts: allFacts,
      preliminaryScore: preliminary,
      playwrightBudgetUsed: PLAYWRIGHT_HARD_BUDGET - playwrightBudget,
    }, 30_000);
  } finally {
    clearInterval(heartbeatTimer);
  }
}

const crawlWorker = new Worker(
  crawlQueueName,
  async (job) => {
    const { sessionId, url, maxPages } = job.data as { sessionId: string; url: string; maxPages: number };
    await crawlV2(sessionId, url, maxPages || 30);
  },
  { connection: redisConnection },
);

/* ================================================================== */
/*  WORKER 3 — Scoring (OpenAI + keyword fallback)                    */
/* ================================================================== */

interface SafetyResult {
  fire_certificate: 'found' | 'missing' | 'unclear';
  fire_evidence: string | null;
  sanitary_certificate: 'found' | 'missing' | 'unclear';
  sanitary_evidence: string | null;
  cctv_mention: 'found' | 'missing' | 'unclear';
  cctv_evidence: string | null;
  transport_safety: 'found' | 'missing' | 'unclear';
  transport_evidence: string | null;
  anti_bullying_policy: 'found' | 'missing' | 'unclear';
  anti_bullying_evidence: string | null;
}

interface ClarityResult {
  admission_dates_visible: boolean;
  fee_clarity: boolean;
  academic_calendar: boolean;
  contact_and_map: boolean;
  results_published: boolean;
}

const SCORING_SYSTEM_PROMPT = `You are an expert school website auditor for Indian parents. Analyze the provided school website text and extract safety/compliance signals and parent clarity signals.

Return a JSON object with exactly this structure:
{
  "safety": {
    "fire_certificate": "found" | "missing" | "unclear",
    "fire_evidence": "exact quote from text or null",
    "sanitary_certificate": "found" | "missing" | "unclear",
    "sanitary_evidence": "exact quote from text or null",
    "cctv_mention": "found" | "missing" | "unclear",
    "cctv_evidence": "exact quote from text or null",
    "transport_safety": "found" | "missing" | "unclear",
    "transport_evidence": "exact quote from text or null",
    "anti_bullying_policy": "found" | "missing" | "unclear",
    "anti_bullying_evidence": "exact quote from text or null"
  },
  "clarity": {
    "admission_dates_visible": true/false,
    "fee_clarity": true/false,
    "academic_calendar": true/false,
    "contact_and_map": true/false,
    "results_published": true/false
  }
}

Rules:
- "found" = explicitly stated with clear, specific evidence on the website
- "unclear" = topic is mentioned but vaguely, without verifiable details
- "missing" = no mention at all
- For evidence fields, provide shortest relevant excerpt (max 100 chars) or null
- Be STRICT on safety: generic phrases like "safe environment" or "we care for safety" count as "unclear", NOT "found"

Clarity rules (these must be SPECIFIC and ACTIONABLE for parents to be true):
- admission_dates_visible = true ONLY if the website states specific open/close dates, months, or an academic year intake window (e.g. "Admissions open January to March 2025"). "Admissions are open" alone = false.
- fee_clarity = true ONLY if actual fee amounts are published (e.g. ₹45,000/year or ranges). "Contact us for fees" = false.
- academic_calendar = true ONLY if term dates, holidays, or exam schedule are listed. Generic "April to March" academic year = false.
- contact_and_map = true if a phone number AND physical address are both present.
- results_published = true if board exam results, pass percentages, or merit lists are published.
- When in doubt, prefer false — parents are better served by accurate gaps than false confidence.`;

function keywordFallbackScoring(text: string): { safety: SafetyResult; clarity: ClarityResult } {
  const lowerText = text.toLowerCase();

  function detect(patterns: string[]): 'found' | 'missing' | 'unclear' {
    if (patterns.some((p) => lowerText.includes(p))) return 'found';
    const partials = patterns.map((p) => p.split(' ')[0]);
    if (partials.some((p) => p.length > 3 && lowerText.includes(p))) return 'unclear';
    return 'missing';
  }

  function findEvidence(patterns: string[]): string | null {
    for (const p of patterns) {
      const idx = lowerText.indexOf(p);
      if (idx >= 0) return text.slice(Math.max(0, idx - 20), Math.min(text.length, idx + p.length + 60)).trim();
    }
    return null;
  }

  return {
    safety: {
      fire_certificate: detect(['fire certificate', 'fire noc', 'fire safety', 'fire extinguisher', 'fire drill']),
      fire_evidence: findEvidence(['fire certificate', 'fire noc', 'fire safety', 'fire extinguisher', 'fire drill']),
      sanitary_certificate: detect(['sanitary certificate', 'health certificate', 'sanitation', 'hygiene certificate']),
      sanitary_evidence: findEvidence(['sanitary certificate', 'health certificate', 'sanitation', 'hygiene certificate']),
      cctv_mention: detect(['cctv', 'surveillance', 'security camera', 'monitoring system']),
      cctv_evidence: findEvidence(['cctv', 'surveillance', 'security camera', 'monitoring system']),
      transport_safety: detect(['transport safety', 'bus safety', 'gps tracking', 'school bus', 'school transport']),
      transport_evidence: findEvidence(['transport safety', 'bus safety', 'gps tracking', 'school bus', 'school transport']),
      anti_bullying_policy: detect(['anti-bullying', 'anti bullying', 'bullying policy', 'discipline policy', 'harassment policy']),
      anti_bullying_evidence: findEvidence(['anti-bullying', 'anti bullying', 'bullying policy', 'discipline policy', 'harassment policy']),
    },
    clarity: {
      // Require specific date patterns near "admission" (e.g. "Jan 2025", "15 March", "2025-2026 intake")
      admission_dates_visible: lowerText.includes('admission') && /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\s+\d{4}\b|\b\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|\bopen(s)? (till|until|from)\b/i.test(lowerText),
      // Require actual rupee amounts near "fee"
      fee_clarity: lowerText.includes('fee') && /₹\s*\d|rs\.?\s*\d|\binr\s*\d|\d[\d,]+\s*(per year|per annum|annually|\/year|p\.a\.)/i.test(lowerText),
      academic_calendar: /academic calendar|term (start|end|dates)|exam schedule|holiday list|school reopen/i.test(lowerText),
      contact_and_map: (lowerText.includes('contact') || lowerText.includes('phone')) && /\d{10}|\d{3}[\s-]\d{3,4}[\s-]\d{4}/.test(lowerText),
      results_published: /board results|pass percentage|toppers|\d+%\s*(pass|result)/i.test(lowerText),
    },
  };
}

function computeSafetyScore(safety: SafetyResult): { total: number; badge: 'verified' | 'partial' | 'not_found' } {
  const items = [safety.fire_certificate, safety.sanitary_certificate, safety.cctv_mention, safety.transport_safety, safety.anti_bullying_policy];
  let total = 0;
  for (const item of items) {
    if (item === 'found') total += 20;
    else if (item === 'unclear') total += 10;
  }
  return { total, badge: total >= 80 ? 'verified' : total >= 50 ? 'partial' : 'not_found' };
}

function computeClarityScore(clarity: ClarityResult): { total: number; label: string } {
  const booleans = [clarity.admission_dates_visible, clarity.fee_clarity, clarity.academic_calendar, clarity.contact_and_map, clarity.results_published];
  const total = booleans.filter(Boolean).length * 20;
  let label = `Decision Clarity Level: ${total}%`;
  if (total < 60) label += '. Parents may need to call the school for missing information.';
  return { total, label };
}

const scoringWorker = new Worker(
  scoringQueueName,
  async (job) => {
    const { sessionId, url, extractedText } = job.data as { sessionId: string; url?: string; extractedText?: string };
    const text = extractedText || '';

    await emitEvent(sessionId, 'scoring_start', {});

    let safety: SafetyResult;
    let clarity: ClarityResult;

    const aiResult = await callOpenAiJson(
      SCORING_SYSTEM_PROMPT,
      `Analyze this school website content:\n\n${text.slice(0, 30_000)}`,
      800,
    );

    if (aiResult?.safety && aiResult?.clarity) {
      safety = aiResult.safety as unknown as SafetyResult;
      clarity = aiResult.clarity as unknown as ClarityResult;
    } else {
      console.log('Using keyword fallback for scoring');
      const fb = keywordFallbackScoring(text);
      safety = fb.safety;
      clarity = fb.clarity;
    }

    const safetyScore = computeSafetyScore(safety);
    const clarityScore = computeClarityScore(clarity);
    const overallScore = Math.round((safetyScore.total + clarityScore.total) / 2);

    // Build a meaningful summary using the actual extracted signals
    const foundSafety = [safety.fire_certificate, safety.sanitary_certificate, safety.cctv_mention, safety.transport_safety, safety.anti_bullying_policy].filter(v => v === 'found');
    const missingSafety = [safety.fire_certificate, safety.sanitary_certificate, safety.cctv_mention, safety.transport_safety, safety.anti_bullying_policy].filter(v => v === 'missing');
    const clarityItems: string[] = [];
    if (clarity.admission_dates_visible) clarityItems.push('admission dates');
    if (clarity.fee_clarity) clarityItems.push('fee structure');
    if (clarity.academic_calendar) clarityItems.push('academic calendar');
    if (clarity.contact_and_map) clarityItems.push('contact details');
    if (clarity.results_published) clarityItems.push('exam results');

    let summary: string;
    if (overallScore >= 70) {
      summary = `This school's website is well-prepared for parents. ${clarityItems.length > 0 ? `Key information available: ${clarityItems.join(', ')}.` : ''} ${foundSafety.length >= 3 ? 'Safety disclosures are clearly documented.' : ''}`.trim();
    } else if (overallScore >= 40) {
      const missingClarity = ['admission dates', 'fee structure', 'academic calendar', 'contact details', 'exam results'].filter(i => !clarityItems.includes(i));
      summary = `Some parent-facing details are present${clarityItems.length > 0 ? ` (${clarityItems.join(', ')})` : ''}, but key information is missing: ${missingClarity.slice(0, 3).join(', ')}. ${missingSafety.length >= 3 ? 'Safety certifications are not clearly documented.' : ''}`.trim();
    } else {
      summary = `Important parent-facing details are missing. ${missingSafety.length > 0 ? 'Safety documentation (fire NOC, CCTV, anti-bullying policy) is not clearly mentioned. ' : ''}${clarityItems.length === 0 ? 'Admission, fee, and contact information are not clearly published.' : `Only ${clarityItems.join(', ')} ${clarityItems.length === 1 ? 'is' : 'are'} documented.`}`.trim();
    }

    await emitEvent(sessionId, 'final_score', { safety: safetyScore.total, clarity: clarityScore.total, overall: overallScore });

    await post('/internal/score-complete', {
      sessionId,
      overallScore,
      summary,
      urlHash: hashUrl((url || '').toLowerCase()),
      safetyScore: {
        total: safetyScore.total, badge: safetyScore.badge,
        fire_certificate: safety.fire_certificate, fire_evidence: safety.fire_evidence,
        sanitary_certificate: safety.sanitary_certificate, sanitary_evidence: safety.sanitary_evidence,
        cctv_mention: safety.cctv_mention, cctv_evidence: safety.cctv_evidence,
        transport_safety: safety.transport_safety, transport_evidence: safety.transport_evidence,
        anti_bullying_policy: safety.anti_bullying_policy, anti_bullying_evidence: safety.anti_bullying_evidence,
      },
      clarityScore: {
        total: clarityScore.total, label: clarityScore.label,
        admission_dates_visible: clarity.admission_dates_visible,
        fee_clarity: clarity.fee_clarity,
        academic_calendar: clarity.academic_calendar,
        contact_and_map: clarity.contact_and_map,
        results_published: clarity.results_published,
      },
    }, 30_000);

    await emitTerminalEvent(sessionId, 'complete', { overallScore });
  },
  { connection: redisConnection },
);

const classifyQueue = new Queue(classifyQueueName, { connection: redisConnection });
const crawlQueue = new Queue(crawlQueueName, { connection: redisConnection });
const bridgeClients: IORedisClient[] = [];
let bridgeStopRequested = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startLegacyListBridge(listName: string, queue: Queue): Promise<void> {
  const redisUrl = resolveRedisUrl();
  const parsed = new URL(redisUrl);
  const client = new IORedisClient({
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    username: decodeURIComponent(parsed.username || 'default'),
    password: decodeURIComponent(parsed.password || ''),
    tls: parsed.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  bridgeClients.push(client);

  console.log(`[BRIDGE] Listening Redis list '${listName}' -> BullMQ queue '${queue.name}'`);

  while (!bridgeStopRequested) {
    try {
      const result = await client.brpop(listName, 0);
      if (!result || bridgeStopRequested) continue;

      const payload = result[1];
      let data: unknown;
      try {
        data = JSON.parse(payload);
      } catch (error) {
        console.error(`[BRIDGE] Invalid JSON on list '${listName}'`, error instanceof Error ? error.message : error);
        continue;
      }

      await queue.add('legacy', data, {
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 200 },
      });

      console.log(`[BRIDGE] Forwarded job from list '${listName}'`);
    } catch (error) {
      if (bridgeStopRequested) break;
      console.error(`[BRIDGE] Error on list '${listName}'`, error instanceof Error ? error.message : error);
      await sleep(1000);
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Lifecycle + graceful shutdown                                      */
/* ------------------------------------------------------------------ */

classifyWorker.on('completed', (job) => console.log(`✓ Classify: ${job.id}`));
classifyWorker.on('failed', (job, err) => console.error(`✗ Classify: ${job?.id}`, err));
crawlWorker.on('completed', (job) => console.log(`✓ Crawl: ${job.id}`));
crawlWorker.on('failed', (job, err) => console.error(`✗ Crawl: ${job?.id}`, err));
scoringWorker.on('completed', (job) => console.log(`✓ Score: ${job.id}`));
scoringWorker.on('failed', (job, err) => console.error(`✗ Score: ${job?.id}`, err));

async function gracefulShutdown() {
  console.log('Shutting down workers...');
  bridgeStopRequested = true;
  await Promise.allSettled(bridgeClients.map((client) => client.quit()));
  await Promise.allSettled([
    classifyWorker.close(),
    crawlWorker.close(),
    scoringWorker.close(),
    classifyQueue.close(),
    crawlQueue.close(),
    closePlaywrightBrowser(),
    closeSseClient(),
  ]);
  process.exit(0);
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

console.log('Workers V2 started (classify + crawl + score) — Cheerio-first with SSE streaming');
void startLegacyListBridge(classifyQueueName, classifyQueue);
void startLegacyListBridge(crawlQueueName, crawlQueue);
void runStartupDiagnostics();
