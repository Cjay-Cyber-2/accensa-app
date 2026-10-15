import { beforeEach, describe, expect, test, vi } from 'vitest';
import { POST } from './route';

const { mockRateLimit, mockGetBatch, mockVerifyReceiptOnChain } = vi.hoisted(() => ({
  mockRateLimit: vi.fn(),
  mockGetBatch: vi.fn(),
  mockVerifyReceiptOnChain: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({ rateLimit: mockRateLimit }));
vi.mock('@/lib/receipt-anchor', () => ({
  RECEIPT_ANCHOR_ID: 'contract',
  getBatch: mockGetBatch,
  isHash32: (value: string) => /^[0-9a-f]{64}$/i.test(value),
  verifyReceiptOnChain: mockVerifyReceiptOnChain,
}));
vi.mock('@accensa/sdk/merkle', () => ({
  MAX_PROOF_LEN: 32,
  verifyReceipt: vi.fn().mockReturnValue(true),
}));

describe('/api/verify POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRateLimit.mockResolvedValue({
      success: true,
      limit: 100,
      remaining: 99,
      reset: Date.now() + 60_000,
    });
    mockGetBatch.mockResolvedValue({
      root: 'a'.repeat(64),
      count: 1,
      periodStart: 1,
      periodEnd: 2,
    });
    mockVerifyReceiptOnChain.mockResolvedValue(true);
  });

  test('returns 429 with Retry-After before reading the chain', async () => {
    mockRateLimit.mockResolvedValue({ success: false, reset: Date.now() + 12_000 });

    const response = await POST(
      new Request('http://localhost/api/verify', {
        method: 'POST',
        headers: { 'x-real-ip': '203.0.113.10' },
        body: JSON.stringify({
          batchId: 1,
          leaf: 'a'.repeat(64),
          proof: [],
        }),
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('12');
    expect(mockGetBatch).not.toHaveBeenCalled();
    expect(mockVerifyReceiptOnChain).not.toHaveBeenCalled();
    expect(mockRateLimit).toHaveBeenCalledWith('203.0.113.10');
  });

  test('continues without Redis when the limiter allows the request', async () => {
    const response = await POST(
      new Request('http://localhost/api/verify', {
        method: 'POST',
        body: JSON.stringify({
          batchId: 1,
          leaf: 'a'.repeat(64),
          proof: [],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mockGetBatch).toHaveBeenCalledWith(1);
    expect(mockVerifyReceiptOnChain).toHaveBeenCalled();
  });

  test('rejects an oversized proof before any chain read', async () => {
    const response = await POST(
      new Request('http://localhost/api/verify', {
        method: 'POST',
        body: JSON.stringify({
          batchId: 1,
          leaf: 'a'.repeat(64),
          proof: Array.from({ length: 33 }, () => 'b'.repeat(64)),
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockGetBatch).not.toHaveBeenCalled();
  });
});
