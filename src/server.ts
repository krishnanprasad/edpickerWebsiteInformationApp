import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import { Queue } from 'bullmq';
import { z } from 'zod';
import OpenAI from 'openai';
import { pgPool, redis } from './db.js';
import { FileStorageService } from './storage.js';

const app = express();
const port = Number(process.env.PORT || 3000);

const connection = {
  host: process.env.REDIS_HOST || undefined,
  port: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : undefined,
  password: process.env.REDIS_PASSWORD || undefined,
  url: process.env.REDIS_URL,
};

const crawlQueue = new Queue(process.env.CRAWLER_QUEUE_NAME || 'schoollens:crawl', {
  connection,
});

const scoringQueue = new Queue(process.env.SCORING_QUEUE_NAME || 'schoollens:score', {
  connection,
});

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

app.use(express.json());
app.use(express.static('public'));

const scanSchema = z.object({ url: z.string().url() });
const questionSchema = z.object({ question: z.string().min(3) });

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

async function aiAnswer(question: string, content: string): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL_CHAT || 'gpt-4o',
    temperature: 0,
    messages: [
      { role: 'system', content: 'Answer only from provided content. If missing, say not found and suggest addition.' },
      { role: 'user', content: `Question: ${question}\nContent:\n${content.slice(0, 9000)}` },
    ],
  });

  return completion.choices[0]?.message?.content ?? null;
}

app.post('/api/scan', async (req, res) => {
  const parsed = scanSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid URL' });

  const normalizedUrl = normalizeUrl(parsed.data.url);
  const urlHash = hashUrl(normalizedUrl);
  const cacheKey = `analysis:v1:${urlHash}`;

  const cachedSessionId = await redis.get(cacheKey);
  if (cachedSessionId) {
    const cached = await pgPool.query(
      'SELECT id, status, overall_score, summary, completed_at FROM analysis_sessions WHERE id = $1',
      [cachedSessionId],
    );
    if (cached.rowCount) return res.json({ cached: true, session: cached.rows[0] });
  }

  const insert = await pgPool.query(
    `INSERT INTO analysis_sessions (url, url_hash, status)
     VALUES ($1, $2, 'Queued') RETURNING id`,
    [normalizedUrl, urlHash],
  );

  const sessionId = insert.rows[0].id as string;

  await crawlQueue.add('crawl-job', {
    sessionId,
    url: normalizedUrl,
    maxPages: Number(process.env.CRAWLER_MAX_PAGES || 30),
  });

  return res.status(202).json({ cached: false, sessionId, status: 'Queued' });
});

app.get('/api/scan/:id', async (req, res) => {
  const data = await pgPool.query(
    'SELECT id, url, status, overall_score, summary, created_at, completed_at FROM analysis_sessions WHERE id = $1',
    [req.params.id],
  );

  if (!data.rowCount) return res.status(404).json({ error: 'Not found' });
  return res.json(data.rows[0]);
});

app.post('/internal/crawl-result', async (req, res) => {
  const internalKey = req.headers['x-internal-key'];
  if (!internalKey || internalKey !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { sessionId, pageUrl, title, extractedText } = req.body as {
    sessionId: string;
    pageUrl: string;
    title: string;
    extractedText: string;
  };

  await pgPool.query(
    `INSERT INTO crawled_pages (session_id, page_url, title, extracted_text)
     VALUES ($1, $2, $3, $4)`,
    [sessionId, pageUrl, title, extractedText.slice(0, 50000)],
  );

  await scoringQueue.add('score-job', { sessionId, url: pageUrl, extractedText });

  res.json({ ok: true });
});

app.post('/internal/score-complete', async (req, res) => {
  const internalKey = req.headers['x-internal-key'];
  if (!internalKey || internalKey !== process.env.INTERNAL_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { sessionId, score, summary, urlHash } = req.body as {
    sessionId: string;
    score: number;
    summary: string;
    urlHash: string;
  };

  await pgPool.query(
    `UPDATE analysis_sessions
     SET status = 'Ready', overall_score = $1, summary = $2, completed_at = NOW()
     WHERE id = $3`,
    [score, summary, sessionId],
  );

  await redis.set(`analysis:v1:${urlHash}`, sessionId, 'EX', 86400);
  res.json({ ok: true });
});

app.post('/api/scan/:id/ask', async (req, res) => {
  const parsed = questionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid question' });

  const sessionId = req.params.id;
  const page = await pgPool.query(
    'SELECT page_url, extracted_text FROM crawled_pages WHERE session_id = $1 ORDER BY fetched_at DESC LIMIT 1',
    [sessionId],
  );

  if (!page.rowCount) return res.status(404).json({ error: 'No crawl data found for this session' });

  const question = parsed.data.question;
  const content = (page.rows[0].extracted_text as string) || '';
  const fallback = 'This information was not found on your website. Recommended addition: add a dedicated section with this answer.';

  let answer = fallback;
  try {
    answer = (await aiAnswer(question, content)) || fallback;
  } catch {
    answer = fallback;
  }

  const citations = [
    {
      pageUrl: page.rows[0].page_url,
      excerpt: content.slice(0, 240),
    },
  ];

  await pgPool.query(
    'INSERT INTO chat_messages (session_id, role, content, citations) VALUES ($1, $2, $3, $4), ($1, $5, $6, $7)',
    [sessionId, 'user', question, JSON.stringify([]), 'assistant', answer, JSON.stringify(citations)],
  );

  return res.json({ answer, citations });
});

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
  await pgPool.query('SELECT 1');
  await redis.ping();
  res.json({
    ok: true,
    openAiConfigured: Boolean(process.env.OPENAI_API_KEY),
    queue: {
      crawl: process.env.CRAWLER_QUEUE_NAME || 'schoollens:crawl',
      score: process.env.SCORING_QUEUE_NAME || 'schoollens:score',
    },
    storageProvider: process.env.STORAGE_PROVIDER || 's3',
  });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
