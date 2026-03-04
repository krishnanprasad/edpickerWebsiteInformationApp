import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import { Queue } from 'bullmq';
import { z } from 'zod';
import OpenAI from 'openai';
import { pgPool, redis } from './db.js';
import { FileStorageService } from './storage.js';

type Fact = {
  fact_type: string;
  fact_value: string;
  source_url: string;
  confidence: 'high' | 'medium';
  checked: boolean;
  found: boolean;
};

type HighlightItem = {
  point: string;
  source_url: string;
  confidence: 'high' | 'medium';
};

type RedFlagItem = {
  flag: string;
  severity: 'high' | 'medium';
  reason: string;
};

const app = express();
const port = Number(process.env.PORT || 3000);

const connection = {
  host: process.env.REDIS_HOST || undefined,
  port: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : undefined,
  password: process.env.REDIS_PASSWORD || undefined,
  url: process.env.REDIS_URL,
};

const crawlQueue = new Queue(process.env.CRAWLER_QUEUE_NAME || 'schoollens:crawl', { connection });
const scoringQueue = new Queue(process.env.SCORING_QUEUE_NAME || 'schoollens:score', { connection });

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

const redFlagSeverityMap: Record<string, 'high' | 'medium'> = {
  fees_not_disclosed: 'high',
  cbse_affiliation_not_found: 'high',
  no_contact_information: 'high',
  mandatory_disclosure_pdf_missing: 'high',
  website_not_updated_12_months: 'medium',
  no_transport_policy: 'medium',
  no_principal_name: 'medium',
  social_links_broken: 'medium',
};

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

function parseJsonArray<T>(content: string): T[] {
  const clean = content.replace(/```json/gi, '').replace(/```/g, '').trim();
  const parsed = JSON.parse(clean);
  return Array.isArray(parsed) ? parsed : [];
}

function validatePointAgainstFacts(point: string, facts: Fact[]): boolean {
  const p = point.toLowerCase();
  return facts.some((f) => {
    const fv = f.fact_value.toLowerCase();
    const token = fv.split(/[\s:,-]+/).filter((x) => x.length > 4)[0] || '';
    return token ? p.includes(token) : p.includes(f.fact_type.replace(/_/g, ' '));
  });
}

function extractFacts(text: string, sourceUrl: string): Fact[] {
  const lower = text.toLowerCase();
  const yearMatch = lower.match(/(20\d{2})/g);
  const newestYear = yearMatch?.length ? Math.max(...yearMatch.map(Number)) : null;
  const currentYear = new Date().getFullYear();

  const hasPhone = /\b\d{10}\b/.test(text);
  const hasEmail = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text);

  const facts: Fact[] = [
    { fact_type: 'fee_structure_disclosed', fact_value: lower.includes('fee') ? 'fee details present' : 'fee details not found', source_url: sourceUrl, confidence: 'high', checked: true, found: lower.includes('fee') },
    { fact_type: 'cbse_affiliation_number', fact_value: /affiliation\s*(no|number)?\s*[:#-]?\s*\w+/i.test(text) ? 'affiliation number found' : 'affiliation number not found', source_url: sourceUrl, confidence: 'high', checked: true, found: /affiliation\s*(no|number)?\s*[:#-]?\s*\w+/i.test(text) },
    { fact_type: 'contact_information', fact_value: hasPhone || hasEmail ? 'contact found' : 'contact not found', source_url: sourceUrl, confidence: 'high', checked: true, found: hasPhone || hasEmail },
    { fact_type: 'transport_policy', fact_value: lower.includes('transport') || lower.includes('bus') ? 'transport policy mentioned' : 'transport policy not found', source_url: sourceUrl, confidence: 'medium', checked: true, found: lower.includes('transport') || lower.includes('bus') },
    { fact_type: 'safety_policy', fact_value: lower.includes('safety') || lower.includes('cctv') ? 'safety mentioned' : 'safety not found', source_url: sourceUrl, confidence: 'medium', checked: true, found: lower.includes('safety') || lower.includes('cctv') },
    { fact_type: 'principal_name', fact_value: lower.includes('principal') ? 'principal name mentioned' : 'principal name not found', source_url: sourceUrl, confidence: 'medium', checked: true, found: lower.includes('principal') },
    { fact_type: 'fire_noc', fact_value: lower.includes('fire noc') || lower.includes('fire safety') ? 'fire noc mentioned' : 'fire noc not found', source_url: sourceUrl, confidence: 'medium', checked: true, found: lower.includes('fire noc') || lower.includes('fire safety') },
    { fact_type: 'mandatory_disclosure_pdf', fact_value: lower.includes('mandatory disclosure') || lower.includes('.pdf') ? 'mandatory disclosure pdf referenced' : 'mandatory disclosure pdf missing', source_url: sourceUrl, confidence: 'medium', checked: true, found: lower.includes('mandatory disclosure') || lower.includes('.pdf') },
    { fact_type: 'website_updated_recently', fact_value: newestYear ? `latest year ${newestYear}` : 'update year not found', source_url: sourceUrl, confidence: 'medium', checked: Boolean(newestYear), found: Boolean(newestYear && newestYear >= currentYear - 1) },
  ];

  return facts;
}

async function callAiArray(prompt: string): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  const completion = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL_CHAT || 'gpt-4o',
    temperature: 0,
    messages: [{ role: 'user', content: prompt }],
  });
  return completion.choices[0]?.message?.content ?? null;
}

