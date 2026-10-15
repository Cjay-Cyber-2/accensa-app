import { beforeEach, describe, expect, test } from 'vitest';
import { rateLimit } from './rate-limit';

describe('rateLimit', () => {
  beforeEach(() => {
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
  });

  test('allows requests when Upstash is not configured', async () => {
    await expect(rateLimit('203.0.113.10')).resolves.toMatchObject({ success: true });
  });
});
