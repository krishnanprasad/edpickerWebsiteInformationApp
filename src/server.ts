import 'dotenv/config';
import 'express-async-errors';
import crypto from 'node:crypto';
import express from 'express';
import { Queue } from 'bullmq';
import { z } from 'zod';
import OpenAI from 'openai';
import Redis from 'ioredis';
import { pgPool, redis } from './db.js';
import { FileStorageService } from './storage.js';

const app = express();
const port = Number(process.env.PORT || 3000);

function resolveRedisUrl(): string {
  const isLocal = process.env.IS_LOCAL === '1';
  const localUrl = process.env.REDIS_URL_LOCAL || process.env.REDIS_URL;
  const cloudUrl = process.env.REDIS_URL_CLOUD || process.env.REDIS_URL;
  const url = isLocal ? (localUrl || cloudUrl) : (cloudUrl || localUrl);
  if (!url) {
    throw new Error('REDIS_URL is required; set REDIS_URL_LOCAL / REDIS_URL_CLOUD and IS_LOCAL');
  }
  return url;
}

const connection = {
  host: process.env.REDIS_HOST || undefined,
  port: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : undefined,
  password: process.env.REDIS_PASSWORD || undefined,
  url: resolveRedisUrl(),
};

/* ------------------------------------------------------------------ */
/*  Queues (3-stage pipeline: classify → crawl → score)               */
/* ------------------------------------------------------------------ */

const classifyQueue = new Queue(process.env.CLASSIFY_QUEUE_NAME || 'schoollens-classify', { connection });
const crawlQueue = new Queue(process.env.CRAWLER_QUEUE_NAME || 'schoollens-crawl', { connection });
const scoringQueue = new Queue(process.env.SCORING_QUEUE_NAME || 'schoollens-score', { connection });

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'missing-key' });

const storage = new FileStorageService({
  provider: (process.env.STORAGE_PROVIDER as 's3' | 'azure') || 's3',
  bucketOrContainer: process.env.STORAGE_BUCKET || 'schoollens-assets',
  s3Endpoint: process.env.S3_ENDPOINT,
  s3Region: process.env.S3_REGION,
  s3AccessKey: process.env.S3_ACCESS_KEY,
  s3SecretKey: process.env.S3_SECRET_KEY,
  azureConnectionString: process.env.AZURE_STORAGE_CONNECTION_STRING,
});

app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

/* ------------------------------------------------------------------ */
/*  Validation & helpers                                               */
/* ------------------------------------------------------------------ */

const scanSchema = z.object({ url: z.string().url() });
const questionSchema = z.object({ question: z.string().min(3) });
const compareListIdSchema = z.object({ compareListId: z.string().uuid() });
const compareListAddSchema = z.object({
  url: z.string().url(),
  staleAction: z.enum(['add_anyway', 'refresh']).optional(),
});
const refreshSchema = z.object({});

function normalizeUrl(url: string): string {
  const parsed = new URL(url);
  parsed.hash = '';
  parsed.search = '';
  parsed.pathname = parsed.pathname.replace(/\/$/, '');
  return parsed.toString().toLowerCase();
}

function hashUrl(url: string): string {
  return crypto.createHash('sha256').update(url).digest('hex');
}

function requireInternalKey(req: express.Request, res: express.Response): boolean {
  const key = req.headers['x-internal-key'];
  if (!key || key !== process.env.INTERNAL_API_KEY) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

function isTerminalStatus(status: string): boolean {
  return status === 'Ready' || status === 'Rejected' || status === 'Failed' || status === 'Error';
}

function computeStaleness(completedAt: Date | null, staleDays = 7): { isStale: boolean; ageDays: number } {
  if (!completedAt) return { isStale: false, ageDays: 0 };
  const ageMs = Date.now() - completedAt.getTime();
  const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
  return { isStale: ageDays > staleDays, ageDays };
}

function safeHostnameLabel(url: string): string {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./i, '');
    const base = hostname.split('.')[0] || hostname;
    return base
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return 'School';
  }
}

async function refreshSession(sessionId: string): Promise<{ ok: true; sessionId: string; status: string } | { ok: false; code: string; message: string }> {
  const sess = await pgPool.query(
    'SELECT id, url, url_hash, status FROM analysis_sessions WHERE id = $1',
    [sessionId],
  );
  if (!sess.rowCount) return { ok: false, code: 'NOT_FOUND', message: 'Session not found' };

  const status = String(sess.rows[0].status);
  if (status === 'Classifying' || status === 'Crawling' || status === 'Scoring') {
    return { ok: false, code: 'IN_PROGRESS', message: 'Analysis running, ready soon.' };
  }

  const url = String(sess.rows[0].url);
  const urlHash = String(sess.rows[0].url_hash);

  await pgPool.query('BEGIN');
  try {
    await pgPool.query('DELETE FROM crawled_pages WHERE session_id = $1', [sessionId]);
    await pgPool.query('DELETE FROM crawl_facts WHERE session_id = $1', [sessionId]);
    await pgPool.query('DELETE FROM crawl_queue WHERE session_id = $1', [sessionId]);
    await pgPool.query('DELETE FROM education_classification WHERE session_id = $1', [sessionId]);
    await pgPool.query('DELETE FROM safety_scores WHERE session_id = $1', [sessionId]);
    await pgPool.query('DELETE FROM clarity_scores WHERE session_id = $1', [sessionId]);

    await pgPool.query(
      `UPDATE analysis_sessions
       SET status = 'Classifying',
           overall_score = NULL,
           summary = NULL,
           completed_at = NULL,
           pages_scanned = 0,
           pdfs_scanned = 0,
           images_scanned = 0,
           max_depth_reached = 0,
           structured_data_detected = FALSE,
           scan_duration_ms = NULL,
           scan_confidence = NULL,
           scan_confidence_label = NULL,
           crawl_phase = 'pending',
           heartbeat_at = NULL,
           preliminary_score = NULL,
           facts_extracted = 0,
           urls_discovered = 0,
           playwright_budget_used = 0
       WHERE id = $1`,
      [sessionId],
    );

    await pgPool.query('COMMIT');
  } catch (e) {
    await pgPool.query('ROLLBACK');
    throw e;
  }

  await redis.del(`analysis:v1:${urlHash}`);
  await redis.del(`sse:stream:${sessionId}`);

  await classifyQueue.add(
    'classify-job',
    { sessionId, url: normalizeUrl(url), maxPages: Number(process.env.CRAWLER_MAX_PAGES || 30) },
    { jobId: `classify-${sessionId}` },
  );

  return { ok: true, sessionId, status: 'Classifying' };
}