async function getSessionFacts(sessionId: string): Promise<Fact[]> {
  const factsRows = await pgPool.query(
    `SELECT fact_type, fact_value, source_url, confidence, checked, found
     FROM crawl_facts
     WHERE session_id = $1 AND confidence IN ('high','medium')`,
    [sessionId],
  );
  return factsRows.rows as Fact[];
}

async function generateHighlights(sessionId: string): Promise<HighlightItem[]> {
  const facts = (await getSessionFacts(sessionId)).filter((f) => f.found);
  if (!facts.length) return [];

  const context = facts
    .map((f, i) => `${i + 1}. fact type: ${f.fact_type}; value: ${f.fact_value}; source URL: ${f.source_url}; confidence: ${f.confidence}`)
    .join('\n');

  const prompt = `You have access only to the following verified facts. Do not use any external knowledge.\n\n${context}\n\nYou are helping Indian parents evaluate a school. Based only on the following extracted facts from the school website, generate exactly 5 points a parent should know before choosing this school. Each point must be 1 to 2 lines maximum. Each point must be directly grounded in a fact that was extracted — do not invent or infer anything that is not in the data. If fewer than 5 facts are strong enough, return only the number you can confirm — never pad with assumptions. Format as a JSON array of objects with fields: point (string), source_url (string), confidence (high or medium). Do not return low confidence points.`;

  let aiItems: HighlightItem[] = [];
  try {
    const content = await callAiArray(prompt);
    if (content) {
      aiItems = parseJsonArray<HighlightItem>(content)
        .filter((x) => (x.confidence === 'high' || x.confidence === 'medium') && x.point && x.source_url)
        .filter((x) => validatePointAgainstFacts(x.point, facts));
    }
  } catch {
    aiItems = [];
  }

  if (aiItems.length) return aiItems.slice(0, 5);

  return facts.slice(0, 5).map((f) => ({
    point: `${f.fact_type.replace(/_/g, ' ')}: ${f.fact_value}`,
    source_url: f.source_url,
    confidence: f.confidence,
  }));
}

