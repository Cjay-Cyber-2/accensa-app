import { NextResponse } from 'next/server';
import { MAX_PROOF_LEN, verifyReceipt } from '@accensa/sdk/merkle';
import { verifyReceiptOnChain, getBatch, isHash32, RECEIPT_ANCHOR_ID } from '@/lib/receipt-anchor';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
const MAX_VERIFY_PROOF_LENGTH = MAX_PROOF_LEN;

export interface VerifyRequest {
  batchId: number;
  leaf: string;
  proof: string[];
}

export interface CheckResult {
  ok: boolean | null;
  error?: string;
}

export interface VerifyResponse {
  /** Recomputed in this process from the proof - no ledger involved. */
  local: CheckResult;
  /** The contract's own answer, read from the ledger. */
  onchain: CheckResult;
  /** True only when both independent implementations agree the receipt is valid. */
  verified: boolean;
  /** Set when the two disagree - which should never happen. */
  disagreement: boolean;
  batch?: { id: number; root: string; count: number; periodStart: number; periodEnd: number };
  contract: string;
}

export async function POST(request: Request) {
  let body: VerifyRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be JSON' }, { status: 400 });
  }

  const { batchId, leaf, proof } = body ?? {};

  if (!Number.isInteger(batchId) || batchId < 1) {
    return NextResponse.json({ error: 'batchId must be a positive integer' }, { status: 400 });
  }
  if (typeof leaf !== 'string' || !isHash32(leaf)) {
    return NextResponse.json({ error: 'leaf must be a hex-encoded 32-byte hash' }, { status: 400 });
  }
  if (!Array.isArray(proof) || proof.some((p) => typeof p !== 'string' || !isHash32(p))) {
    return NextResponse.json(
      { error: 'proof must be an array of hex-encoded 32-byte hashes' },
      { status: 400 },
    );
  }
  if (proof.length > MAX_VERIFY_PROOF_LENGTH) {
    return NextResponse.json(
      { error: `proof must contain at most ${MAX_VERIFY_PROOF_LENGTH} hashes` },
      { status: 400 },
    );
  }

  const forwardedFor =
    request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for') ?? 'unknown';
  const ip = forwardedFor.split(',')[0].trim();
  const limit = await rateLimit(ip);
  if (!limit.success) {
    return NextResponse.json(
      { error: 'Too many verification attempts' },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.max(1, Math.ceil((limit.reset - Date.now()) / 1000))),
        },
      },
    );
  }

  // Read the anchored batch first: without its root there is nothing to check
  // the local recomputation against.
  let batch;
  try {
    batch = await getBatch(batchId);
  } catch (error) {
    console.error(`Error reading batch #${batchId}:`, error);
    return NextResponse.json(
      {
        error: `Could not read batch #${batchId}.`,
      },
      { status: 404 },
    );
  }

  // The two checks are deliberately independent. Local recomputes the root from
  // the proof in this process; on-chain asks the contract. Running both and
  // showing both is the point - agreement between an independent computation
  // and the ledger is what makes a receipt trustworthy without trusting us.
  const local: CheckResult = (() => {
    try {
      return {
        ok: verifyReceipt(
          leaf.trim(),
          proof.map((p) => p.trim()),
          batch.root,
        ),
      };
    } catch (error) {
      return { ok: null, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  })();

  const onchain: CheckResult = await (async () => {
    try {
      return {
        ok: await verifyReceiptOnChain(
          batchId,
          leaf.trim(),
          proof.map((p) => p.trim()),
        ),
      };
    } catch (error) {
      console.error('On-chain receipt verification failed:', error);
      return { ok: null, error: 'On-chain verification failed' };
    }
  })();

  const disagreement = local.ok !== null && onchain.ok !== null && local.ok !== onchain.ok;

  const response: VerifyResponse = {
    local,
    onchain,
    verified: local.ok === true && onchain.ok === true,
    disagreement,
    batch: {
      id: batchId,
      root: batch.root,
      count: batch.count,
      periodStart: batch.periodStart,
      periodEnd: batch.periodEnd,
    },
    contract: RECEIPT_ANCHOR_ID,
  };

  return NextResponse.json(response);
}