/* ================================================================== */
/*  Compare Lists (3-slot)                                             */
/* ================================================================== */

app.post('/api/compare-lists', async (_req, res) => {
  const created = await pgPool.query('INSERT INTO compare_lists DEFAULT VALUES RETURNING id');
  return res.status(201).json({ compareListId: created.rows[0].id });
});

app.get('/api/compare-lists/:compareListId', async (req, res) => {
  const parsed = compareListIdSchema.safeParse({ compareListId: req.params.compareListId });
  if (!parsed.success) return res.status(400).json({ error: 'Invalid compareListId' });

  const list = await pgPool.query('SELECT id FROM compare_lists WHERE id = $1', [parsed.data.compareListId]);
  if (!list.rowCount) return res.status(404).json({ error: 'Not found' });

  const items = await pgPool.query(
    `SELECT
       i.slot,
       i.session_id,
       s.url,
       s.status,
       s.created_at,
       s.completed_at,
       s.overall_score,
       s.early_identity,
       ec.is_educational,
       ec.confidence,
       ec.matched_keywords
     FROM compare_list_items i
     JOIN analysis_sessions s ON s.id = i.session_id
     LEFT JOIN education_classification ec ON ec.session_id = s.id
     WHERE i.compare_list_id = $1
     ORDER BY i.slot ASC`,
    [parsed.data.compareListId],
  );

  const slots: Array<{ slot: 1 | 2 | 3; item: any | null }> = [
    { slot: 1, item: null },
    { slot: 2, item: null },
    { slot: 3, item: null },
  ];

  for (const row of items.rows) {
    const slot = Number(row.slot) as 1 | 2 | 3;
    const completedAt = row.completed_at ? new Date(row.completed_at) : null;
    const staleness = computeStaleness(completedAt);

    let schoolName: string | null = null;
    if (row.early_identity && typeof row.early_identity === 'object') {
      const maybe = (row.early_identity as any).schoolName;
      if (typeof maybe === 'string' && maybe.trim()) schoolName = maybe.trim();
    }
    if (!schoolName) schoolName = safeHostnameLabel(String(row.url));

    slots[slot - 1].item = {
      slot,
      sessionId: String(row.session_id),
      url: String(row.url),
      status: String(row.status),
      createdAt: row.created_at,
      completedAt: row.completed_at,
      freshness: { isStale: staleness.isStale, ageDays: staleness.ageDays },
      schoolName,
      classification: row.is_educational === null ? null : {
        isEducational: Boolean(row.is_educational),
        confidence: row.confidence === null ? null : Number(row.confidence),
      },
      overallScore: row.overall_score === null ? null : Number(row.overall_score),
    };
  }

  return res.json({ compareListId: parsed.data.compareListId, slots });
});

