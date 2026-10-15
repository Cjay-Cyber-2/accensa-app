import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

let limiter: Ratelimit | null = null;

function getLimiter(): Ratelimit | null {
  if (limiter) return limiter;
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return null;
  }
  limiter = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(100, '60 s'),
    analytics: true,
    prefix: 'accensa:ratelimit',
  });
  return limiter;
}

export async function rateLimit(ip: string) {
  const activeLimiter = getLimiter();
  if (!activeLimiter) {
    return { success: true, limit: Infinity, remaining: Infinity, reset: Date.now() };
  }
  return activeLimiter.limit(ip);
}
