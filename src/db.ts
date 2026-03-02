import { Pool } from 'pg';
import Redis from 'ioredis';

const databaseUrl = process.env.DATABASE_URL;

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

const redisUrl = resolveRedisUrl();

if (!databaseUrl) {
  throw new Error('DATABASE_URL is required');
}

if (!redisUrl) {
  throw new Error('REDIS_URL is required');
}

export const pgPool = new Pool({
  connectionString: databaseUrl,
});

export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 3,
});
