import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import {
  Account,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk';
import { POST } from './route';
import { exhaustFeePayerBudget } from '@/lib/rate-limit.test-support';
import {
  createUser,
  setEmailVerified,
  setProfile,
  setWallet,
} from '@/lib/auth/store';
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
    submitSignedTransaction: vi.fn().mockResolvedValue({ hash: 'claim-tx-hash' }),
  };
});

const ESCROW_CONTRACT =
  'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
const OTHER_CONTRACT =
  'CCTTR6BVBPGWW76HFCRSPQAXZCOC4HKUF5BKK3ZDO7V7B6PIPDKP2BFQ';
const RECIPIENT_CONTRACT =
  'CA7FMXWUMM3C37O4QF4E4R4KKXZIEBV7CTFHKDRDXPBLZQ2NMC5PZC5G';
const FEE_PAYER_PUBLIC =
  'GATVJDFPIPADU74ALX4344HEQQZ2LGMNWABPXBOWYMVXM37KMTTUALTU';
const SENDER_EMAIL = 'alice@example.com';
const RECIPIENT_EMAIL = 'bob@example.com';
const RECIPIENT_PHONE = '+639123456789';
const CLAIM_HASH = '11223344'.repeat(8);
const OTHER_HASH = '99887766'.repeat(8);
/**
 * A genuine secret/hash pair, built the way `claim-link-client.ts` builds one:
 * `claimHash = sha256(<32 raw secret bytes>)`. Used by the bug-documenting test
 * below, which needs a link whose `claimHash` really is the hash of the secret
 * the client would put into the transaction.
 */
const REAL_SECRET = 'a1b2c3d4'.repeat(8);
const REAL_CLAIM_HASH = createHash('sha256')
  .update(Buffer.from(REAL_SECRET, 'hex'))
  .digest('hex');
const UNKNOWN_UUID = '00000000-0000-4000-8000-000000000000';

beforeEach(() => {
  cookieJar = {};
  process.env.NEXT_PUBLIC_ESCROW_CONTRACT_ID = ESCROW_CONTRACT;
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_ESCROW_CONTRACT_ID;
  vi.unstubAllEnvs();
});

function bytesScVal(hex: string): xdr.ScVal {
  return nativeToScVal(Buffer.from(hex, 'hex'), { type: 'bytes' });
}