app.post('/api/compare-lists/:compareListId/items', async (req, res) => {
  const parsedId = compareListIdSchema.safeParse({ compareListId: req.params.compareListId });
  if (!parsedId.success) return res.status(400).json({ error: 'Invalid compareListId' });

  const parsedBody = compareListAddSchema.safeParse(req.body);
  if (!parsedBody.success) return res.status(400).json({ error: 'Invalid URL' });

  const list = await pgPool.query('SELECT id FROM compare_lists WHERE id = $1', [parsedId.data.compareListId]);
  if (!list.rowCount) return res.status(404).json({ error: 'Not found' });

  const normalizedUrl = normalizeUrl(parsedBody.data.url);
  const urlHash = hashUrl(normalizedUrl);

  // Duplicate guard
  const dup = await pgPool.query(
    'SELECT slot, session_id FROM compare_list_items WHERE compare_list_id = $1 AND url_hash = $2',
    [parsedId.data.compareListId, urlHash],
  );
  if (dup.rowCount) {
    return res.status(409).json({
      code: 'DUPLICATE',
      message: 'This school is already in your list.',
      slot: Number(dup.rows[0].slot),
      sessionId: String(dup.rows[0].session_id),
    });
  }

  const existingSlots = await pgPool.query(
    'SELECT slot FROM compare_list_items WHERE compare_list_id = $1 ORDER BY slot ASC',
    [parsedId.data.compareListId],
  );
  const used = new Set<number>(existingSlots.rows.map((r: { slot: unknown }) => Number(r.slot)));
  const slot = ([1, 2, 3].find((s) => !used.has(s)) ?? null) as 1 | 2 | 3 | null;
  if (!slot) {
    return res.status(409).json({
      code: 'SLOT_FULL',
      message: 'Remove a school to add a new one.',
    });
  }

  // Ensure a session exists (url_hash is unique, so this reuses older scans)
  const upsert = await pgPool.query(
    `INSERT INTO analysis_sessions (url, url_hash, status)
     VALUES ($1, $2, 'Classifying')
     ON CONFLICT (url_hash) DO UPDATE SET url = analysis_sessions.url
     RETURNING id, status, completed_at`,
    [normalizedUrl, urlHash],
  );

  const sessionId = String(upsert.rows[0].id);
  const status = String(upsert.rows[0].status);
  const completedAt = upsert.rows[0].completed_at ? new Date(upsert.rows[0].completed_at) : null;
  const staleness = computeStaleness(completedAt);

  // Stale guard (>7d) for terminal sessions
  if (isTerminalStatus(status) && staleness.isStale && parsedBody.data.staleAction !== 'add_anyway') {
    if (parsedBody.data.staleAction === 'refresh') {
      const refreshed = await refreshSession(sessionId);
      if (!refreshed.ok) {
        return res.status(409).json({ code: refreshed.code, message: refreshed.message, sessionId });
      }
    } else {
      return res.status(409).json({
        code: 'STALE',
        message: `Data from ${staleness.ageDays} days ago — add anyway or refresh?`,
        sessionId,
        completedAt,
        ageDays: staleness.ageDays,
      });
    }
  }

  // Attach to compare list
  await pgPool.query(
    `INSERT INTO compare_list_items (compare_list_id, slot, session_id, url_hash)
     VALUES ($1, $2, $3, $4)`,
    [parsedId.data.compareListId, slot, sessionId, urlHash],
  );
  await pgPool.query('UPDATE compare_lists SET updated_at = NOW() WHERE id = $1', [parsedId.data.compareListId]);

  // If the session is already terminal, just return; otherwise ensure classify job is queued
  if (!isTerminalStatus(status)) {
    await classifyQueue.add(
      'classify-job',
      { sessionId, url: normalizedUrl, maxPages: Number(process.env.CRAWLER_MAX_PAGES || 30) },
      { jobId: `classify-${sessionId}` },
    );
  }

  return res.status(201).json({ slot, sessionId, status });
});

app.delete('/api/compare-lists/:compareListId/items/:slot', async (req, res) => {
  const parsedId = compareListIdSchema.safeParse({ compareListId: req.params.compareListId });
  if (!parsedId.success) return res.status(400).json({ error: 'Invalid compareListId' });

  const slot = Number(req.params.slot);
  if (![1, 2, 3].includes(slot)) return res.status(400).json({ error: 'Invalid slot' });

  const del = await pgPool.query(
    'DELETE FROM compare_list_items WHERE compare_list_id = $1 AND slot = $2',
    [parsedId.data.compareListId, slot],
  );
  await pgPool.query('UPDATE compare_lists SET updated_at = NOW() WHERE id = $1', [parsedId.data.compareListId]);
  return res.json({ ok: true, deleted: del.rowCount });
});

// Clear all slots from a compare list
app.delete('/api/compare-lists/:compareListId/items', async (req, res) => {
  const parsedId = compareListIdSchema.safeParse({ compareListId: req.params.compareListId });
  if (!parsedId.success) return res.status(400).json({ error: 'Invalid compareListId' });

  const del = await pgPool.query(
    'DELETE FROM compare_list_items WHERE compare_list_id = $1',
    [parsedId.data.compareListId],
  );
  await pgPool.query('UPDATE compare_lists SET updated_at = NOW() WHERE id = $1', [parsedId.data.compareListId]);
  return res.json({ ok: true, deleted: del.rowCount });
});

app.post('/api/scan/:id/refresh', async (req, res) => {
  const id = String(req.params.id);
  const bodyParsed = refreshSchema.safeParse(req.body ?? {});
  if (!bodyParsed.success) return res.status(400).json({ error: 'Invalid request' });

  const refreshed = await refreshSession(id);
  if (!refreshed.ok) return res.status(409).json({ code: refreshed.code, message: refreshed.message, sessionId: id });
  return res.json(refreshed);
});

/**
 * Clean text content by removing residual JS/CSS patterns.
 * This handles cases where old crawled data contains script remnants.
 */
