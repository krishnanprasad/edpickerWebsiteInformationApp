import 'dotenv/config';
import 'express-async-errors';
import crypto from 'node:crypto';
import express from 'express';
import { Queue } from 'bullmq';
import { z } from 'zod';
import OpenAI from 'openai';
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

const inputUrlSchema = z.string()
  .min(1)
  .transform((raw) => coerceHttpUrl(raw))
  .refine((value) => isValidHttpUrl(value), { message: 'Invalid URL' });

const scanSchema = z.object({ url: inputUrlSchema });
const questionSchema = z.object({ question: z.string().min(3) });
const compareListIdSchema = z.object({ compareListId: z.string().uuid() });
const compareListAddSchema = z.object({
  url: inputUrlSchema,
  staleAction: z.enum(['add_anyway', 'refresh']).optional(),
});
const refreshSchema = z.object({});

function coerceHttpUrl(input: string): string {
  const trimmed = String(input || '').trim();
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function isValidHttpUrl(input: string): boolean {
  try {
    const parsed = new URL(input);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizeUrl(url: string): string {
  const parsed = new URL(coerceHttpUrl(url));
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
  return status === 'Ready' || status === 'Rejected' || status === 'Uncertain' || status === 'Failed' || status === 'Error';
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

const INDIAN_STATES = [
  'andhra pradesh', 'arunachal pradesh', 'assam', 'bihar', 'chhattisgarh', 'goa', 'gujarat',
  'haryana', 'himachal pradesh', 'jharkhand', 'karnataka', 'kerala', 'madhya pradesh',
  'maharashtra', 'manipur', 'meghalaya', 'mizoram', 'nagaland', 'odisha', 'punjab',
  'rajasthan', 'sikkim', 'tamil nadu', 'telangana', 'tripura', 'uttar pradesh',
  'uttarakhand', 'west bengal', 'delhi', 'chandigarh', 'puducherry', 'jammu and kashmir',
  'ladakh',
] as const;

const BOARD_VALUES = new Set(['CBSE', 'ICSE', 'STATE', 'IB', 'IGCSE', 'NIOS', 'OTHER']);
const SCHOOL_MUTABLE_FIELDS = new Set([
  'name',
  'established_year',
  'address_line1',
  'address_line2',
  'city',
  'state',
  'pincode',
  'phone_primary',
  'phone_secondary',
  'email_primary',
  'email_secondary',
  'principal_name',
  'principal_email',
  'principal_phone',
  'board',
  'social_facebook',
  'social_instagram',
  'social_youtube',
  'social_twitter',
  'social_linkedin',
  'social_whatsapp',
  'vision_text',
  'mission_text',
  'motto_text',
  'summary_text',
]);

type MandatoryDocumentStatus = 'present' | 'missing' | 'needs_review';

interface CrawlMandatoryDocument {
  code: string;
  name: string;
  status: MandatoryDocumentStatus;
  sourceUrl?: string | null;
  expiryDate?: string | null;
  details?: Record<string, unknown>;
  reviewMessage?: string | null;
  confidence?: number;
}

function normalizeMandatoryDocumentStatus(value: unknown): MandatoryDocumentStatus {
  const v = String(value || '').toLowerCase();
  if (v === 'present' || v === 'missing' || v === 'needs_review') return v;
  return 'needs_review';
}

function normalizeDateInput(value: unknown): string | null {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const dt = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return null;
  if (dt.toISOString().slice(0, 10) !== raw) return null;
  return raw;
}

function normalizeWebsiteDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = String(input).trim().toLowerCase();
  if (!raw) return null;
  try {
    const parsed = raw.includes('://') ? new URL(raw) : new URL(`https://${raw}`);
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    return host || null;
  } catch {
    return null;
  }
}

function cleanText(value: unknown, maxLen: number): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.slice(0, maxLen);
}

function sanitizePhone(value: unknown, opts?: { allowPlus?: boolean }): string | null {
  if (!value && value !== 0) return null;
  let s = String(value).trim();
  if (!s) return null;
  if (opts?.allowPlus) {
    s = s.replace(/[^0-9+]/g, '');
    s = s.replace(/(?!^)\+/g, '');
  } else {
    s = s.replace(/\D/g, '');
  }
  if (s.length < 7 || s.length > 20) return null;
  return s;
}

function extractPhones(value: unknown): string[] {
  if (!value) return [];
  const raw = String(value);
  const matches = raw.match(/\+?\d[\d\s\-()]{6,}\d/g) || [];
  const seen = new Set<string>();
  for (const m of matches) {
    const cleaned = sanitizePhone(m, { allowPlus: true });
    if (!cleaned) continue;
    seen.add(cleaned);
  }
  return Array.from(seen).slice(0, 2);
}

function extractEmails(value: unknown): string[] {
  if (!value) return [];
  const raw = String(value).toLowerCase();
  const matches = raw.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) || [];
  return Array.from(new Set(matches.map((m) => m.trim()))).slice(0, 2);
}

function confidenceLabelToScore(level: unknown): number {
  const v = String(level || '').toLowerCase();
  if (v === 'high') return 90;
  if (v === 'medium') return 70;
  if (v === 'low') return 50;
  return 70;
}

function normalizeBoardFromKeywords(matchedKeywords: unknown): string | null {
  if (!matchedKeywords || typeof matchedKeywords !== 'object') return null;
  const keywords = (matchedKeywords as Record<string, unknown>).matchedKeywords;
  const list = Array.isArray(keywords) ? keywords.map((k) => String(k).toLowerCase()) : [];
  if (list.some((k) => k.includes('cbse'))) return 'CBSE';
  if (list.some((k) => k.includes('icse') || k.includes('isc'))) return 'ICSE';
  if (list.some((k) => k.includes('igcse') || k.includes('cambridge'))) return 'IGCSE';
  if (list.some((k) => k.includes('international baccalaureate') || k.includes('ib'))) return 'IB';
  if (list.some((k) => k.includes('nios'))) return 'NIOS';
  if (list.some((k) => k.includes('state board'))) return 'STATE';
  return null;
}

function parseYear(value: unknown): number | null {
  if (!value && value !== 0) return null;
  const m = String(value).match(/\b(18|19|20)\d{2}\b/);
  if (!m) return null;
  const y = Number(m[0]);
  if (y < 1800 || y > 2100) return null;
  return y;
}

function toTitleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function parseAddressParts(addressRaw: unknown): {
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
} {
  const address = cleanText(addressRaw, 600);
  if (!address) {
    return { addressLine1: null, addressLine2: null, city: null, state: null, pincode: null };
  }

  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  const pincode = (address.match(/\b\d{6}\b/) || [])[0] || null;
  const lowerAddress = address.toLowerCase();

  let state: string | null = null;
  for (const candidate of INDIAN_STATES) {
    if (lowerAddress.includes(candidate)) {
      state = toTitleCase(candidate);
      break;
    }
  }

  let city: string | null = null;
  if (parts.length >= 2) {
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      const p = parts[i];
      const pLower = p.toLowerCase();
      if (pincode && p.includes(pincode)) continue;
      if (state && pLower.includes(state.toLowerCase())) continue;
      if (p.length >= 2 && p.length <= 100) {
        city = p.slice(0, 100);
        break;
      }
    }
  }

  const addressLine1 = cleanText(parts[0] || address, 300);
  const addressLine2 = cleanText(parts.slice(1, 3).join(', '), 300);
  return { addressLine1, addressLine2, city, state, pincode };
}

