import 'dotenv/config';
import crypto from 'node:crypto';
import axios from 'axios';
import { Worker } from 'bullmq';
import { PlaywrightCrawler } from 'crawlee';

const redisConnection = {
  host: process.env.REDIS_HOST || undefined,
  port: process.env.REDIS_PORT ? Number(process.env.REDIS_PORT) : undefined,
  password: process.env.REDIS_PASSWORD || undefined,
  url: process.env.REDIS_URL,
};

const apiBaseUrl = process.env.CRAWLER_API_BASE_URL ?? 'http://localhost:3000';
const internalApiKey = process.env.INTERNAL_API_KEY ?? 'change-me';

function hashUrl(url: string): string {
  return crypto.createHash('sha256').update(url).digest('hex');
}

async function crawlSingleUrl(url: string, maxPages: number): Promise<{ title: string; extractedText: string }> {
  let bestTitle = url;
  let combinedText = '';

  const crawler = new PlaywrightCrawler({
    maxRequestsPerCrawl: maxPages,
    maxConcurrency: 2,
    requestHandlerTimeoutSecs: 20,
    async requestHandler({ page, request, enqueueLinks }) {
      const title = await page.title();
      const bodyText = await page.locator('body').innerText().catch(() => '');

      if (title && bestTitle === url) bestTitle = title;
      combinedText += `\n\nURL: ${request.url}\n${bodyText}`;

      await enqueueLinks({ strategy: 'same-domain' });
    },
  });

  await crawler.run([url]);

  return {
    title: bestTitle,
    extractedText: combinedText.replace(/\s+/g, ' ').trim().slice(0, 50000),
  };
}

const crawlWorker = new Worker(
  process.env.CRAWLER_QUEUE_NAME || 'schoollens:crawl',
  async (job) => {
    const { sessionId, url, maxPages } = job.data as { sessionId: string; url: string; maxPages: number };
    const result = await crawlSingleUrl(url, maxPages || 30);

    await axios.post(
      `${apiBaseUrl}/internal/crawl-result`,
      {
        sessionId,
        pageUrl: url,
        title: result.title,
        extractedText: result.extractedText,
      },
      { headers: { 'X-Internal-Key': internalApiKey }, timeout: 20000 },
    );
  },
  { connection: redisConnection },
);

const scoringWorker = new Worker(
  process.env.SCORING_QUEUE_NAME || 'schoollens:score',
  async (job) => {
    const { sessionId, url, extractedText } = job.data as {
      sessionId: string;
      url?: string;
      extractedText?: string;
    };

    const text = (extractedText || '').toLowerCase();
    let score = 0;
    if (text.includes('admission')) score += 30;
    if (text.includes('fees')) score += 30;
    if (text.includes('contact')) score += 20;
    if (text.includes('curriculum')) score += 20;

    const summary =
      score >= 70
        ? 'Good parent-readiness baseline. Improve policy detail and freshness.'
        : 'Important parent-facing details are missing. Add fees, admission process, and contact clarity.';

    await axios.post(
      `${apiBaseUrl}/internal/score-complete`,
      {
        sessionId,
        score,
        summary,
        urlHash: hashUrl((url || '').toLowerCase()),
      },
      { headers: { 'X-Internal-Key': internalApiKey }, timeout: 10000 },
    );
  },
  { connection: redisConnection },
);

crawlWorker.on('completed', (job) => console.log(`Crawl completed: ${job.id}`));
crawlWorker.on('failed', (job, err) => console.error(`Crawl failed: ${job?.id}`, err));
scoringWorker.on('completed', (job) => console.log(`Score completed: ${job.id}`));
scoringWorker.on('failed', (job, err) => console.error(`Score failed: ${job?.id}`, err));

console.log('Workers started (crawl + score)');