function cleanExtractedText(text: string): string {
  let cleaned = text
    // Remove entire :root { ... } blocks (greedy, handles nested braces poorly but covers most cases)
    .replace(/:root\s*\{[\s\S]*?\}/gi, ' ')
    // Remove CSS variable declarations
    .replace(/--[\w-]+:\s*[^;]+;/g, ' ')
    // Remove var declarations
    .replace(/\bvar\s+[\w_]+\s*=\s*[^;]*;?/gi, ' ')
    // Remove function declarations and IIFEs
    .replace(/\bfunction\s*\([^)]*\)\s*\{[\s\S]*?\}/gi, ' ')
    .replace(/\(\s*function[\s\S]*?\}\s*\)\s*\(\s*\)/gi, ' ')
    // Remove common JS patterns
    .replace(/sessionStorage\.[^;]+;?/gi, ' ')
    .replace(/localStorage\.[^;]+;?/gi, ' ')
    .replace(/document\.\w+\s*[=\(][^;]+;?/gi, ' ')
    .replace(/Object\.defineProperty[\s\S]*?;/gi, ' ')
    .replace(/window\.\w+\s*[=\(][^;]+;?/gi, ' ')
    // Remove WordPress/LiteSpeed specific patterns
    .replace(/litespeed[\w_]*[\s\S]*?;/gi, ' ')
    .replace(/wp--preset[\w-]*:[^;]+;?/gi, ' ')
    .replace(/--wp[\w-]*:[^;]+;?/gi, ' ')
    // Remove CSS selectors and rules
    .replace(/\.[a-z][\w-]*\s*\{[^}]*\}/gi, ' ')
    .replace(/\.\w+:before\s*\{[^}]*\}/gi, ' ')
    // Remove remaining CSS-like patterns
    .replace(/\{[^}]*--[\w-]+:[^}]*\}/g, ' ')
    // Clean up file extensions appearing in text
    .replace(/\.(js|css|png|jpg|gif|svg|woff|ttf|eot)\b/gi, ' ')
    // Remove hex colors
    .replace(/#[0-9a-f]{3,8}\b/gi, ' ')
    // Remove rgba/rgb patterns
    .replace(/rgba?\s*\([^)]+\)/gi, ' ')
    // Remove URLs that look like assets
    .replace(/https?:\/\/[^\s"']+\.(js|css|woff|ttf|png|jpg|gif|ico)/gi, ' ')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();

  // If after cleaning we have very little text or mostly punctuation, it's garbage
  const alphaRatio = (cleaned.match(/[a-zA-Z]/g) || []).length / Math.max(cleaned.length, 1);
  if (alphaRatio < 0.3 || cleaned.length < 100) {
    return ''; // Return empty if text appears to be garbage
  }

  return cleaned;
}

/**
 * Split combined crawl text into per-page chunks and rank by keyword
 * relevance to the user's question. Returns the most relevant chunks
 * concatenated, up to `maxChars`.
 */
function findRelevantContent(
  fullText: string,
  question: string,
  maxChars = 16_000,
): { relevant: string; sources: { url: string; excerpt: string }[] } {
  // Split by the "URL: <url>" markers the crawler inserts
  const chunks: { url: string; text: string }[] = [];
  const parts = fullText.split(/\nURL:\s*/i);
  for (const part of parts) {
    if (!part.trim()) continue;
    const nlIdx = part.indexOf('\n');
    const url = nlIdx > 0 ? part.slice(0, nlIdx).trim() : 'unknown';
    let text = nlIdx > 0 ? part.slice(nlIdx + 1).trim() : part.trim();
    // Clean text to remove any residual JS/CSS
    text = cleanExtractedText(text);
    if (text.length > 20) chunks.push({ url, text });
  }

  // If no URL markers found, treat the whole blob as one chunk
  if (chunks.length === 0) {
    chunks.push({ url: 'crawled-content', text: cleanExtractedText(fullText) });
  }

  // Tokenise question into keywords (lowercase, 3+ chars)
  const stopWords = new Set(['the', 'this', 'that', 'there', 'what', 'which', 'where', 'when', 'how', 'does', 'has', 'have', 'any', 'are', 'for', 'and', 'not', 'with', 'from', 'about', 'given', 'been']);
  const qWords = question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !stopWords.has(w));

  // Score each chunk by keyword density
  const scored = chunks.map((c) => {
    const lower = c.text.toLowerCase();
    let score = 0;
    for (const w of qWords) {
      // Count exact word occurrences
      const regex = new RegExp(`\\b${w}`, 'gi');
      const matches = lower.match(regex);
      score += matches ? matches.length : 0;
    }
    // Boost if URL path contains a keyword (e.g. /admission)
    const urlLower = c.url.toLowerCase();
    for (const w of qWords) {
      if (urlLower.includes(w)) score += 10;
    }
    return { ...c, score };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Collect top chunks up to maxChars
  let collected = '';
  const sources: { url: string; excerpt: string }[] = [];
  for (const chunk of scored) {
    if (collected.length >= maxChars) break;
    const addition = `\n--- Page: ${chunk.url} ---\n${chunk.text}`;
    collected += addition.slice(0, maxChars - collected.length);
    sources.push({
      url: chunk.url,
      excerpt: chunk.text.slice(0, 240),
    });
  }

  return { relevant: collected, sources };
}

async function aiAnswer(question: string, content: string): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL_CHAT || 'gpt-4o',
    temperature: 0,
    messages: [
      {
        role: 'system',
        content:
          'You are a helpful school-information assistant for parents. ' +
          'Answer the question using ONLY the provided website content. ' +
          'If the information is partially available, share what you found. ' +
          'Only say "not found" if the content truly has zero relevant information. ' +
          'Be specific and cite page URLs when possible.',
      },
      { role: 'user', content: `Question: ${question}\n\nWebsite content:\n${content}` },
    ],
  });

  return completion.choices[0]?.message?.content ?? null;
}

/* ================================================================== */
/*  POST /api/scan — now enqueues classification first                 */
/* ================================================================== */