function normalizeSocialUrl(url: unknown, allowedHosts: string[]): string | null {
  const raw = cleanText(url, 500);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    const valid = allowedHosts.some((h) => host === h || host.endsWith(`.${h}`));
    if (!valid) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 240) || 'school';
}

async function buildUniqueSlug(base: string): Promise<string> {
  const baseSlug = slugify(base);
  let attempt = baseSlug;
  let counter = 2;
  while (counter < 1000) {
    const existing = await pgPool.query('SELECT id FROM schools WHERE slug = $1 LIMIT 1', [attempt]);
    if (!existing.rowCount) return attempt;
    attempt = `${baseSlug}-${counter}`;
    counter += 1;
  }
  return `${baseSlug}-${Date.now()}`;
}

function normalizeSchoolField(field: string, value: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (field === 'established_year') return parseYear(value);
  if (field === 'phone_primary' || field === 'phone_secondary' || field === 'principal_phone') return sanitizePhone(value, { allowPlus: true });
  if (field === 'social_whatsapp') return sanitizePhone(value, { allowPlus: false });
  if (field === 'email_primary' || field === 'email_secondary' || field === 'principal_email') return cleanText(value, 200)?.toLowerCase() || null;
  if (field === 'board') {
    const board = cleanText(value, 50)?.toUpperCase() || null;
    if (!board || !BOARD_VALUES.has(board)) return null;
    return board;
  }
  if (field === 'name' || field === 'principal_name') return cleanText(value, 200);
  if (field === 'address_line1' || field === 'address_line2') return cleanText(value, 300);
  if (field === 'city' || field === 'state' || field === 'medium_of_instruction') return cleanText(value, 100);
  if (field === 'pincode') return (cleanText(value, 10) || '').match(/^\d{6}$/)?.[0] || null;
  if (field.startsWith('social_')) return cleanText(value, 500);
  if (field === 'motto_text') return cleanText(value, 200);
  if (field === 'vision_text' || field === 'mission_text') return cleanText(value, 600);
  if (field === 'summary_text') return cleanText(value, 1200);
  return cleanText(value, 500);
}

