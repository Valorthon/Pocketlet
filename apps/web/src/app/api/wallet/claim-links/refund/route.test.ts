import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  Account,
  Contract,
  TransactionBuilder,
  nativeToScVal,
} from '@stellar/stellar-sdk';
import { POST } from './route';
import { createUser, setEmailVerified, setWallet } from '@/lib/auth/store';
import { createSessionToken } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/config';
import { NETWORK_PASSPHRASE } from '@/lib/wallet/network';
import { addressScVal } from '@/lib/wallet/amount';
import { getMetric } from '@/lib/metrics';
import { db, schema } from '@/lib/db';

let cookieJar: Record<string, string> = {};

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockImplementation(() => ({
    get: (name: string) => (cookieJar[name] ? { value: cookieJar[name], name } : undefined),
    set: (name: string, value: string) => {
      cookieJar[name] = value;
    },
  })),
}));

vi.mock('@/lib/wallet/submit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/wallet/submit')>();
  return {
    ...actual,
    submitSignedTransaction: vi.fn().mockResolvedValue({ hash: 'refund-tx-hash' }),
  };
});

const ESCROW_CONTRACT =
  'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
const OTHER_CONTRACT =
  'CCTTR6BVBPGWW76HFCRSPQAXZCOC4HKUF5BKK3ZDO7V7B6PIPDKP2BFQ';
const SENDER_CONTRACT =
  'CA7FMXWUMM3C37O4QF4E4R4KKXZIEBV7CTFHKDRDXPBLZQ2NMC5PZC5G';
const FEE_PAYER_PUBLIC =
  'GATVJDFPIPADU74ALX4344HEQQZ2LGMNWABPXBOWYMVXM37KMTTUALTU';
const SENDER_EMAIL = 'alice@example.com';
const OTHER_EMAIL = 'mallory@example.com';
const CLAIM_HASH = '11223344'.repeat(8);
const OTHER_HASH = '99887766'.repeat(8);
const UNKNOWN_UUID = '00000000-0000-4000-8000-000000000000';

beforeEach(() => {
  cookieJar = {};
  process.env.NEXT_PUBLIC_ESCROW_CONTRACT_ID = ESCROW_CONTRACT;
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_ESCROW_CONTRACT_ID;
});

function bytesScVal(hex: string) {
  return nativeToScVal(Buffer.from(hex, 'hex'), { type: 'bytes' });
}

function buildXdr(
  operations: { contractId: string; functionName: string; args: ReturnType<typeof bytesScVal>[] }[]
): string {
  const source = new Account(FEE_PAYER_PUBLIC, '0');
  const builder = new TransactionBuilder(source, {
    fee: '100000',
    networkPassphrase: NETWORK_PASSPHRASE,
  });
  for (const op of operations) {
    builder.addOperation(
      new Contract(op.contractId).call(op.functionName, ...op.args)
    );
  }
  return builder.setTimeout(30).build().toXDR();
}

function buildRefundXdr(claimHash = CLAIM_HASH, contractId = ESCROW_CONTRACT): string {
  return buildXdr([
    { contractId, functionName: 'refund', args: [bytesScVal(claimHash)] },
  ]);
}