app.post('/api/scan', async (req, res) => {
  const parsed = scanSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid URL' });

  const normalizedUrl = normalizeUrl(parsed.data.url);
  const urlHash = hashUrl(normalizedUrl);
  const cacheKey = `analysis:v1:${urlHash}`;

  // Check cache
  const cachedSessionId = await redis.get(cacheKey);
  if (cachedSessionId) {
    const cached = await pgPool.query(
      'SELECT id, status, overall_score, summary, completed_at FROM analysis_sessions WHERE id = $1',
      [cachedSessionId],
    );
    if (cached.rowCount) return res.json({ cached: true, sessionId: cached.rows[0].id, session: cached.rows[0] });
  }

  const insert = await pgPool.query(
    `INSERT INTO analysis_sessions (url, url_hash, status)
     VALUES ($1, $2, 'Classifying')
     ON CONFLICT (url_hash) DO UPDATE SET status = analysis_sessions.status
     RETURNING id, status`,
    [normalizedUrl, urlHash],
  );

  const sessionId = insert.rows[0].id as string;
  const existingStatus = insert.rows[0].status as string;

  if (existingStatus !== 'Classifying') {
    await redis.set(cacheKey, sessionId, 'EX', 3600);
    return res.json({ cached: true, sessionId, status: existingStatus });
  }

  // Enqueue classification (step 1 of pipeline)
  await classifyQueue.add('classify-job', {
    sessionId,
    url: normalizedUrl,
    maxPages: Number(process.env.CRAWLER_MAX_PAGES || 30),
  });

  return res.status(202).json({ cached: false, sessionId, status: 'Classifying' });
});

/* ================================================================== */
/*  GET /api/scan/:id/events — SSE real-time streaming                 */
/*  (must be registered BEFORE /api/scan/:id so Express matches it)    */
/* ================================================================== */

app.get('/api/scan/:id/events', async (req, res) => {
  const sessionId = req.params.id;

  // Validate session exists
  const check = await pgPool.query('SELECT status FROM analysis_sessions WHERE id = $1', [sessionId]);
  if (!check.rowCount) return res.status(404).json({ error: 'Not found' });

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  // 1. Replay events from Redis Stream
  const streamKey = `sse:stream:${sessionId}`;
  try {
    const entries = await redis.xrange(streamKey, '-', '+');
    for (const [, fields] of entries) {
      const data: Record<string, string> = {};
      for (let i = 0; i < fields.length; i += 2) {
        data[fields[i]] = fields[i + 1];
      }
      res.write(`event: ${data.type || 'message'}\ndata: ${data.payload || '{}'}\n\n`);
    }
  } catch { /* stream may not exist yet */ }

  // 2. Subscribe to live channel
  const redisUrl = process.env.REDIS_URL;
  const subscriber = redisUrl ? new Redis(redisUrl) : new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT || 6379),
    password: process.env.REDIS_PASSWORD || undefined,
  });

  const channel = `sse:live:${sessionId}`;
  await subscriber.subscribe(channel);

  subscriber.on('message', (_ch: string, message: string) => {
    try {
      const parsed = JSON.parse(message);
      res.write(`event: ${parsed.type || 'message'}\ndata: ${JSON.stringify(parsed.data || {})}\n\n`);

      // Auto-close on terminal events
      if (parsed.type === 'complete' || parsed.type === 'error') {
        setTimeout(() => {
          subscriber.unsubscribe(channel).catch(() => {});
          subscriber.quit().catch(() => {});
          res.end();
        }, 500);
      }
    } catch { /* ignore malformed */ }
  });

  // Heartbeat to keep connection alive
  const keepAlive = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 15_000);

  // Cleanup on client disconnect
  req.on('close', () => {
    clearInterval(keepAlive);
    subscriber.unsubscribe(channel).catch(() => {});
    subscriber.quit().catch(() => {});
  });
});

/* ================================================================== */
/*  GET /api/scan/:id — enriched response with scores + crawl stats    */
/* ================================================================== */