async function applySchoolFieldMerge(params: {
  schoolId: string;
  field: string;
  value: unknown;
  confidence: number;
  sourceUrl: string | null;
  sourceType: string;
  sessionId: string;
}) {
  const { schoolId, field, value, confidence, sourceUrl, sourceType, sessionId } = params;
  if (!SCHOOL_MUTABLE_FIELDS.has(field)) return;
  const normalizedValue = normalizeSchoolField(field, value);
  if (normalizedValue === null || normalizedValue === '') return;

  const metaRes = await pgPool.query(
    `SELECT confidence, is_manually_verified
     FROM school_field_meta
     WHERE school_id = $1 AND field_name = $2`,
    [schoolId, field],
  );

  if (metaRes.rowCount) {
    const row = metaRes.rows[0];
    if (Boolean(row.is_manually_verified)) return;
    const existingConfidence = row.confidence === null ? 0 : Number(row.confidence);
    if (existingConfidence > confidence) return;
  }

  await pgPool.query(`UPDATE schools SET ${field} = $2, updated_at = NOW() WHERE id = $1`, [schoolId, normalizedValue]);
  await pgPool.query(
    `INSERT INTO school_field_meta
      (school_id, field_name, confidence, source_url, source_type, last_session_id, is_manually_verified)
     VALUES ($1, $2, $3, $4, $5, $6, FALSE)
     ON CONFLICT (school_id, field_name) DO UPDATE SET
       confidence = EXCLUDED.confidence,
       source_url = EXCLUDED.source_url,
       source_type = EXCLUDED.source_type,
       last_session_id = EXCLUDED.last_session_id,
       updated_at = NOW()`,
    [schoolId, field, Math.max(0, Math.min(100, Math.round(confidence))), sourceUrl, sourceType, sessionId],
  );
}

async function upsertSchoolMandatoryDocuments(params: {
  schoolId: string;
  sessionId: string;
  documents: CrawlMandatoryDocument[];
}) {
  const { schoolId, sessionId, documents } = params;
  for (const doc of documents) {
    const codeRaw = cleanText(doc.code, 80)?.toLowerCase() || null;
    const code = codeRaw ? codeRaw.replace(/[^a-z0-9_]+/g, '_').replace(/_{2,}/g, '_').replace(/^_|_$/g, '') : null;
    const name = cleanText(doc.name, 200);
    if (!code || !name) continue;

    const status = normalizeMandatoryDocumentStatus(doc.status);
    const sourceUrl = cleanText(doc.sourceUrl, 500);
    const expiryDate = normalizeDateInput(doc.expiryDate);
    const details = doc.details && typeof doc.details === 'object' ? doc.details : {};
    const reviewMessage = cleanText(doc.reviewMessage, 500);
    const confidence = Math.max(0, Math.min(100, Math.round(Number(doc.confidence ?? 0))));

    await pgPool.query(
      `INSERT INTO school_mandatory_documents
        (school_id, session_id, document_code, document_name, status, source_url, expiry_date, extracted_details, review_message, confidence, checked_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8::jsonb, $9, $10, NOW())
       ON CONFLICT (school_id, document_code) DO UPDATE SET
         session_id = EXCLUDED.session_id,
         document_name = EXCLUDED.document_name,
         status = EXCLUDED.status,
         source_url = EXCLUDED.source_url,
         expiry_date = EXCLUDED.expiry_date,
         extracted_details = EXCLUDED.extracted_details,
         review_message = EXCLUDED.review_message,
         confidence = EXCLUDED.confidence,
         checked_at = NOW(),
         updated_at = NOW()`,
      [schoolId, sessionId, code, name, status, sourceUrl, expiryDate, JSON.stringify(details), reviewMessage, confidence],
    );
  }
}

function derivePersistentCrawlStatus(scanConfidence: number | null | undefined, scanConfidenceLabel: string | null | undefined, factsCount: number, pagesScanned: number): 'analysed' | 'partial' {
  const lowByLabel = String(scanConfidenceLabel || '').toLowerCase().includes('low');
  if (lowByLabel || (scanConfidence ?? 0) < 50 || factsCount === 0 || pagesScanned <= 1) return 'partial';
  return 'analysed';
}