async function generateRedFlags(sessionId: string): Promise<RedFlagItem[]> {
  const facts = await getSessionFacts(sessionId);
  const missingChecked = facts.filter((f) => f.checked && !f.found);

  const mappedMissing = missingChecked.map((f) => {
    if (f.fact_type === 'fee_structure_disclosed') return 'fees_not_disclosed';
    if (f.fact_type === 'cbse_affiliation_number') return 'cbse_affiliation_not_found';
    if (f.fact_type === 'contact_information') return 'no_contact_information';
    if (f.fact_type === 'mandatory_disclosure_pdf') return 'mandatory_disclosure_pdf_missing';
    if (f.fact_type === 'website_updated_recently') return 'website_not_updated_12_months';
    if (f.fact_type === 'transport_policy') return 'no_transport_policy';
    if (f.fact_type === 'principal_name') return 'no_principal_name';
    return null;
  }).filter(Boolean) as string[];

  const uniqueMissing = [...new Set(mappedMissing)];

  const context = facts
    .map((f, i) => `${i + 1}. fact type: ${f.fact_type}; value: ${f.fact_value}; source URL: ${f.source_url}; confidence: ${f.confidence}; checked: ${f.checked}; found: ${f.found}`)
    .join('\n');

  const severityMapText = Object.entries(redFlagSeverityMap)
    .map(([k, v]) => `${k}: ${v}`)
    .join('; ');

  const prompt = `You have access only to the following verified facts. Do not use any external knowledge.\n\n${context}\n\nUse this exact severity map: ${severityMapText}.\n\nBased only on the extracted data from this school website, identify specific gaps, missing information, or concerns a parent should be aware of. A red flag is one of the following — fee structure not publicly disclosed, no CBSE affiliation number found, no safety or transport policy mentioned, website not updated in over 12 months, mandatory public disclosure PDF missing or unreadable, no contact information found, no principal name found, fire NOC not mentioned. Only flag something if the crawler explicitly searched for it and did not find it. Do not flag something as missing if the crawler did not check for it. Return a JSON array with fields: flag (string), severity (high or medium), reason (1 sentence explaining why this matters to a parent).`;

  let aiItems: RedFlagItem[] = [];
  try {
    const content = await callAiArray(prompt);
    if (content) {
      aiItems = parseJsonArray<RedFlagItem>(content).filter((x) => x.flag && x.reason);
    }
  } catch {
    aiItems = [];
  }

  if (!aiItems.length) {
    return uniqueMissing.map((missing) => ({
      flag: missing.replace(/_/g, ' '),
      severity: redFlagSeverityMap[missing] || 'medium',
      reason: 'This matters because parents cannot verify this critical item from public website content.',
    }));
  }

  return aiItems
    .map((x) => {
      const key = Object.keys(redFlagSeverityMap).find((k) => x.flag.toLowerCase().includes(k.replace(/_/g, ' ')));
      return {
        flag: x.flag,
        severity: key ? redFlagSeverityMap[key] : 'medium',
        reason: x.reason,
      } as RedFlagItem;
    })
    .filter((x) => x.severity === 'high' || x.severity === 'medium');
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
    `INSERT INTO analysis_sessions (url, url_hash, status, highlights_json, redflags_json)
     VALUES ($1, $2, 'Queued', NULL, NULL)
     ON CONFLICT (url_hash)
     DO UPDATE SET status='Queued', highlights_json=NULL, redflags_json=NULL, created_at=NOW(), completed_at=NULL
     RETURNING id`,
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
  if (!internalKey || internalKey !== process.env.INTERNAL_API_KEY) return res.status(401).json({ error: 'Unauthorized' });

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

  await pgPool.query('DELETE FROM crawl_facts WHERE session_id = $1', [sessionId]);
  const facts = extractFacts(extractedText || '', pageUrl);
  for (const fact of facts) {
    await pgPool.query(
      `INSERT INTO crawl_facts (session_id, fact_type, fact_value, source_url, confidence, checked, found)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [sessionId, fact.fact_type, fact.fact_value, fact.source_url, fact.confidence, fact.checked, fact.found],
    );
  }

  await scoringQueue.add('score-job', { sessionId, url: pageUrl, extractedText });
  res.json({ ok: true });
});

app.post('/internal/score-complete', async (req, res) => {
  const internalKey = req.headers['x-internal-key'];
  if (!internalKey || internalKey !== process.env.INTERNAL_API_KEY) return res.status(401).json({ error: 'Unauthorized' });

  const { sessionId, score, summary, urlHash } = req.body as {
    sessionId: string;
    score: number;
    summary: string;
    urlHash: string;
  };

  await pgPool.query(
    `UPDATE analysis_sessions
     SET status = 'Ready', overall_score = $1, summary = $2, highlights_json=NULL, redflags_json=NULL, completed_at = NOW()
     WHERE id = $3`,
    [score, summary, sessionId],
  );

  await redis.set(`analysis:v1:${urlHash}`, sessionId, 'EX', 86400);
  res.json({ ok: true });
});

app.get('/api/scan/:id/highlights', async (req, res) => {
  const id = req.params.id;
  const session = await pgPool.query('SELECT status, highlights_json, completed_at FROM analysis_sessions WHERE id=$1', [id]);
  if (!session.rowCount) return res.status(404).json({ error: 'Not found' });

  const row = session.rows[0];
  if (row.status === 'Failed') {
    return res.json({ status: 'incomplete', items: [], message: 'Analysis incomplete, limited data available.' });
  }
  if (row.status !== 'Ready') {
    return res.json({ status: 'running', items: [] });
  }

  if (row.highlights_json) {
    const refreshedHours = Math.max(0, Math.floor((Date.now() - new Date(row.completed_at).getTime()) / (1000 * 3600)));
    return res.json({ status: 'ready', cached: true, items: row.highlights_json, refreshedHours });
  }

  try {
    const items = await generateHighlights(id);
    await pgPool.query('UPDATE analysis_sessions SET highlights_json = $1 WHERE id = $2', [JSON.stringify(items), id]);
    const refreshedHours = Math.max(0, Math.floor((Date.now() - new Date(row.completed_at).getTime()) / (1000 * 3600)));
    return res.json({ status: 'ready', cached: false, items, refreshedHours });
  } catch {
    return res.json({ status: 'error', items: [], message: 'Could not generate highlights right now. You can view raw findings in the full report.' });
  }
});

app.get('/api/scan/:id/redflags', async (req, res) => {
  const id = req.params.id;
  const session = await pgPool.query('SELECT status, redflags_json, completed_at FROM analysis_sessions WHERE id=$1', [id]);
  if (!session.rowCount) return res.status(404).json({ error: 'Not found' });

  const row = session.rows[0];
  if (row.status === 'Failed') {
    return res.json({ status: 'incomplete', items: [], message: 'Analysis incomplete, limited data available.' });
  }
  if (row.status !== 'Ready') {
    return res.json({ status: 'running', items: [] });
  }

  if (row.redflags_json) {
    const refreshedHours = Math.max(0, Math.floor((Date.now() - new Date(row.completed_at).getTime()) / (1000 * 3600)));
    return res.json({ status: 'ready', cached: true, items: row.redflags_json, refreshedHours });
  }

  try {
    const items = await generateRedFlags(id);
    await pgPool.query('UPDATE analysis_sessions SET redflags_json = $1 WHERE id = $2', [JSON.stringify(items), id]);
    const refreshedHours = Math.max(0, Math.floor((Date.now() - new Date(row.completed_at).getTime()) / (1000 * 3600)));
    return res.json({ status: 'ready', cached: false, items, refreshedHours });
  } catch {
    return res.json({ status: 'error', items: [], message: 'Could not generate highlights right now. You can view raw findings in the full report.' });
  }
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
    if (process.env.OPENAI_API_KEY) {
      const completion = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL_CHAT || 'gpt-4o',
        temperature: 0,
        messages: [
          { role: 'system', content: 'Answer only from provided content. If missing, say not found and suggest addition.' },
          { role: 'user', content: `Question: ${question}\nContent:\n${content.slice(0, 9000)}` },
        ],
      });
      answer = completion.choices[0]?.message?.content || fallback;
    }
  } catch {
    answer = fallback;
  }

  const citations = [{ pageUrl: page.rows[0].page_url, excerpt: content.slice(0, 240) }];

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
  } catch {
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