app.get('/api/scan/:id', async (req, res) => {
  const sessionId = req.params.id;

  // Fetch session
  const sessionResult = await pgPool.query(
    `SELECT id, url, status, overall_score, summary,
            pages_scanned, pdfs_scanned, images_scanned,
            max_depth_reached, structured_data_detected,
            scan_duration_ms, scan_confidence, scan_confidence_label,
            early_identity,
            created_at, completed_at
     FROM analysis_sessions WHERE id = $1`,
    [sessionId],
  );

  if (!sessionResult.rowCount) return res.status(404).json({ error: 'Not found' });

  const session = sessionResult.rows[0];
  const status = session.status as string;

  // Base response
  const response: Record<string, unknown> = {
    sessionId: session.id,
    url: session.url,
    status,
    createdAt: session.created_at,
  };

  // Classification data (available after classify step)
  const classResult = await pgPool.query(
    'SELECT is_educational, confidence, matched_keywords FROM education_classification WHERE session_id = $1',
    [sessionId],
  );
  if (classResult.rowCount) {
    const raw = classResult.rows[0].matched_keywords;
    // Handle both legacy (string[]) and new ({ keywords, missingIndicators, rejectionReasons }) formats
    const isNewFormat = raw && typeof raw === 'object' && !Array.isArray(raw) && 'keywords' in raw;
    response.classification = {
      isEducational: classResult.rows[0].is_educational,
      confidence: classResult.rows[0].confidence,
      matchedKeywords: isNewFormat ? raw.keywords : raw,
      missingIndicators: isNewFormat ? raw.missingIndicators : [],
      rejectionReasons: isNewFormat ? raw.rejectionReasons : [],
    };
  }

  // If rejected, return early with message
  if (status === 'Rejected') {
    const cls = response.classification as { rejectionReasons?: string[] } | undefined;
    response.message = cls?.rejectionReasons?.length
      ? 'We could not confidently verify this as an educational website. See the detailed reasons below.'
      : 'This website does not appear to be an educational institution. SchoolLens currently supports school and educational website analysis only.';
    return res.json(response);
  }

  // Crawl summary (available after crawl step)
  if (session.pages_scanned > 0 || status === 'Scoring' || status === 'Ready') {
    response.crawlSummary = {
      pagesScanned: session.pages_scanned ?? 0,
      pdfsScanned: session.pdfs_scanned ?? 0,
      imagesScanned: session.images_scanned ?? 0,
      depthReached: session.max_depth_reached ?? 0,
      structuredDataDetected: session.structured_data_detected ?? false,
      scanTimeSeconds: session.scan_duration_ms ? Math.round(session.scan_duration_ms / 1000) : null,
      scanConfidence: session.scan_confidence,
      scanConfidenceLabel: session.scan_confidence_label,
    };
  }

  // Early identity (available during Crawling / Scoring — homepage-extracted signals)
  if (session.early_identity) {
    response.earlyIdentity = session.early_identity;
  }

  // Safety + Clarity scores (available when Ready)
  if (status === 'Ready') {
    response.overallScore = session.overall_score;
    response.summary = session.summary;
    response.completedAt = session.completed_at;

    const safetyResult = await pgPool.query(
      `SELECT total_score, badge_level,
              fire_certificate, sanitary_certificate, cctv_mention,
              transport_safety, anti_bullying_policy, raw_evidence
       FROM safety_scores WHERE session_id = $1`,
      [sessionId],
    );
    if (safetyResult.rowCount) {
      const s = safetyResult.rows[0];
      const evidence = (s.raw_evidence || {}) as Record<string, string | null>;
      response.safetyScore = {
        total: s.total_score,
        badge: s.badge_level,
        items: {
          fireCertificate: { status: s.fire_certificate, evidence: evidence.fire_evidence ?? null },
          sanitaryCertificate: { status: s.sanitary_certificate, evidence: evidence.sanitary_evidence ?? null },
          cctvMention: { status: s.cctv_mention, evidence: evidence.cctv_evidence ?? null },
          transportSafety: { status: s.transport_safety, evidence: evidence.transport_evidence ?? null },
          antiBullyingPolicy: { status: s.anti_bullying_policy, evidence: evidence.anti_bullying_evidence ?? null },
        },
      };
    }

    const clarityResult = await pgPool.query(
      `SELECT total_score, clarity_label,
              admission_dates_visible, fee_clarity, academic_calendar,
              contact_and_map, results_published
       FROM clarity_scores WHERE session_id = $1`,
      [sessionId],
    );
    if (clarityResult.rowCount) {
      const c = clarityResult.rows[0];
      response.clarityScore = {
        total: c.total_score,
        label: c.clarity_label,
        note: c.total_score < 60 ? 'Parents may need to call the school for missing information.' : null,
        items: {
          admissionDatesVisible: c.admission_dates_visible,
          feeClarity: c.fee_clarity,
          academicCalendar: c.academic_calendar,
          contactAndMap: c.contact_and_map,
          resultsPublished: c.results_published,
        },
      };
    }
  }

  return res.json(response);
});

/* ================================================================== */
/*  POST /internal/heartbeat — crawler heartbeat (stall detection)     */
/* ================================================================== */

app.post('/internal/heartbeat', async (req, res) => {
  if (!requireInternalKey(req, res)) return;
  const { sessionId } = req.body as { sessionId: string };
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

  await pgPool.query(
    `UPDATE analysis_sessions SET heartbeat_at = NOW() WHERE id = $1`,
    [sessionId],
  );
  res.json({ ok: true });
});

/* ================================================================== */
/*  POST /internal/classify-result — classification callback           */
/* ================================================================== */

app.post('/internal/classify-result', async (req, res) => {
  if (!requireInternalKey(req, res)) return;

  const { sessionId, url, maxPages, isEducational, confidence, matchedKeywords, missingIndicators, rejectionReasons } = req.body as {
    sessionId: string;
    url: string;
    maxPages: number;
    isEducational: boolean;
    confidence: number;
    matchedKeywords: string[];
    missingIndicators: string[];
    rejectionReasons: string[];
  };

  // Save classification result (store all data as JSON in matched_keywords column)
  const classificationData = {
    keywords: matchedKeywords,
    missingIndicators: missingIndicators || [],
    rejectionReasons: rejectionReasons || [],
  };
  await pgPool.query(
    `INSERT INTO education_classification (session_id, is_educational, confidence, matched_keywords)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (session_id) DO UPDATE SET is_educational = $2, confidence = $3, matched_keywords = $4`,
    [sessionId, isEducational, confidence, JSON.stringify(classificationData)],
  );

  if (isEducational) {
    // Update status to Crawling and enqueue full crawl
    await pgPool.query("UPDATE analysis_sessions SET status = 'Crawling' WHERE id = $1", [sessionId]);
    await crawlQueue.add('crawl-job', {
      sessionId,
      url,
      maxPages: maxPages || Number(process.env.CRAWLER_MAX_PAGES || 30),
    });
  } else {
    // Reject — not an educational institution
    await pgPool.query("UPDATE analysis_sessions SET status = 'Rejected', completed_at = NOW() WHERE id = $1", [sessionId]);
  }

  res.json({ ok: true });
});

/* ================================================================== */
/*  POST /internal/early-identity — saves homepage-extracted identity   */
/* ================================================================== */

app.post('/internal/early-identity', async (req, res) => {
  if (!requireInternalKey(req, res)) return;

  const { sessionId, identity } = req.body as {
    sessionId: string;
    identity: Record<string, unknown>;
  };

  if (!sessionId || !identity) return res.status(400).json({ error: 'Missing sessionId or identity' });

  await pgPool.query(
    `UPDATE analysis_sessions SET early_identity = $2 WHERE id = $1`,
    [sessionId, JSON.stringify(identity)],
  );

  res.json({ ok: true });
});