async function upsertSchoolFromSession(params: {
  sessionId: string;
  crawlStatus: 'analysed' | 'partial' | 'failed';
  crawlFailReason?: string | null;
  summaryText?: string | null;
}): Promise<string | null> {
  const { sessionId, crawlStatus, crawlFailReason, summaryText } = params;
  const sessionRes = await pgPool.query(
    `SELECT s.url, s.early_identity, s.summary, ec.matched_keywords
     FROM analysis_sessions s
     LEFT JOIN education_classification ec ON ec.session_id = s.id
     WHERE s.id = $1`,
    [sessionId],
  );
  if (!sessionRes.rowCount) return null;

  const row = sessionRes.rows[0];
  const sourceUrl = cleanText(row.url, 500);
  const websiteUrl = normalizeWebsiteDomain(sourceUrl);
  if (!websiteUrl) return null;

  const identity = (row.early_identity && typeof row.early_identity === 'object')
    ? (row.early_identity as Record<string, unknown>)
    : {};
  const parsedAddress = parseAddressParts(identity.address);
  const extractedName = cleanText(identity.schoolName, 200) || safeHostnameLabel(sourceUrl || websiteUrl);
  const baseSlug = `${extractedName}${parsedAddress.city ? ` ${parsedAddress.city}` : ''}`;

  let schoolRes = await pgPool.query(`SELECT id FROM schools WHERE website_url = $1 LIMIT 1`, [websiteUrl]);
  let schoolId: string;
  if (!schoolRes.rowCount) {
    const slug = await buildUniqueSlug(baseSlug);
    const inserted = await pgPool.query(
      `INSERT INTO schools (name, slug, website_url, raw_input_url, crawl_status, data_source, last_crawled_at, crawl_fail_reason)
       VALUES ($1, $2, $3, $4, $5::text, 'crawl', CASE WHEN $5::text IN ('analysed','partial') THEN NOW() ELSE NULL END, $6::text)
       RETURNING id`,
      [extractedName, slug, websiteUrl, sourceUrl, crawlStatus, crawlFailReason || null],
    );
    schoolId = String(inserted.rows[0].id);
  } else {
    schoolId = String(schoolRes.rows[0].id);
    await pgPool.query(
      `UPDATE schools
       SET crawl_status = $2::text,
           last_crawled_at = CASE WHEN $2::text IN ('analysed','partial') THEN NOW() ELSE last_crawled_at END,
           crawl_fail_reason = $3::text,
           raw_input_url = COALESCE(raw_input_url, $4::text),
           updated_at = NOW()
       WHERE id = $1`,
      [schoolId, crawlStatus, crawlFailReason || null, sourceUrl],
    );
  }

  const phones = extractPhones(identity.phone);
  const emails = extractEmails(identity.email);
  const social = (identity.socialUrls && typeof identity.socialUrls === 'object')
    ? (identity.socialUrls as Record<string, unknown>)
    : {};
  const board = normalizeBoardFromKeywords(row.matched_keywords);
  const confidenceBase = 75;

  await applySchoolFieldMerge({ schoolId, field: 'name', value: extractedName, confidence: 90, sourceUrl, sourceType: 'html', sessionId });
  await applySchoolFieldMerge({ schoolId, field: 'established_year', value: identity.foundingYear, confidence: confidenceBase, sourceUrl, sourceType: 'html', sessionId });
  await applySchoolFieldMerge({ schoolId, field: 'address_line1', value: parsedAddress.addressLine1, confidence: confidenceBase, sourceUrl, sourceType: 'html', sessionId });
  await applySchoolFieldMerge({ schoolId, field: 'address_line2', value: parsedAddress.addressLine2, confidence: confidenceBase, sourceUrl, sourceType: 'html', sessionId });
  await applySchoolFieldMerge({ schoolId, field: 'city', value: parsedAddress.city, confidence: 65, sourceUrl, sourceType: 'html', sessionId });
  await applySchoolFieldMerge({ schoolId, field: 'state', value: parsedAddress.state, confidence: 65, sourceUrl, sourceType: 'html', sessionId });
  await applySchoolFieldMerge({ schoolId, field: 'pincode', value: parsedAddress.pincode, confidence: 70, sourceUrl, sourceType: 'html', sessionId });
  await applySchoolFieldMerge({ schoolId, field: 'phone_primary', value: phones[0] || null, confidence: 85, sourceUrl, sourceType: 'html', sessionId });
  await applySchoolFieldMerge({ schoolId, field: 'phone_secondary', value: phones[1] || null, confidence: 80, sourceUrl, sourceType: 'html', sessionId });
  await applySchoolFieldMerge({ schoolId, field: 'email_primary', value: emails[0] || null, confidence: 85, sourceUrl, sourceType: 'html', sessionId });
  await applySchoolFieldMerge({ schoolId, field: 'email_secondary', value: emails[1] || null, confidence: 80, sourceUrl, sourceType: 'html', sessionId });
  await applySchoolFieldMerge({ schoolId, field: 'principal_name', value: identity.principalName, confidence: 75, sourceUrl, sourceType: 'html', sessionId });
  await applySchoolFieldMerge({ schoolId, field: 'vision_text', value: identity.vision, confidence: confidenceLabelToScore(identity.visionConfidence), sourceUrl, sourceType: 'html', sessionId });
  await applySchoolFieldMerge({ schoolId, field: 'mission_text', value: identity.mission, confidence: confidenceLabelToScore(identity.missionConfidence), sourceUrl, sourceType: 'html', sessionId });
  await applySchoolFieldMerge({ schoolId, field: 'motto_text', value: identity.motto, confidence: confidenceLabelToScore(identity.mottoConfidence), sourceUrl, sourceType: 'html', sessionId });
  await applySchoolFieldMerge({
    schoolId, field: 'social_facebook',
    value: normalizeSocialUrl(social.facebook, ['facebook.com', 'fb.com']),
    confidence: 80, sourceUrl, sourceType: 'html', sessionId,
  });
  await applySchoolFieldMerge({
    schoolId, field: 'social_instagram',
    value: normalizeSocialUrl(social.instagram, ['instagram.com']),
    confidence: 80, sourceUrl, sourceType: 'html', sessionId,
  });
  await applySchoolFieldMerge({
    schoolId, field: 'social_youtube',
    value: normalizeSocialUrl(social.youtube, ['youtube.com', 'youtu.be']),
    confidence: 80, sourceUrl, sourceType: 'html', sessionId,
  });
  await applySchoolFieldMerge({
    schoolId, field: 'social_twitter',
    value: normalizeSocialUrl(social.twitter, ['twitter.com', 'x.com']),
    confidence: 80, sourceUrl, sourceType: 'html', sessionId,
  });
  await applySchoolFieldMerge({
    schoolId, field: 'social_linkedin',
    value: normalizeSocialUrl(social.linkedin, ['linkedin.com']),
    confidence: 80, sourceUrl, sourceType: 'html', sessionId,
  });
  await applySchoolFieldMerge({
    schoolId, field: 'social_whatsapp',
    value: sanitizePhone(identity.phone, { allowPlus: false }),
    confidence: 60, sourceUrl, sourceType: 'html', sessionId,
  });
  await applySchoolFieldMerge({ schoolId, field: 'board', value: board, confidence: 70, sourceUrl, sourceType: 'classification', sessionId });
  await applySchoolFieldMerge({
    schoolId,
    field: 'summary_text',
    value: cleanText(summaryText || row.summary, 1200),
    confidence: 85,
    sourceUrl,
    sourceType: 'ai_summary',
    sessionId,
  });

  return schoolId;
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
    await pgPool.query('DELETE FROM school_mandatory_documents WHERE session_id = $1', [sessionId]).catch(() => {});

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
        content: `You are SchoolLens, a trusted school-research assistant helping Indian parents make informed decisions about schools.

Your job is to answer parent questions using ONLY the school website content provided. Parents ask about admissions, fees, safety, academics, facilities, and policies.

RULES — follow strictly:
1. LEAD WITH WHAT EXISTS. If the website mentions admissions are open, fee ranges, grades offered, or any related fact — share it immediately, even if the exact detail asked for (e.g. specific dates or exact fee amount) is missing.
2. DISTINGUISH availability from details. Example: "Admissions are currently open for Pre-primary 1 to Grade 8" is a valid answer to "What are the admission dates?" — always share this rather than saying "not found".
3. Only say information is not available if the website content has ZERO sentences related to the topic — this should be rare.
4. Format: 2–4 sentences. Use plain English. If multiple facts exist, use a short bullet list.
5. End with the source page URL when possible (e.g. "Source: yagappainternationalschool.org/admissions").
6. NEVER invent information. Only use what is in the provided content.
7. Indian context: rupee fees (₹), CBSE/ICSE/IB boards, academic year April–March, term exams, PTM (Parent-Teacher Meetings) — use these terms naturally if they appear in the content.`,
      },
      { role: 'user', content: `Parent question: ${question}\n\nSchool website content:\n${content}` },
    ],
  });

  return completion.choices[0]?.message?.content ?? null;
}

