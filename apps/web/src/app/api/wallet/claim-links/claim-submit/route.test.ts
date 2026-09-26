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
/**
 * A genuine secret/hash pair, built the way `claim-link-client.ts` builds one:
 * a 32-byte secret, and `sha256(secret)` as the claim hash. The contract's
 * `claim(secret, recipient_wallet)` takes the **secret**, so this is the shape
 * every real client sends and the shape these tests must use (issue #135).
 */
const SECRET = 'a1b2c3d4'.repeat(8);
const CLAIM_HASH = createHash('sha256')
  .update(Buffer.from(SECRET, 'hex'))
  .digest('hex');
/** A secret belonging to some other link — its hash matches nothing here. */
const OTHER_SECRET = '99887766'.repeat(8);
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
  secret = SECRET,
  recipientWallet = RECIPIENT_CONTRACT,
  contractId = ESCROW_CONTRACT
): string {
  return buildXdr([
    {
      contractId,
      functionName: 'claim',
      args: [bytesScVal(secret), addressScVal(recipientWallet)],
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
      claimHash: CLAIM_HASH,
      secretCiphertext: 'iv:tag:ciphertext',
      expiry: overrides?.expiry ?? new Date(Date.now() + 86_400_000),
      status: overrides?.status ?? 'pending',
    })
    .returning();
  return row;
}

/**
 * `buildClaimXdr` puts the 32-byte **secret** into `args[0]`, which is what a
 * real client sends: the contract is
 * `claim(secret: BytesN<32>, recipient_wallet: Address)`
 * (`contracts/escrow/src/lib.rs`) and derives `sha256(secret)` itself to find
 * the deposit, so `prepareEscrowClaimTx(options, secretHex, recipientWallet)`
 * passes the secret and `home/page.tsx` calls it with `body.secret`.
 *
 * These tests used to put the claim **hash** in `args[0]` instead, because
 * that is what the route compared against `link.claimHash` — so they were
 * green against a route that rejected every genuine claim with a 500 (#135).
 * The fixture pairs `SECRET` with `CLAIM_HASH = sha256(SECRET)`, so a default
 * `buildClaimXdr()` against a default `seedClaimLink()` is now a claim that
 * should succeed. If that pairing is ever broken, most of this file goes red
 * at once — which is the intent.
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

  // Overlaps with the #135 regression test below, deliberately. This one is
  // the happy path through the shared fixture; that one spells the transaction
  // out by hand so it still describes the real client shape if the fixture is
  // ever changed again. Before #135 was fixed they differed -- this one was
  // hash-shaped and passed, that one was secret-shaped and asserted the bug.
  it('marks the link claimed and counts a success', async () => {
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

  it('matches a link addressed to the user phone', async () => {
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

  it('returns 500 for a secret belonging to a different link', async () => {
    const { token, link } = await seedForValidation();

    const res = await POST(
      createClaimSubmitRequest(
        { claimLinkId: link.id, signedXdr: buildClaimXdr(OTHER_SECRET) },
        token
      )
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Claim secret does not match this link');

    const [after] = await db.select().from(schema.claimLinks);
    expect(after.status).toBe('pending');
    expect(await getMetric('wallet.claim.failure')).toBe(1);
    expect(await getMetric('wallet.claim.success')).toBe(0);
  });

  it('accepts the transaction shape the real client actually sends', async () => {
    // The regression test for #135. Built exactly as `prepareEscrowClaimTx`
    // builds it: args[0] is the 32 raw *secret* bytes, args[1] the recipient
    // wallet. The route must hash args[0] before comparing it to
    // `link.claimHash`; comparing args[0] directly -- which it used to do --
    // can never match, so this asserted a 500 until the route was fixed.
    await seedSender();
    const token = await seedRecipient();
    const link = await seedClaimLink();
    const signedXdr = buildXdr([
      {
        contractId: ESCROW_CONTRACT,
        functionName: 'claim',
        args: [bytesScVal(SECRET), addressScVal(RECIPIENT_CONTRACT)],
      },
    ]);

    const res = await POST(
      createClaimSubmitRequest({ claimLinkId: link.id, signedXdr }, token)
    );
    expect(res.status).toBe(200);

    const [after] = await db.select().from(schema.claimLinks);
    expect(after.status).toBe('claimed');
    expect(after.claimedAt).not.toBeNull();
    expect(await getMetric('wallet.claim.success')).toBe(1);
    expect(await getMetric('wallet.claim.failure')).toBe(0);
  });

  it('returns 500 when the funds would go to another wallet', async () => {
    const { token, link } = await seedForValidation();

    const res = await POST(
      createClaimSubmitRequest(
        {
          claimLinkId: link.id,
          signedXdr: buildClaimXdr(SECRET, OTHER_CONTRACT),
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
          signedXdr: buildClaimXdr(SECRET, RECIPIENT_CONTRACT, OTHER_CONTRACT),
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
        args: [bytesScVal(SECRET), addressScVal(RECIPIENT_CONTRACT)],
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
        args: [bytesScVal(SECRET)],
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
      args: [bytesScVal(SECRET), addressScVal(RECIPIENT_CONTRACT)],
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