/* ================================================================== */
/*  POST /internal/crawl-result — saves crawl data + stats, enqueues scoring */
/* ================================================================== */

app.post('/internal/crawl-result', async (req, res) => {
  if (!requireInternalKey(req, res)) return;

  const {
    sessionId, pageUrl, title, extractedText,
    pages,
    pagesScanned, pdfsScanned, imagesScanned,
    maxDepthReached, structuredDataDetected,
    scanDurationMs, scanConfidence, scanConfidenceLabel,
    facts, preliminaryScore, playwrightBudgetUsed,
  } = req.body as {
    sessionId: string;
    pageUrl: string;
    title: string;
    extractedText: string;
    pages?: { url: string; title: string; text: string }[];
    pagesScanned: number;
    pdfsScanned: number;
    imagesScanned: number;
    maxDepthReached: number;
    structuredDataDetected: boolean;
    scanDurationMs: number;
    scanConfidence: number;
    scanConfidenceLabel: string;
    facts?: { key: string; value: string; confidence: number; sourceUrl: string; sourceType: string; evidence?: string }[];
    preliminaryScore?: { safety: number; clarity: number; overall: number };
    playwrightBudgetUsed?: number;
  };

  // Save per-page rows if available, otherwise fall back to combined blob
  if (pages && pages.length > 0) {
    for (const p of pages) {
      await pgPool.query(
        `INSERT INTO crawled_pages (session_id, page_url, title, extracted_text)
         VALUES ($1, $2, $3, $4)`,
        [sessionId, p.url, p.title, p.text.slice(0, 30_000)],
      );
    }
  } else {
    await pgPool.query(
      `INSERT INTO crawled_pages (session_id, page_url, title, extracted_text)
       VALUES ($1, $2, $3, $4)`,
      [sessionId, pageUrl, title, extractedText.slice(0, 50_000)],
    );
  }

  // Save extracted facts (V2)
  if (facts && facts.length > 0) {
    for (const f of facts) {
      const fingerprint = crypto.createHash('sha256').update(`${sessionId}:${f.key}:${f.value}:${f.sourceUrl}`).digest('hex');
      await pgPool.query(
        `INSERT INTO crawl_facts (session_id, fact_key, fact_value, confidence, source_url, source_type, fingerprint)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (fingerprint) DO NOTHING`,
        [sessionId, f.key, f.value, f.confidence, f.sourceUrl, f.sourceType, fingerprint],
      ).catch(() => { /* dedup conflict */ });
    }
  }

  // Update session with crawl stats + V2 fields
  await pgPool.query(
    `UPDATE analysis_sessions
     SET status = 'Scoring',
         pages_scanned = $2, pdfs_scanned = $3, images_scanned = $4,
         max_depth_reached = $5, structured_data_detected = $6,
         scan_duration_ms = $7, scan_confidence = $8, scan_confidence_label = $9,
         preliminary_score = COALESCE($10, preliminary_score),
         facts_extracted = COALESCE($11, facts_extracted),
         playwright_budget_used = COALESCE($12, playwright_budget_used)
     WHERE id = $1`,
    [
      sessionId, pagesScanned, pdfsScanned, imagesScanned,
      maxDepthReached, structuredDataDetected,
      scanDurationMs, scanConfidence, scanConfidenceLabel,
      preliminaryScore?.overall ?? null,
      facts?.length ?? null,
      playwrightBudgetUsed ?? null,
    ],
  );

  // Enqueue scoring
  await scoringQueue.add('score-job', { sessionId, url: pageUrl, extractedText });

  res.json({ ok: true });
});

/* ================================================================== */
/*  POST /internal/score-complete — saves safety + clarity scores      */
/* ================================================================== */

app.post('/internal/score-complete', async (req, res) => {
  if (!requireInternalKey(req, res)) return;

  const { sessionId, overallScore, summary, urlHash, safetyScore, clarityScore } = req.body as {
    sessionId: string;
    overallScore: number;
    summary: string;
    urlHash: string;
    safetyScore: {
      total: number;
      badge: string;
      fire_certificate: string;
      fire_evidence: string | null;
      sanitary_certificate: string;
      sanitary_evidence: string | null;
      cctv_mention: string;
      cctv_evidence: string | null;
      transport_safety: string;
      transport_evidence: string | null;
      anti_bullying_policy: string;
      anti_bullying_evidence: string | null;
    };
    clarityScore: {
      total: number;
      label: string;
      admission_dates_visible: boolean;
      fee_clarity: boolean;
      academic_calendar: boolean;
      contact_and_map: boolean;
      results_published: boolean;
    };
  };

  // Update session
  await pgPool.query(
    `UPDATE analysis_sessions
     SET status = 'Ready', overall_score = $1, summary = $2, completed_at = NOW()
     WHERE id = $3`,
    [overallScore, summary, sessionId],
  );

  // Upsert safety score
  const rawEvidence = JSON.stringify({
    fire_evidence: safetyScore.fire_evidence,
    sanitary_evidence: safetyScore.sanitary_evidence,
    cctv_evidence: safetyScore.cctv_evidence,
    transport_evidence: safetyScore.transport_evidence,
    anti_bullying_evidence: safetyScore.anti_bullying_evidence,
  });

  await pgPool.query(
    `INSERT INTO safety_scores
       (session_id, total_score, fire_certificate, sanitary_certificate, cctv_mention, transport_safety, anti_bullying_policy, badge_level, raw_evidence)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (session_id) DO UPDATE SET
       total_score = $2, fire_certificate = $3, sanitary_certificate = $4, cctv_mention = $5,
       transport_safety = $6, anti_bullying_policy = $7, badge_level = $8, raw_evidence = $9`,
    [
      sessionId, safetyScore.total,
      safetyScore.fire_certificate, safetyScore.sanitary_certificate,
      safetyScore.cctv_mention, safetyScore.transport_safety,
      safetyScore.anti_bullying_policy, safetyScore.badge,
      rawEvidence,
    ],
  );

  // Upsert clarity score
  await pgPool.query(
    `INSERT INTO clarity_scores
       (session_id, total_score, admission_dates_visible, fee_clarity, academic_calendar, contact_and_map, results_published, clarity_label)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (session_id) DO UPDATE SET
       total_score = $2, admission_dates_visible = $3, fee_clarity = $4,
       academic_calendar = $5, contact_and_map = $6, results_published = $7, clarity_label = $8`,
    [
      sessionId, clarityScore.total,
      clarityScore.admission_dates_visible, clarityScore.fee_clarity,
      clarityScore.academic_calendar, clarityScore.contact_and_map,
      clarityScore.results_published, clarityScore.label,
    ],
  );

  // Cache
  await redis.set(`analysis:v1:${urlHash}`, sessionId, 'EX', 86400);
  res.json({ ok: true });
});