/** Build a plain-text answer from the best content chunk when AI is unavailable or returns nothing. */
function buildFallbackFromContent(
  question: string,
  sources: { url: string; excerpt: string }[],
): string {
  if (sources.length === 0) {
    return 'This information was not found on the school website. You may want to contact the school directly.';
  }

  // Pick the best source (already ranked)
  const best = sources[0];
  const snippet = best.excerpt.replace(/\s+/g, ' ').trim();

  return (
    `Based on the school website (${best.url}):\n` +
    `"${snippet.length > 400 ? snippet.slice(0, 400) + '…' : snippet}"\n\n` +
    `(AI analysis unavailable — showing raw extracted content. Exact details may differ.)`
  );
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
/*  GET /api/scan/:id/red-flags — AI-enriched parent red flags        */
/*  (registered BEFORE /api/scan/:id so Express matches it first)      */
/* ================================================================== */

app.get('/api/scan/:id/red-flags', async (req, res) => {
  const sessionId = req.params.id;

  const sessionRow = await pgPool.query(
    'SELECT status FROM analysis_sessions WHERE id = $1',
    [sessionId]
  );
  if (!sessionRow.rowCount) return res.status(404).json({ error: 'Session not found' });

  // Redis cache check
  const cacheKey = `red-flags:${sessionId}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      const parsed: unknown = JSON.parse(cached);
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ ...(parsed as object), fromCache: true });
    }
  } catch (_) { /* cache miss — continue */ }

  type RuleFlag = { severity: 'high' | 'medium'; flag: string; reason: string };
  const flags: RuleFlag[] = [];

  // ── Rule-based flags from safety_scores ────────────────────────────
  const safetyRow = await pgPool.query(
    `SELECT fire_certificate, sanitary_certificate, cctv_mention, transport_safety, anti_bullying_policy
     FROM safety_scores WHERE session_id = $1`,
    [sessionId]
  );
  if (safetyRow.rowCount) {
    const s = safetyRow.rows[0];
    if (s.fire_certificate === 'missing')
      flags.push({ severity: 'high', flag: 'No fire safety certificate mentioned', reason: 'The school website does not mention a valid fire safety certificate — a mandatory compliance requirement.' });
    else if (s.fire_certificate === 'unclear')
      flags.push({ severity: 'medium', flag: 'Fire safety certificate status unclear', reason: 'A fire safety certificate was referenced but the evidence is ambiguous or outdated.' });

    if (s.sanitary_certificate === 'missing')
      flags.push({ severity: 'high', flag: 'No sanitary / health certificate found', reason: 'No health or sanitary inspection certificate is mentioned on the school website.' });
    else if (s.sanitary_certificate === 'unclear')
      flags.push({ severity: 'medium', flag: 'Sanitary certificate status unclear', reason: 'Health or sanitary certificate information is present but ambiguous.' });

    if (s.cctv_mention === 'missing')
      flags.push({ severity: 'medium', flag: 'No CCTV / surveillance disclosure', reason: 'The school does not disclose whether CCTV cameras are installed — an important safety indicator.' });

    if (s.transport_safety === 'missing')
      flags.push({ severity: 'medium', flag: 'No transport safety information', reason: 'No mention of GPS tracking, trained drivers, or attendants on school buses was found.' });

    if (s.anti_bullying_policy === 'missing')
      flags.push({ severity: 'medium', flag: 'No anti-bullying policy found', reason: 'CBSE and NCPCR guidelines require schools to publish an anti-bullying policy. None was found.' });
  }

  // ── Rule-based flags from clarity_scores ───────────────────────────
  const clarityRow = await pgPool.query(
    `SELECT fee_clarity, admission_dates_visible, contact_and_map, results_published, academic_calendar
     FROM clarity_scores WHERE session_id = $1`,
    [sessionId]
  );
  if (clarityRow.rowCount) {
    const c = clarityRow.rows[0];
    if (!c.fee_clarity)
      flags.push({ severity: 'high', flag: 'Fee structure not disclosed', reason: 'Families cannot find clear fee breakdowns. CBSE mandates fee transparency on school websites.' });
    if (!c.admission_dates_visible)
      flags.push({ severity: 'medium', flag: 'Admission timeline not published', reason: 'No clear admission process or deadline dates were found on the website.' });
    if (!c.contact_and_map)
      flags.push({ severity: 'medium', flag: 'Contact details or location map missing', reason: 'Adequate contact information and/or school location map was not easily accessible.' });
    if (!c.results_published)
      flags.push({ severity: 'medium', flag: 'Academic results not published', reason: 'No board exam results or school performance metrics were published on the website.' });
    if (!c.academic_calendar)
      flags.push({ severity: 'medium', flag: 'Academic calendar not provided', reason: 'No academic calendar or holiday schedule was found — important for family planning.' });
  }

  // ── Optional OpenAI enrichment (up to 2 extra flags) ───────────────
  if (process.env.OPENAI_API_KEY && flags.length < 7) {
    try {
      const factsRow = await pgPool.query(
        `SELECT fact_key, fact_value FROM crawl_facts WHERE session_id = $1 ORDER BY confidence DESC LIMIT 20`,
        [sessionId]
      );
      const factLines = (factsRow.rows as { fact_key: string; fact_value: string }[])
        .map(r => `${r.fact_key}: ${r.fact_value}`)
        .join('\n');
      const existingTitles = flags.map(f => f.flag).join('; ') || 'none';

      const completion = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL_SCORING || 'gpt-4o-mini',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You are a school transparency auditor helping Indian parents identify real concerns before choosing a school. You review school website data and flag genuine issues.

HIGH severity = serious safety or legal compliance gap that could put a child at risk or mislead parents:
- No mention of fire NOC / fire safety certificate
- No anti-bullying policy anywhere on the site
- No fee structure published (hidden fees risk)
- Claims certifications without evidence

MEDIUM severity = important missing information that affects parenting decisions:
- Admission process vague or undocumented
- No clear contact number or address
- Academic calendar not published
- No mention of transport safety or GPS tracking
- Results/pass rates not published

RULES:
- Only flag genuine concerns backed by the provided facts
- Do NOT flag things that are just "good to have" or marketing gaps
- Write flag titles in plain English (max 7 words), reason in one clear sentence a parent would understand
- Return { "flags": [] } if the school already covers the concern
- Output valid JSON only`,
          },
          {
            role: 'user',
            content: `School facts extracted from their website:\n${factLines || 'No facts extracted.'}\n\nAlready identified flags (do NOT duplicate): [${existingTitles}]\n\nIdentify up to 2 additional red flags Indian parents should know about.\n\nRespond with JSON: { "flags": [ { "severity": "high"|"medium", "flag": "short title max 7 words", "reason": "one plain-English sentence for parents" } ] }`,
          },
        ],
      });

      const raw = completion.choices[0]?.message?.content ?? '{"flags":[]}';
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { flags?: unknown }).flags)) {
        const aiFlags = ((parsed as { flags: unknown[] }).flags)
          .filter((f): f is RuleFlag =>
            f !== null && typeof f === 'object' &&
            ['high', 'medium'].includes((f as RuleFlag).severity) &&
            typeof (f as RuleFlag).flag === 'string' &&
            typeof (f as RuleFlag).reason === 'string'
          )
          .slice(0, 2);
        flags.push(...aiFlags);
      }
    } catch (_) { /* OpenAI is optional — silently skip */ }
  }

  const result = {
    sessionId,
    flags,
    generatedAt: new Date().toISOString(),
    fromCache: false,
  };

  // Cache for 1 hour so repeat clicks return instantly
  try { await redis.setex(cacheKey, 3600, JSON.stringify(result)); } catch (_) {}

  res.setHeader('Cache-Control', 'no-store');
  return res.json(result);
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
  const channel = `sse:live:${sessionId}`;
  const subscriber = redis.duplicate();
  let liveSubscribed = false;
  try {
    await subscriber.subscribe(channel);
    liveSubscribed = true;
  } catch {
    // Keep stream open with heartbeat + replay even if live subscription fails.
  }

  if (liveSubscribed) {
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
  }

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
  // Prevent browser/proxy caching so polling always gets fresh status
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.removeHeader('ETag');

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

  // If rejected/uncertain, return early with message
  if (status === 'Rejected' || status === 'Uncertain') {
    const cls = response.classification as { rejectionReasons?: string[] } | undefined;
    response.message = status === 'Uncertain'
      ? 'This site may be a school, but homepage signals are not strong enough yet. Please review details below or retry after content updates.'
      : (cls?.rejectionReasons?.length
          ? 'We could not confidently verify this as an educational website. See the detailed reasons below.'
          : 'This website does not appear to be an educational institution. SchoolLens currently supports school and educational website analysis only.');
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

  try {
    const docResult = await pgPool.query(
      `SELECT document_code, document_name, status, source_url, expiry_date, extracted_details, review_message, confidence
       FROM school_mandatory_documents
       WHERE session_id = $1
       ORDER BY document_name ASC`,
      [sessionId],
    );
    if (docResult.rowCount) {
      response.mandatoryDocuments = docResult.rows.map((d) => ({
        code: d.document_code,
        name: d.document_name,
        status: d.status,
        sourceUrl: d.source_url,
        expiryDate: d.expiry_date,
        details: d.extracted_details || {},
        reviewMessage: d.review_message,
        confidence: d.confidence,
      }));
      const needsReviewCount = docResult.rows.filter((d) => String(d.status) === 'needs_review').length;
      if (needsReviewCount > 0) {
        response.documentReviewMessage = `${needsReviewCount} mandatory document(s) need manual review.`;
      }
    }
  } catch {
    // Migration not applied yet or table unavailable.
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

  const matched = (matchedKeywords || []).map((k) => String(k).toLowerCase());
  const hasSchoolLikeSignal = matched.some((k) =>
    ['school', 'academy', 'institute', 'college', 'university', 'vidyalaya', 'convent'].some((t) => k.includes(t)),
  );
  const isUncertain = !isEducational && (confidence >= 15 || hasSchoolLikeSignal);

  if (isEducational) {
    // Update status to Crawling and enqueue full crawl
    await pgPool.query("UPDATE analysis_sessions SET status = 'Crawling' WHERE id = $1", [sessionId]);
    await crawlQueue.add('crawl-job', {
      sessionId,
      url,
      maxPages: maxPages || Number(process.env.CRAWLER_MAX_PAGES || 30),
    });
  } else if (isUncertain) {
    // Borderline case: don't hard reject when homepage has partial school signals.
    await pgPool.query("UPDATE analysis_sessions SET status = 'Uncertain', completed_at = NOW() WHERE id = $1", [sessionId]);
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
    facts, mandatoryDocuments, preliminaryScore, playwrightBudgetUsed,
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
    mandatoryDocuments?: CrawlMandatoryDocument[];
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

  const persistentStatus = derivePersistentCrawlStatus(scanConfidence, scanConfidenceLabel, facts?.length || 0, pagesScanned);
  try {
    const schoolId = await upsertSchoolFromSession({
      sessionId,
      crawlStatus: persistentStatus,
    });
    if (schoolId && Array.isArray(mandatoryDocuments) && mandatoryDocuments.length > 0) {
      await upsertSchoolMandatoryDocuments({
        schoolId,
        sessionId,
        documents: mandatoryDocuments,
      });
    }
  } catch (error) {
    // Keep crawl pipeline running even if persistent school upsert fails.
    console.error('[schools-upsert:crawl-result] failed', { sessionId, error });
  }

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

  try {
    await upsertSchoolFromSession({
      sessionId,
      crawlStatus: 'analysed',
      summaryText: summary,
    });
  } catch (error) {
    // Do not fail score completion if schools registry update fails.
    console.error('[schools-upsert:score-complete] failed', { sessionId, error });
  }

  // Cache
  await redis.set(`analysis:v1:${urlHash}`, sessionId, 'EX', 86400);
  res.json({ ok: true });
});

/* ================================================================== */
/*  POST /internal/crawl-failed -- optional callback for failed crawl  */
/* ================================================================== */

app.post('/internal/crawl-failed', async (req, res) => {
  if (!requireInternalKey(req, res)) return;
  const { sessionId, reason } = req.body as { sessionId: string; reason?: string };
  if (!sessionId) return res.status(400).json({ error: 'Missing sessionId' });

  await pgPool.query(
    `UPDATE analysis_sessions
     SET status = 'Failed', completed_at = NOW()
     WHERE id = $1`,
    [sessionId],
  );

  try {
    await upsertSchoolFromSession({
      sessionId,
      crawlStatus: 'failed',
      crawlFailReason: cleanText(reason, 500) || 'Crawler failed',
    });
  } catch (error) {
    console.error('[schools-upsert:crawl-failed] failed', { sessionId, error });
  }

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
  const { relevant, sources } = findRelevantContent(fullContent, question, 28_000);

  const noContentFallback = 'This information was not found on the school website. You may want to contact the school directly.';

  let answer: string;
  try {
    const aiResult = await aiAnswer(question, relevant);
    if (aiResult && aiResult.trim().length > 0) {
      answer = aiResult;
    } else {
      // AI returned nothing — use extracted content if we found any
      answer = buildFallbackFromContent(question, sources);
    }
  } catch {
    // AI threw — use extracted content if we found any
    answer = buildFallbackFromContent(question, sources);
  }

  // Safety net: if answer still looks like a hard "not found" but we have sources, replace it
  const looksLikeNotFound = /not found|no information|not mentioned|not available|not clearly/i.test(answer);
  if (looksLikeNotFound && sources.length > 0) {
    const aiSaidNotFound = answer;
    const extracted = buildFallbackFromContent(question, sources);
    answer = extracted + `\n\n(AI note: ${aiSaidNotFound})`;
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