function createRefundRequest(body: unknown, token?: string) {
  if (token) {
    cookieJar[SESSION_COOKIE_NAME] = token;
  }
  return new NextRequest('http://localhost/api/wallet/claim-links/refund', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function seedSender(email = SENDER_EMAIL) {
  await createUser(email, '000000');
  await setEmailVerified(email);
  await setWallet(email, {
    walletContractId: SENDER_CONTRACT,
    stellarAddress: SENDER_CONTRACT,
    primaryPasskeyKeyId: 'cred-id',
  });
  return createSessionToken({ email });
}

async function seedClaimLink(overrides?: {
  senderEmail?: string;
  status?: string;
  expiry?: Date;
  claimHash?: string;
}) {
  const [row] = await db
    .insert(schema.claimLinks)
    .values({
      senderEmail: overrides?.senderEmail ?? SENDER_EMAIL,
      recipientEmail: 'bob@example.com',
      tokenContractId: OTHER_CONTRACT,
      amount: '5000000',
      claimHash: overrides?.claimHash ?? CLAIM_HASH,
      secretCiphertext: 'iv:tag:ciphertext',
      // Expired by default: refund is only allowed after expiry.
      expiry: overrides?.expiry ?? new Date(Date.now() - 1000),
      status: overrides?.status ?? 'pending',
    })
    .returning();
  return row;
}

describe('POST /api/wallet/claim-links/refund', () => {
  it('returns 401 without a session cookie', async () => {
    const res = await POST(
      createRefundRequest({ claimLinkId: UNKNOWN_UUID, signedXdr: buildRefundXdr() })
    );
    expect(res.status).toBe(401);
  });

  it('returns 401 for a session cookie that is not a valid token', async () => {
    const res = await POST(
      createRefundRequest(
        { claimLinkId: UNKNOWN_UUID, signedXdr: buildRefundXdr() },
        'not-a-jwt'
      )
    );
    expect(res.status).toBe(401);
  });

  it('returns 404 when the wallet is not deployed', async () => {
    await createUser(SENDER_EMAIL, '000000');
    await setEmailVerified(SENDER_EMAIL);
    const token = await createSessionToken({ email: SENDER_EMAIL });

    const res = await POST(
      createRefundRequest(
        { claimLinkId: UNKNOWN_UUID, signedXdr: buildRefundXdr() },
        token
      )
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Wallet not deployed');
  });

  it('returns 400 for a body that is not JSON', async () => {
    cookieJar[SESSION_COOKIE_NAME] = await seedSender();
    const req = new NextRequest('http://localhost/api/wallet/claim-links/refund', {
      method: 'POST',
      body: 'not json',
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Invalid JSON body');
  });

  it('returns 400 when signedXdr is missing', async () => {
    const token = await seedSender();
    const res = await POST(createRefundRequest({ claimLinkId: UNKNOWN_UUID }, token));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('claimLinkId and signedXdr are required');
  });

  it('returns 400 when claimLinkId is missing', async () => {
    const token = await seedSender();
    const res = await POST(
      createRefundRequest({ signedXdr: buildRefundXdr() }, token)
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('claimLinkId and signedXdr are required');
  });

  it('returns 404 when no claim link has that id', async () => {
    const token = await seedSender();
    const res = await POST(
      createRefundRequest(
        { claimLinkId: UNKNOWN_UUID, signedXdr: buildRefundXdr() },
        token
      )
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Claim link not found');
  });

  it('returns 404 for a link created by a different sender', async () => {
    await seedSender(OTHER_EMAIL);
    const token = await seedSender();
    const link = await seedClaimLink({ senderEmail: OTHER_EMAIL });

    const res = await POST(
      createRefundRequest({ claimLinkId: link.id, signedXdr: buildRefundXdr() }, token)
    );
    expect(res.status).toBe(404);
  });

  it('returns 404 for a link that is no longer pending', async () => {
    const token = await seedSender();
    const link = await seedClaimLink({ status: 'refunded' });

    const res = await POST(
      createRefundRequest({ claimLinkId: link.id, signedXdr: buildRefundXdr() }, token)
    );
    expect(res.status).toBe(404);
  });

  it('returns 400 when the link has not expired yet', async () => {
    const token = await seedSender();
    const link = await seedClaimLink({ expiry: new Date(Date.now() + 86_400_000) });

    const res = await POST(
      createRefundRequest({ claimLinkId: link.id, signedXdr: buildRefundXdr() }, token)
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Claim link has not expired yet');

    const [after] = await db.select().from(schema.claimLinks);
    expect(after.status).toBe('pending');
  });

  it('refunds an expired link and marks it refunded', async () => {
    const token = await seedSender();
    const link = await seedClaimLink();

    const res = await POST(
      createRefundRequest({ claimLinkId: link.id, signedXdr: buildRefundXdr() }, token)
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hash: string };
    expect(body.hash).toBe('refund-tx-hash');

    const [after] = await db.select().from(schema.claimLinks);
    expect(after.status).toBe('refunded');
    expect(await getMetric('wallet.refund.success')).toBe(1);
    expect(await getMetric('wallet.refund.failure')).toBe(0);
  });
});

describe('POST /api/wallet/claim-links/refund — validateSignedRefund', () => {
  it('returns 500 when the claim hash does not match the link', async () => {
    const token = await seedSender();
    const link = await seedClaimLink();

    const res = await POST(
      createRefundRequest(
        { claimLinkId: link.id, signedXdr: buildRefundXdr(OTHER_HASH) },
        token
      )
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Claim hash does not match');

    const [after] = await db.select().from(schema.claimLinks);
    expect(after.status).toBe('pending');
    expect(await getMetric('wallet.refund.failure')).toBe(1);
    expect(await getMetric('wallet.refund.success')).toBe(0);
  });

  it('returns 500 when the transaction invokes another contract', async () => {
    const token = await seedSender();
    const link = await seedClaimLink();

    const res = await POST(
      createRefundRequest(
        { claimLinkId: link.id, signedXdr: buildRefundXdr(CLAIM_HASH, OTHER_CONTRACT) },
        token
      )
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Transaction invokes the wrong contract');
  });

  it('returns 500 when the transaction calls a function other than refund', async () => {
    const token = await seedSender();
    const link = await seedClaimLink();
    const signedXdr = buildXdr([
      {
        contractId: ESCROW_CONTRACT,
        functionName: 'claim',
        args: [bytesScVal(CLAIM_HASH)],
      },
    ]);

    const res = await POST(
      createRefundRequest({ claimLinkId: link.id, signedXdr }, token)
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Transaction must call refund');
  });

  it('returns 500 when refund is called with the wrong number of arguments', async () => {
    const token = await seedSender();
    const link = await seedClaimLink();
    const signedXdr = buildXdr([
      {
        contractId: ESCROW_CONTRACT,
        functionName: 'refund',
        args: [bytesScVal(CLAIM_HASH), addressScVal(SENDER_CONTRACT)],
      },
    ]);

    const res = await POST(
      createRefundRequest({ claimLinkId: link.id, signedXdr }, token)
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('refund argument count is malformed');
  });

  it('returns 500 when the transaction carries more than one operation', async () => {
    const token = await seedSender();
    const link = await seedClaimLink();
    const signedXdr = buildXdr([
      {
        contractId: ESCROW_CONTRACT,
        functionName: 'refund',
        args: [bytesScVal(CLAIM_HASH)],
      },
      {
        contractId: ESCROW_CONTRACT,
        functionName: 'refund',
        args: [bytesScVal(CLAIM_HASH)],
      },
    ]);

    const res = await POST(
      createRefundRequest({ claimLinkId: link.id, signedXdr }, token)
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Refund transaction must contain exactly one operation');
  });

  it('returns 500 when NEXT_PUBLIC_ESCROW_CONTRACT_ID is not configured', async () => {
    const token = await seedSender();
    const link = await seedClaimLink();
    const signedXdr = buildRefundXdr();
    delete process.env.NEXT_PUBLIC_ESCROW_CONTRACT_ID;

    const res = await POST(
      createRefundRequest({ claimLinkId: link.id, signedXdr }, token)
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('NEXT_PUBLIC_ESCROW_CONTRACT_ID is not configured');
  });
});
