import 'dotenv/config';
// @ts-ignore - pg types are not installed in this repo
import { Pool } from 'pg';

type SchoolRow = {
  id: string;
  website_url: string;
  crawl_status: string | null;
};

type ScanResult = {
  queued: number;
  cached: number;
  failed: number;
  errors: Array<{ schoolId: string; website: string; error: string }>;
};

function toPositiveInt(input: string | undefined, fallback: number): number {
  const parsed = Number(input);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function toBoolean(input: string | undefined, fallback: boolean): boolean {
  if (input === undefined) return fallback;
  const value = input.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

function apiBaseUrl(): string {
  const raw = process.env.CRAWL_ALL_API_BASE_URL || process.env.CRAWLER_API_BASE_URL || 'http://localhost:3000';
  return raw.replace(/\/+$/, '');
}

function normalizeWebsiteUrl(value: string): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) return trimmed;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

async function loadSchools(pool: Pool, includeAnalysed: boolean, limit: number): Promise<SchoolRow[]> {
  const where = includeAnalysed
    ? `website_url IS NOT NULL AND TRIM(website_url) <> ''`
    : `website_url IS NOT NULL AND TRIM(website_url) <> '' AND COALESCE(crawl_status, '') <> 'analysed'`;

  const limitSql = limit > 0 ? `LIMIT ${limit}` : '';
  const result = await pool.query<SchoolRow>(
    `SELECT id, website_url, crawl_status
     FROM schools
     WHERE ${where}
     ORDER BY last_crawled_at NULLS FIRST, created_at ASC
     ${limitSql}`,
  );
  return result.rows;
}

async function queueScan(baseUrl: string, schoolId: string, website: string, dryRun: boolean): Promise<'queued' | 'cached'> {
  if (dryRun) return 'queued';

  const response = await fetch(`${baseUrl}/api/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: website }),
  });

  if (!response.ok) {
    const errorText = (await response.text()).slice(0, 500);
    throw new Error(`HTTP ${response.status} for ${schoolId}: ${errorText}`);
  }

  const body = await response.json() as { cached?: boolean };
  return body.cached ? 'cached' : 'queued';
}

async function processSchools(params: {
  schools: SchoolRow[];
  concurrency: number;
  baseUrl: string;
  dryRun: boolean;
}): Promise<ScanResult> {
  const { schools, concurrency, baseUrl, dryRun } = params;

  const result: ScanResult = { queued: 0, cached: 0, failed: 0, errors: [] };
  let index = 0;

  async function workerLoop(workerNo: number): Promise<void> {
    while (true) {
      const current = index;
      index += 1;
      if (current >= schools.length) return;

      const school = schools[current];
      const website = normalizeWebsiteUrl(school.website_url);

      try {
        const state = await queueScan(baseUrl, school.id, website, dryRun);
        if (state === 'cached') result.cached += 1;
        else result.queued += 1;

        if ((current + 1) % 50 === 0) {
          console.log(`[crawl-all-website] Progress ${current + 1}/${schools.length} (worker ${workerNo})`);
        }
      } catch (error) {
        result.failed += 1;
        result.errors.push({
          schoolId: school.id,
          website,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const workerCount = Math.min(concurrency, schools.length || 1);
  await Promise.all(Array.from({ length: workerCount }, (_, i) => workerLoop(i + 1)));
  return result;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const concurrency = toPositiveInt(process.env.CRAWL_ALL_CONCURRENCY, 5);
  const limit = Math.max(0, Number(process.env.CRAWL_ALL_LIMIT || 0));
  const includeAnalysed = toBoolean(process.env.CRAWL_ALL_INCLUDE_ANALYSED, false);
  const dryRun = toBoolean(process.env.CRAWL_ALL_DRY_RUN, false);
  const baseUrl = apiBaseUrl();

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    const schools = await loadSchools(pool, includeAnalysed, limit);
    console.log(`[crawl-all-website] Loaded ${schools.length} schools`);
    console.log(`[crawl-all-website] API base: ${baseUrl}`);
    console.log(`[crawl-all-website] Concurrency: ${concurrency}, includeAnalysed: ${includeAnalysed}, dryRun: ${dryRun}`);

    if (schools.length === 0) {
      console.log('[crawl-all-website] No schools found to process');
      return;
    }

    const startedAt = Date.now();
    const output = await processSchools({
      schools,
      concurrency,
      baseUrl,
      dryRun,
    });
    const durationMs = Date.now() - startedAt;

    console.log('[crawl-all-website] Completed');
    console.log(`[crawl-all-website] queued=${output.queued} cached=${output.cached} failed=${output.failed} durationMs=${durationMs}`);

    if (output.errors.length > 0) {
      console.error('[crawl-all-website] Sample errors:');
      for (const err of output.errors.slice(0, 10)) {
        console.error(`- schoolId=${err.schoolId} website=${err.website} error=${err.error}`);
      }
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

void main().catch((error) => {
  console.error('[crawl-all-website] Fatal error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