function buildXdr(
  operations: { contractId: string; functionName: string; args: xdr.ScVal[] }[]
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

function buildClaimXdr(
  claimHash = CLAIM_HASH,
  recipientWallet = RECIPIENT_CONTRACT,
  contractId = ESCROW_CONTRACT
): string {
  return buildXdr([
    {
      contractId,
      functionName: 'claim',
      args: [bytesScVal(claimHash), addressScVal(recipientWallet)],
    },
  ]);
}

function createClaimSubmitRequest(body: unknown, token?: string) {
  if (token) {
    cookieJar[SESSION_COOKIE_NAME] = token;
  }
  return new NextRequest(
    'http://localhost/api/wallet/claim-links/claim-submit',
    { method: 'POST', body: JSON.stringify(body) }
  );
}

async function seedSender() {
  await createUser(SENDER_EMAIL, '000000');
  await setEmailVerified(SENDER_EMAIL);
}

async function seedRecipient(profile?: { phone?: string }) {
  await createUser(RECIPIENT_EMAIL, '000000');
  await setEmailVerified(RECIPIENT_EMAIL);
  await setWallet(RECIPIENT_EMAIL, {
    walletContractId: RECIPIENT_CONTRACT,
    stellarAddress: RECIPIENT_CONTRACT,
    primaryPasskeyKeyId: 'cred-id',
  });
  if (profile) {
    await setProfile(RECIPIENT_EMAIL, profile);
  }
  return createSessionToken({ email: RECIPIENT_EMAIL });
}

async function seedClaimLink(overrides?: {
  recipientEmail?: string | null;
  recipientPhone?: string | null;
  status?: string;
  expiry?: Date;
  claimHash?: string;
}) {
  const [row] = await db
    .insert(schema.claimLinks)
    .values({
      senderEmail: SENDER_EMAIL,
      recipientEmail:
        overrides?.recipientEmail === undefined
          ? RECIPIENT_EMAIL
          : overrides.recipientEmail,
      recipientPhone: overrides?.recipientPhone ?? null,
      tokenContractId: OTHER_CONTRACT,
      amount: '5000000',
      claimHash: overrides?.claimHash ?? CLAIM_HASH,
      secretCiphertext: 'iv:tag:ciphertext',
      expiry: overrides?.expiry ?? new Date(Date.now() + 86_400_000),
      status: overrides?.status ?? 'pending',
    })
    .returning();
  return row;
}

/**
 * READ THIS BEFORE TREATING THESE TESTS AS A SPECIFICATION.
 *
 * `buildClaimXdr` puts the claim **hash** into `args[0]`, because that is what
 * the route's `validateSignedClaim` compares against `link.claimHash`
 * (`route.ts` — `scValToBytes(args[0]).toString('hex') !== expectedClaimHash`).
 * No real client ever sends that shape:
 *
 *   - the contract is `claim(secret: BytesN<32>, recipient_wallet: Address)`
 *     (`contracts/escrow/src/lib.rs`) and hashes `args[0]` itself to look the
 *     deposit up;
 *   - `prepareEscrowClaimTx(options, secretHex, recipientWallet)`
 *     (`src/lib/contracts/escrow.ts`) therefore puts the **secret** in `args[0]`,
 *     and `home/page.tsx` calls it with `body.secret`;
 *   - `claimHash = sha256(secret)` (`src/lib/wallet/claim-link-client.ts`), so
 *     `args[0]` can never equal `claimHash`.
 *
 * So every genuine claim is rejected with 500 'Claim hash does not match'. That
 * is a route bug, not a requirement — see the test named
 * 'rejects the transaction shape the real client actually sends' below. The
 * hash-shaped tests here pin current behaviour only.
 */
describe('POST /api/wallet/claim-links/claim-submit', () => {
  it('returns 401 without a session cookie', async () => {
    const res = await POST(
      createClaimSubmitRequest({
        claimLinkId: UNKNOWN_UUID,
        signedXdr: buildClaimXdr(),
      })
    );
    expect(res.status).toBe(401);
  });

  it('returns 401 for a session cookie that is not a valid token', async () => {
    const res = await POST(
      createClaimSubmitRequest(
        { claimLinkId: UNKNOWN_UUID, signedXdr: buildClaimXdr() },
        'not-a-jwt'
      )
    );
    expect(res.status).toBe(401);
  });

  it('returns 404 when the wallet is not deployed', async () => {
    await createUser(RECIPIENT_EMAIL, '000000');
    await setEmailVerified(RECIPIENT_EMAIL);
    const token = await createSessionToken({ email: RECIPIENT_EMAIL });

    const res = await POST(
      createClaimSubmitRequest(
        { claimLinkId: UNKNOWN_UUID, signedXdr: buildClaimXdr() },
        token
      )
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Wallet not deployed');
  });

  it('returns 400 for a body that is not JSON', async () => {
    cookieJar[SESSION_COOKIE_NAME] = await seedRecipient();
    const req = new NextRequest(
      'http://localhost/api/wallet/claim-links/claim-submit',
      { method: 'POST', body: 'not json' }
    );

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Invalid JSON body');
  });

  it('returns 400 when signedXdr is missing', async () => {
    const token = await seedRecipient();
    const res = await POST(
      createClaimSubmitRequest({ claimLinkId: UNKNOWN_UUID }, token)
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('claimLinkId and signedXdr are required');
  });

  it('returns 400 when claimLinkId is missing', async () => {
    const token = await seedRecipient();
    const res = await POST(
      createClaimSubmitRequest({ signedXdr: buildClaimXdr() }, token)
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('claimLinkId and signedXdr are required');
  });

  it('returns 404 when no claim link has that id', async () => {
    const token = await seedRecipient();
    const res = await POST(
      createClaimSubmitRequest(
        { claimLinkId: UNKNOWN_UUID, signedXdr: buildClaimXdr() },
        token
      )
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Claim link not found or not available to you');
  });

  it('returns 404 for a link addressed to somebody else', async () => {
    await seedSender();
    const token = await seedRecipient();
    const link = await seedClaimLink({ recipientEmail: 'carol@example.com' });

    const res = await POST(
      createClaimSubmitRequest(
        { claimLinkId: link.id, signedXdr: buildClaimXdr() },
        token
      )
    );
    expect(res.status).toBe(404);
  });

  it('returns 404 for a link that is no longer pending', async () => {
    await seedSender();
    const token = await seedRecipient();
    const link = await seedClaimLink({ status: 'claimed' });

    const res = await POST(
      createClaimSubmitRequest(
        { claimLinkId: link.id, signedXdr: buildClaimXdr() },
        token
      )
    );
    expect(res.status).toBe(404);
  });

  it('returns 410 for an expired link', async () => {
    await seedSender();
    const token = await seedRecipient();
    const link = await seedClaimLink({ expiry: new Date(Date.now() - 1000) });

    const res = await POST(
      createClaimSubmitRequest(
        { claimLinkId: link.id, signedXdr: buildClaimXdr() },
        token
      )
    );
    expect(res.status).toBe(410);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Claim link has expired');
  });

  it('accepts a transaction whose first argument is the claim hash (NOT what the real client sends — see the bug note above), marks the link claimed and counts a success', async () => {
    await seedSender();
    const token = await seedRecipient();
    const link = await seedClaimLink();

    const res = await POST(
      createClaimSubmitRequest(
        { claimLinkId: link.id, signedXdr: buildClaimXdr() },
        token
      )
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hash: string };
    expect(body.hash).toBe('claim-tx-hash');

    const [after] = await db.select().from(schema.claimLinks);
    expect(after.status).toBe('claimed');
    expect(after.claimedAt).not.toBeNull();
    expect(await getMetric('wallet.claim.success')).toBe(1);
    expect(await getMetric('wallet.claim.failure')).toBe(0);
  });

  it('matches a link addressed to the user phone (same hash-shaped transaction as above)', async () => {
    await seedSender();
    const token = await seedRecipient({ phone: RECIPIENT_PHONE });
    const link = await seedClaimLink({
      recipientEmail: null,
      recipientPhone: RECIPIENT_PHONE,
    });

    const res = await POST(
      createClaimSubmitRequest(
        { claimLinkId: link.id, signedXdr: buildClaimXdr() },
        token
      )
    );
    expect(res.status).toBe(200);
  });
});

describe('POST /api/wallet/claim-links/claim-submit — validateSignedClaim', () => {
  async function seedForValidation() {
    await seedSender();
    const token = await seedRecipient();
    const link = await seedClaimLink();
    return { token, link };
  }

  it('returns 500 when the claim hash does not match the link', async () => {
    const { token, link } = await seedForValidation();

    const res = await POST(
      createClaimSubmitRequest(
        { claimLinkId: link.id, signedXdr: buildClaimXdr(OTHER_HASH) },
        token
      )
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Claim hash does not match');

    const [after] = await db.select().from(schema.claimLinks);
    expect(after.status).toBe('pending');
    expect(await getMetric('wallet.claim.failure')).toBe(1);
    expect(await getMetric('wallet.claim.success')).toBe(0);
  });

  it('rejects the transaction shape the real client actually sends (BUG: every genuine claim fails)', async () => {
    // Builds the transaction exactly as `prepareEscrowClaimTx` does: args[0] is
    // the 32 raw *secret* bytes, args[1] is the recipient wallet. The contract
    // hashes args[0] itself, but the route compares args[0]'s hex to
    // `link.claimHash`, so the two can never agree and the claim is refused.
    //
    // This asserts the bug, not the requirement. When the route is fixed to
    // compare `sha256(args[0])` against `link.claimHash`, invert this test to
    // expect 200 and a 'claimed' link. Tracked in #135.
    await seedSender();
    const token = await seedRecipient();
    const link = await seedClaimLink({ claimHash: REAL_CLAIM_HASH });
    const signedXdr = buildXdr([
      {
        contractId: ESCROW_CONTRACT,
        functionName: 'claim',
        args: [bytesScVal(REAL_SECRET), addressScVal(RECIPIENT_CONTRACT)],
      },
    ]);

    const res = await POST(
      createClaimSubmitRequest({ claimLinkId: link.id, signedXdr }, token)
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Claim hash does not match');

    const [after] = await db.select().from(schema.claimLinks);
    expect(after.status).toBe('pending');
    expect(after.claimedAt).toBeNull();
    expect(await getMetric('wallet.claim.failure')).toBe(1);
    expect(await getMetric('wallet.claim.success')).toBe(0);
  });

  it('returns 500 when the funds would go to another wallet', async () => {
    const { token, link } = await seedForValidation();

    const res = await POST(
      createClaimSubmitRequest(
        {
          claimLinkId: link.id,
          signedXdr: buildClaimXdr(CLAIM_HASH, OTHER_CONTRACT),
        },
        token
      )
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Recipient wallet does not match');

    const [after] = await db.select().from(schema.claimLinks);
    expect(after.status).toBe('pending');
  });

  it('returns 500 when the transaction invokes another contract', async () => {
    const { token, link } = await seedForValidation();

    const res = await POST(
      createClaimSubmitRequest(
        {
          claimLinkId: link.id,
          signedXdr: buildClaimXdr(CLAIM_HASH, RECIPIENT_CONTRACT, OTHER_CONTRACT),
        },
        token
      )
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Transaction invokes the wrong contract');
  });

  it('returns 500 when the transaction calls a function other than claim', async () => {
    const { token, link } = await seedForValidation();
    const signedXdr = buildXdr([
      {
        contractId: ESCROW_CONTRACT,
        functionName: 'refund',
        args: [bytesScVal(CLAIM_HASH), addressScVal(RECIPIENT_CONTRACT)],
      },
    ]);

    const res = await POST(
      createClaimSubmitRequest({ claimLinkId: link.id, signedXdr }, token)
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Transaction must call claim');
  });

  it('returns 500 when claim is called with the wrong number of arguments', async () => {
    const { token, link } = await seedForValidation();
    const signedXdr = buildXdr([
      {
        contractId: ESCROW_CONTRACT,
        functionName: 'claim',
        args: [bytesScVal(CLAIM_HASH)],
      },
    ]);

    const res = await POST(
      createClaimSubmitRequest({ claimLinkId: link.id, signedXdr }, token)
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('claim argument count is malformed');
  });

  it('returns 500 when the transaction carries more than one operation', async () => {
    const { token, link } = await seedForValidation();
    const op = {
      contractId: ESCROW_CONTRACT,
      functionName: 'claim',
      args: [bytesScVal(CLAIM_HASH), addressScVal(RECIPIENT_CONTRACT)],
    };
    const signedXdr = buildXdr([op, op]);

    const res = await POST(
      createClaimSubmitRequest({ claimLinkId: link.id, signedXdr }, token)
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Claim transaction must contain exactly one operation');
  });

  it('returns 500 when NEXT_PUBLIC_ESCROW_CONTRACT_ID is not configured', async () => {
    const { token, link } = await seedForValidation();
    const signedXdr = buildClaimXdr();
    delete process.env.NEXT_PUBLIC_ESCROW_CONTRACT_ID;

    const res = await POST(
      createClaimSubmitRequest({ claimLinkId: link.id, signedXdr }, token)
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('NEXT_PUBLIC_ESCROW_CONTRACT_ID is not configured');
  });
});

/**
 * Rate-limit wiring (issue #36). The limiter itself is tested in
 * `src/lib/rate-limit.test.ts`; this only proves the handler charges it, which
 * nothing else would catch if the call were removed from this route alone.
 */
describe('POST /api/wallet/claim-links/claim-submit — rate limiting', () => {
  it('returns 429 once the fee-payer budget is spent', async () => {
    await seedSender();
    const token = await seedRecipient();
    const link = await seedClaimLink();
    await exhaustFeePayerBudget(
      'wallet.claim-links.claim-submit',
      RECIPIENT_EMAIL
    );

    const res = await POST(
      createClaimSubmitRequest(
        { claimLinkId: link.id, signedXdr: buildClaimXdr() },
        token
      )
    );
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
  });
});
