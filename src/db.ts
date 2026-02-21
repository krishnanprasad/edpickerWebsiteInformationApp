import { Pool } from 'pg';
import Redis from 'ioredis';

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;

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
