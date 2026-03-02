/**
 * SSE event emitter — publishes crawler events to Redis
 * for real-time streaming via the API server's SSE endpoint.
 *
 * Uses Redis Pub/Sub for real-time delivery + Redis Stream for replay.
 */
import IORedis from 'ioredis';
const Redis = IORedis.default ?? IORedis;

let _pubClient: InstanceType<typeof Redis> | null = null;
let _eventCounter = 0;

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

function getPubClient(): InstanceType<typeof Redis> {
  if (!_pubClient) {
    const url = resolveRedisUrl();
    _pubClient = new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: true }) as InstanceType<typeof Redis>;
    _pubClient.connect().catch((err: unknown) => {
      console.error('SSE Redis connect failed:', err instanceof Error ? err.message : err);
    });
  }
  return _pubClient;
}

/**
 * Emit an SSE event for a session.
 * - Publishes to `sse:live:{sessionId}` (Pub/Sub for real-time)
 * - Appends to `sse:stream:{sessionId}` (Redis Stream for replay)
 */
export async function emitEvent(
  sessionId: string,
  type: string,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    const redis = getPubClient();
    const eventId = `${Date.now()}-${++_eventCounter}`;
    const payload = JSON.stringify({ id: eventId, type, data, ts: Date.now() });

    // Pub/Sub for real-time listeners
    await redis.publish(`sse:live:${sessionId}`, payload);

    // Stream for replay (keep ~200 events per session, auto-trim)
    await redis.xadd(
      `sse:stream:${sessionId}`,
      'MAXLEN', '~', '200',
      '*',
      'payload', payload,
    );
  } catch (err) {
    // SSE is best-effort — never block crawling
    console.warn('SSE emit failed:', err instanceof Error ? err.message : err);
  }
}

/**
 * Emit a terminal event indicating the crawl session reached a final state.
 * Sets a TTL on the stream so it auto-cleans after 1 hour.
 */
export async function emitTerminalEvent(
  sessionId: string,
  type: 'complete' | 'error',
  data: Record<string, unknown> = {},
): Promise<void> {
  await emitEvent(sessionId, type, data);
  try {
    const redis = getPubClient();
    // Auto-expire the stream after 1 hour
    await redis.expire(`sse:stream:${sessionId}`, 3600);
  } catch { /* ignore */ }
}

/** Gracefully close the SSE Redis client (call on shutdown). */
export async function closeSseClient(): Promise<void> {
  if (_pubClient) {
    await _pubClient.quit().catch(() => {});
    _pubClient = null;
  }
}
