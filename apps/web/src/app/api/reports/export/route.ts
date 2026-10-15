import { NextResponse } from 'next/server';
import { Client } from 'pg';
import { connectionString, ensureSchema } from '@/lib/db';
import { getMerchantFromRequest } from '@/lib/merchants';
import { createCsvStream } from '@/lib/export/csvFormatter';
import { paymentsCsvFilename, CsvPayment } from '@/lib/payments-csv';

export const dynamic = 'force-dynamic';

const EXPORT_BATCH_SIZE = 500;
const DEFAULT_EXPORT_ROW_CAP = 10_000;

function getExportRowCap(): number {
  const configured = Number.parseInt(process.env.CSV_EXPORT_MAX_ROWS ?? '', 10);
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_EXPORT_ROW_CAP;
}

export async function GET(request: Request) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);

  // Filter parameters
  const filterRoute = searchParams.get('route');
  const filterPayer = searchParams.get('payer');
  const filterAsset = searchParams.get('asset');
  const filterDateFrom = searchParams.get('date_from');
  const filterDateTo = searchParams.get('date_to');

  let fromDate: Date | null = null;
  let toDate: Date | null = null;
  if (filterDateFrom) {
    fromDate = new Date(filterDateFrom);
    if (Number.isNaN(fromDate.getTime())) {
      return NextResponse.json({ error: 'date_from must be a valid date' }, { status: 400 });
    }
  }
  if (filterDateTo) {
    toDate = new Date(filterDateTo);
    if (Number.isNaN(toDate.getTime())) {
      return NextResponse.json({ error: 'date_to must be a valid date' }, { status: 400 });
    }
  }
  if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
    return NextResponse.json({ error: 'date_from must be on or before date_to' }, { status: 400 });
  }

  const client = new Client({ connectionString: connectionString() });
  try {
    await client.connect();
    const merchant = await getMerchantFromRequest(client, request);
    if (!merchant) {
      await client.end();
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const merchantId = merchant.id;
    await client.query('SELECT set_config($1, $2, false)', [
      'accensa.merchant_id',
      String(merchantId),
    ]);
    await ensureSchema(client);

    // Define generator to fetch batches
    async function* fetchPaymentBatches(): AsyncGenerator<CsvPayment[]> {
      let offset = 0;
      let exportedRows = 0;
      const rowCap = getExportRowCap();
      let hasMore = true;

      while (hasMore) {
        const predicates: string[] = [];
        const params: (string | number)[] = [merchantId];

        if (filterRoute) {
          predicates.push(`route = $${params.length + 1}`);
          params.push(filterRoute);
        }
        if (filterPayer) {
          predicates.push(`payer = $${params.length + 1}`);
          params.push(filterPayer);
        }
        if (filterAsset) {
          predicates.push(`asset = $${params.length + 1}`);
          params.push(filterAsset);
        }
        if (fromDate) {
          predicates.push(`ts >= $${params.length + 1}`);
          params.push(fromDate.toISOString());
        }
        if (toDate) {
          predicates.push(`ts <= $${params.length + 1}`);
          params.push(toDate.toISOString());
        }

        const filterSql = predicates.length ? ` AND ${predicates.join(' AND ')}` : '';
        const baseQuery = `SELECT tx_hash, ledger, payer, amount::text AS amount, asset, ts, route, method
                           FROM payments WHERE merchant_id = $1 AND ts IS NOT NULL${filterSql}
                           ORDER BY ts DESC, tx_hash DESC`;
        const batchSize = Math.min(EXPORT_BATCH_SIZE, rowCap - exportedRows);
        const query = `${baseQuery} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        const result = await client.query(query, [...params, batchSize, offset]);
        const batch: CsvPayment[] = result.rows.map((r) => ({
          ...r,
          ts: r.ts instanceof Date ? r.ts.toISOString() : String(r.ts),
        }));

        if (batch.length === 0) {
          hasMore = false;
        } else {
          yield batch;
          exportedRows += batch.length;
          offset += batch.length;
          if (batch.length < batchSize || exportedRows >= rowCap) {
            hasMore = false;
          }
        }
      }
    }

    const stream = createCsvStream(fetchPaymentBatches(), {
      rowCap: getExportRowCap(),
      onClose: () => client.end().catch(() => {}),
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${paymentsCsvFilename()}"`,
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      },
    });
  } catch (error: unknown) {
    await client.end().catch(() => {});
    console.error('Error exporting payments:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
