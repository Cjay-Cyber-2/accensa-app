import { CsvPayment, CSV_BOM, toCsvRow } from '../payments-csv';
import { assetLabel } from '../money';

const HEADERS = [
  'Transaction Hash',
  'Timestamp',
  'Amount',
  'Asset',
  'Asset Identifier',
  'Payer',
  'Route',
  'Method',
  'Ledger',
  'Refunded',
];

function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function formatCsvRow(payment: CsvPayment): string {
  return toCsvRow([
    neutralizeFormula(payment.tx_hash),
    payment.ts,
    payment.amount,
    assetLabel(payment.asset),
    neutralizeFormula(payment.asset ?? 'native'),
    neutralizeFormula(payment.payer),
    neutralizeFormula(payment.route ?? ''),
    neutralizeFormula(payment.method ?? ''),
    payment.ledger === null ? '' : String(payment.ledger),
    payment.refunded ? 'Yes' : '',
  ]);
}

/**
 * Creates a stream that yields CSV bytes without memory exhaustion.
 */
export function createCsvStream(
  paymentGenerator: AsyncGenerator<CsvPayment[]>,
  options: { rowCap?: number; onClose?: () => void | Promise<void> } = {},
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let rowsWritten = 0;
  let capMarkerWritten = false;
  let closed = false;
  const finish = () => {
    if (closed) return;
    closed = true;
    void options.onClose?.();
  };
  return new ReadableStream({
    async start(controller) {
      // Send BOM and headers first
      controller.enqueue(encoder.encode(CSV_BOM));
      controller.enqueue(encoder.encode(toCsvRow(HEADERS) + '\r\n'));
    },
    async pull(controller) {
      try {
        const { value, done } = await paymentGenerator.next();
        if (done) {
          controller.close();
          finish();
        } else {
          // Process chunks
          for (const payment of value) {
            controller.enqueue(encoder.encode(formatCsvRow(payment) + '\r\n'));
            rowsWritten += 1;
          }
          if (options.rowCap !== undefined && rowsWritten >= options.rowCap) {
            controller.enqueue(
              encoder.encode(
                toCsvRow(['# EXPORT ROW CAP REACHED', String(options.rowCap)]) + '\r\n',
              ),
            );
            capMarkerWritten = true;
            await paymentGenerator.return?.(null);
            controller.close();
            finish();
          }
        }
      } catch (error) {
        console.error('Error streaming CSV export:', error);
        controller.enqueue(
          encoder.encode(
            toCsvRow(['# EXPORT ERROR', 'The export could not be completed']) + '\r\n',
          ),
        );
        controller.close();
        finish();
      }
    },
    cancel() {
      if (capMarkerWritten) return;
      paymentGenerator.return?.(null);
      finish();
    },
  });
}