/* ================================================================== */
/*  POST /api/scan/:id/ask — Q&A (unchanged logic)                    */
/* ================================================================== */

app.post('/api/scan/:id/ask', async (req, res) => {
  const parsed = questionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid question' });

  const sessionId = req.params.id;

  // Fetch ALL crawled pages for this session
  const pagesResult = await pgPool.query(
    'SELECT page_url, title, extracted_text FROM crawled_pages WHERE session_id = $1 ORDER BY fetched_at',
    [sessionId],
  );

  if (!pagesResult.rowCount) return res.status(404).json({ error: 'No crawl data found for this session' });

  const question = parsed.data.question;

  // Build combined text with URL markers from individual pages
  let fullContent = '';
  for (const row of pagesResult.rows) {
    fullContent += `\nURL: ${row.page_url}\n${row.extracted_text || ''}\n`;
  }

  // Find the most relevant content chunks for this question
  const { relevant, sources } = findRelevantContent(fullContent, question);

  const fallback = 'This information was not found on your website. Recommended addition: add a dedicated section with this answer.';

  let answer = fallback;
  try {
    answer = (await aiAnswer(question, relevant)) || fallback;
  } catch {
    answer = fallback;
  }

  // Build citations from the relevant pages found
  const citations = sources.slice(0, 5).map((s) => ({
    pageUrl: s.url,
    excerpt: s.excerpt,
  }));

  await pgPool.query(
    'INSERT INTO chat_messages (session_id, role, content, citations) VALUES ($1, $2, $3, $4), ($1, $5, $6, $7)',
    [sessionId, 'user', question, JSON.stringify([]), 'assistant', answer, JSON.stringify(citations)],
  );

  return res.json({ answer, citations });
});

/* ================================================================== */
/*  POST /api/b2b-interest — B2B CTA tracking                         */
/* ================================================================== */

app.post('/api/b2b-interest', async (req, res) => {
  const { sessionId } = req.body as { sessionId: string };
  if (!sessionId) return res.status(400).json({ error: 'sessionId required' });

  // Get URL from session
  const session = await pgPool.query('SELECT url FROM analysis_sessions WHERE id = $1', [sessionId]);
  if (!session.rowCount) return res.status(404).json({ error: 'Session not found' });

  await pgPool.query(
    'INSERT INTO b2b_leads (session_id, url) VALUES ($1, $2)',
    [sessionId, session.rows[0].url],
  );

  res.json({ ok: true, ctaUrl: process.env.B2B_CTA_URL || 'mailto:contact@edpicker.com' });
});

/* ================================================================== */
/*  Badge + Health                                                     */
/* ================================================================== */

app.post('/api/storage/badge/:sessionId', async (req, res) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="280" height="80"><rect width="280" height="80" fill="#0f172a"/><text x="12" y="30" fill="#fff" font-size="16">SchoolLens Score Badge</text><text x="12" y="58" fill="#93c5fd" font-size="20">Session ${req.params.sessionId}</text></svg>`;
  const path = `badges/${req.params.sessionId}.svg`;

  try {
    const location = await storage.uploadText(path, svg, 'image/svg+xml');
    return res.json({ ok: true, location });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'Storage upload failed' });
  }
});

app.get('/api/health', async (_req, res) => {
  try {
    await pgPool.query('SELECT 1');
  } catch (error) {
    return res.status(503).json({
      ok: false,
      dependency: 'postgres',
      message: 'Postgres connectivity check failed',
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    await redis.ping();
  } catch (error) {
    return res.status(503).json({
      ok: false,
      dependency: 'redis',
      message: 'Redis connectivity check failed',
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return res.json({
    ok: true,
    openAiConfigured: Boolean(process.env.OPENAI_API_KEY),
    queue: {
      classify: process.env.CLASSIFY_QUEUE_NAME || 'schoollens-classify',
      crawl: process.env.CRAWLER_QUEUE_NAME || 'schoollens-crawl',
      score: process.env.SCORING_QUEUE_NAME || 'schoollens-score',
    },
    storageProvider: process.env.STORAGE_PROVIDER || 's3',
  });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({
    ok: false,
    error: 'Internal server error',
  });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
