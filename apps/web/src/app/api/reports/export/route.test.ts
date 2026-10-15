import { beforeEach, describe, expect, test, vi } from 'vitest';
import { GET } from './route';

const { clients, mockGetMerchantFromRequest } = vi.hoisted(() => ({
  clients: [] as Array<{
    query: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
  }>,
  mockGetMerchantFromRequest: vi.fn(),
}));

vi.mock('pg', () => ({
  Client: class MockClient {
    query = vi.fn();
    connect = vi.fn().mockResolvedValue(undefined);
    end = vi.fn().mockResolvedValue(undefined);

    constructor() {
      clients.push(this);
    }
  },
}));

vi.mock('@/lib/db', () => ({
  connectionString: vi.fn(() => 'postgres://dummy'),
  ensureSchema: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/merchants', () => ({
  getMerchantFromRequest: mockGetMerchantFromRequest,
}));

describe('/api/reports/export GET', () => {
  beforeEach(() => {
    clients.length = 0;
    mockGetMerchantFromRequest.mockResolvedValue({ id: 1, address: 'GABC' });
    process.env.DATABASE_URL = 'postgres://dummy';
    delete process.env.CSV_EXPORT_MAX_ROWS;
  });

  test('reuses one client across export pages', async () => {
    const rows = Array.from({ length: 500 }, (_, index) => ({
      tx_hash: index.toString().padStart(64, '0'),
      ledger: index,
      payer: 'GABC',
      amount: '1',
      asset: null,
      ts: new Date().toISOString(),
      route: null,
      method: 'GET',
    }));

    mockGetMerchantFromRequest.mockImplementation(async () => {
      const activeClient = clients[0];
      activeClient.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows })
        .mockResolvedValueOnce({ rows: [] });
      return { id: 1, address: 'GABC' };
    });

    const response = await GET(new Request('http://localhost/api/reports/export'));
    await response.text();

    expect(clients).toHaveLength(1);
    expect(clients[0].query).toHaveBeenCalledTimes(3);
    expect(clients[0].end).toHaveBeenCalledTimes(1);
  });

  test('rejects an inverted date range before opening a client', async () => {
    const response = await GET(
      new Request('http://localhost/api/reports/export?date_from=2026-02-01&date_to=2026-01-01'),
    );

    expect(response.status).toBe(400);
    expect(clients).toHaveLength(0);
  });
});
