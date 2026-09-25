import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';
import {
  Account,
  Asset,
  Contract,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  xdr,
} from '@stellar/stellar-sdk';
import { POST } from './route';
import { createUser, setEmailVerified, setWallet } from '@/lib/auth/store';
import { createSessionToken } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/config';
import { NETWORK_PASSPHRASE } from '@/lib/wallet/network';
import { getUsdcContractId, getXlmContractId } from '@/lib/wallet/assets';
import { addressScVal, amountToBaseUnits, i128ScVal } from '@/lib/wallet/amount';
import { decryptSecret } from '@/lib/wallet/claim-secrets';
import { submitSignedTransaction } from '@/lib/wallet/submit';
import { db, schema } from '@/lib/db';
import type { Mailer } from '@/lib/mail/mailer';

let cookieJar: Record<string, string> = {};

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockImplementation(() => ({
    get: (name: string) => (cookieJar[name] ? { value: cookieJar[name], name } : undefined),
    set: (name: string, value: string) => {
      cookieJar[name] = value;
    },
  })),
}));

/**
 * The mailer the route's notification step will use, swapped per test.
 *
 * Stubbing the seam rather than `deliverClaimLinkNotification` is deliberate:
 * the #120 guard is only worth anything if a *provider* blowing up cannot
 * reach the response, and stubbing the wrapper would test past the bug.
 */
let mailer: Mailer;

vi.mock('@/lib/mail/mailer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/mail/mailer')>();
  return { ...actual, getMailer: () => mailer };
});

vi.mock('@/lib/wallet/submit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/wallet/submit')>();
  return {
    ...actual,
    submitSignedTransaction: vi.fn().mockResolvedValue({ hash: 'deposit-tx-hash' }),
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
const ENCRYPTION_KEY = 'a'.repeat(64);
const SENDER_EMAIL = 'alice@example.com';
const RECIPIENT_EMAIL = 'bob@example.com';
const RECIPIENT_PHONE = '+639123456789';
const SECRET = 'deadbeef'.repeat(8);
// NOTE: this is sha256 of the ASCII *hex string*, not of the 32 raw secret
// bytes, so it is not the pairing a real client produces —
// `claim-link-client.ts` hashes the raw bytes. It is harmless here only
// because `create` never checks that the `claimHash` and `secret` it is handed
// actually correspond; do not copy this pairing into a test that does.
const CLAIM_HASH = createHash('sha256').update(SECRET).digest('hex');
const CURRENT_LEDGER = 1_000_000;
const LEDGERS_PER_DAY = (24 * 60 * 60) / 5;

/** The ledger the client is expected to derive for a given expiry in days. */
function ledgerFor(days: number): number {
  return CURRENT_LEDGER + Math.floor(days * LEDGERS_PER_DAY);
}

function hashRecipientId(id: string): string {
  return createHash('sha256').update(id).digest('hex');
}

function bytesScVal(hex: string): xdr.ScVal {
  return nativeToScVal(Buffer.from(hex, 'hex'), { type: 'bytes' });
}

function u64ScVal(value: number): xdr.ScVal {
  return nativeToScVal(BigInt(value), { type: 'u64' });
}

beforeEach(() => {
  cookieJar = {};
  mailer = { name: 'log', send: async () => ({ ok: true, provider: 'log' }) };
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  process.env.NEXT_PUBLIC_ESCROW_CONTRACT_ID = ESCROW_CONTRACT;
  process.env.CLAIM_SECRET_ENCRYPTION_KEY = ENCRYPTION_KEY;
  // Only `sequence` is read by the route; the ledger header and close meta
  // would have to be real XDR objects, so cast like src/lib/contracts/escrow.test.ts.
  vi.spyOn(rpc.Server.prototype, 'getLatestLedger').mockResolvedValue({
    id: 'ledger-id',
    sequence: CURRENT_LEDGER,
    protocolVersion: '23',
  } as unknown as rpc.Api.GetLatestLedgerResponse);
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_ESCROW_CONTRACT_ID;
  delete process.env.CLAIM_SECRET_ENCRYPTION_KEY;
  vi.restoreAllMocks();
});

interface DepositOverrides {
  contractId?: string;
  functionName?: string;
  sender?: string;
  token?: string;
  amount?: string;
  claimHash?: string;
  recipientIdHash?: string;
  expiryLedger?: number;
  args?: xdr.ScVal[];
}

function buildDepositXdr(overrides: DepositOverrides = {}): string {
  const args = overrides.args ?? [
    addressScVal(overrides.sender ?? SENDER_CONTRACT),
    addressScVal(overrides.token ?? getUsdcContractId()),
    i128ScVal(amountToBaseUnits(overrides.amount ?? '1')),
    bytesScVal(overrides.claimHash ?? CLAIM_HASH),
    bytesScVal(overrides.recipientIdHash ?? hashRecipientId(RECIPIENT_EMAIL)),
    u64ScVal(overrides.expiryLedger ?? ledgerFor(7)),
  ];

  const source = new Account(FEE_PAYER_PUBLIC, '0');
  return new TransactionBuilder(source, {
    fee: '100000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      new Contract(overrides.contractId ?? ESCROW_CONTRACT).call(
        overrides.functionName ?? 'deposit',
        ...args
      )
    )
    .setTimeout(30)
    .build()
    .toXDR();
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    signedXdr: buildDepositXdr(),
    asset: 'USDC',
    amount: '1',
    recipient: RECIPIENT_EMAIL,
    expiryDays: 7,
    expiryLedger: ledgerFor(7),
    claimHash: CLAIM_HASH,
    secret: SECRET,
    ...overrides,
  };
}

function createCreateRequest(body: unknown, token?: string) {
  if (token) {
    cookieJar[SESSION_COOKIE_NAME] = token;
  }
  return new NextRequest('http://localhost/api/wallet/claim-links/create', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function seedSender() {
  await createUser(SENDER_EMAIL, '000000');
  await setEmailVerified(SENDER_EMAIL);
  await setWallet(SENDER_EMAIL, {
    walletContractId: SENDER_CONTRACT,
    stellarAddress: SENDER_CONTRACT,
    primaryPasskeyKeyId: 'cred-id',
  });
  return createSessionToken({ email: SENDER_EMAIL });
}

async function errorOf(res: Response): Promise<string> {
  const body = (await res.json()) as { error: string };
  return body.error;
}

describe('POST /api/wallet/claim-links/create — session and body', () => {
  it('returns 401 without a session cookie', async () => {
    const res = await POST(createCreateRequest(validBody()));
    expect(res.status).toBe(401);
  });

  it('returns 401 for a session cookie that is not a valid token', async () => {
    const res = await POST(createCreateRequest(validBody(), 'not-a-jwt'));
    expect(res.status).toBe(401);
  });

  it('returns 404 when the wallet is not deployed', async () => {
    await createUser(SENDER_EMAIL, '000000');
    await setEmailVerified(SENDER_EMAIL);
    const token = await createSessionToken({ email: SENDER_EMAIL });

    const res = await POST(createCreateRequest(validBody(), token));
    expect(res.status).toBe(404);
    expect(await errorOf(res)).toBe('Wallet not deployed');
  });

  it('returns 400 for a body that is not JSON', async () => {
    cookieJar[SESSION_COOKIE_NAME] = await seedSender();
    const req = new NextRequest('http://localhost/api/wallet/claim-links/create', {
      method: 'POST',
      body: 'not json',
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe('Invalid JSON body');
  });

  it.each([
    'signedXdr',
    'asset',
    'amount',
    'recipient',
    'expiryDays',
    'expiryLedger',
    'claimHash',
    'secret',
  ])('returns 400 when %s is missing', async (field) => {
    const token = await seedSender();
    const body = validBody() as Record<string, unknown>;
    delete body[field];

    const res = await POST(createCreateRequest(body, token));
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe('Missing required fields');
  });
});

describe('POST /api/wallet/claim-links/create — field validation', () => {
  it('returns 400 for an unsupported asset', async () => {
    const token = await seedSender();
    const res = await POST(
      createCreateRequest(validBody({ asset: 'BTC' }), token)
    );
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe('Asset must be USDC or XLM');
  });

  it('returns 400 for a non-numeric amount', async () => {
    const token = await seedSender();
    const res = await POST(
      createCreateRequest(validBody({ amount: 'not-a-number' }), token)
    );
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe('Amount must be a positive number');
  });

  it('returns 400 for a zero amount', async () => {
    const token = await seedSender();
    const res = await POST(createCreateRequest(validBody({ amount: '0' }), token));
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe('Amount must be a positive number');
  });

  it('returns 400 for a negative amount', async () => {
    const token = await seedSender();
    const res = await POST(createCreateRequest(validBody({ amount: '-1' }), token));
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe('Amount must be a positive number');
  });

  it('returns 400 for an amount with more than seven decimals', async () => {
    const token = await seedSender();
    const res = await POST(
      createCreateRequest(validBody({ amount: '1.12345678' }), token)
    );
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe('Amount cannot have more than 7 decimal places');
  });

  it.each(['@bob_user', 'not-a-recipient', SENDER_CONTRACT, '+123'])(
    'returns 400 when the recipient %s is neither a phone nor an email',
    async (recipient) => {
      const token = await seedSender();
      const res = await POST(createCreateRequest(validBody({ recipient }), token));
      expect(res.status).toBe(400);
      expect(await errorOf(res)).toBe(
        'Recipient must be a phone number or email address'
      );
    }
  );

  it.each([31, 1.5, -1])('returns 400 for expiryDays %s', async (expiryDays) => {
    const token = await seedSender();
    const res = await POST(createCreateRequest(validBody({ expiryDays }), token));
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe('Expiry must be an integer between 1 and 30 days');
  });

  it('accepts the lower expiry bound of one day', async () => {
    const token = await seedSender();
    const res = await POST(
      createCreateRequest(
        validBody({
          expiryDays: 1,
          expiryLedger: ledgerFor(1),
          signedXdr: buildDepositXdr({ expiryLedger: ledgerFor(1) }),
        }),
        token
      )
    );
    expect(res.status).toBe(200);
  });

  it('accepts the upper expiry bound of thirty days', async () => {
    const token = await seedSender();
    const res = await POST(
      createCreateRequest(
        validBody({
          expiryDays: 30,
          expiryLedger: ledgerFor(30),
          signedXdr: buildDepositXdr({ expiryLedger: ledgerFor(30) }),
        }),
        token
      )
    );
    expect(res.status).toBe(200);
  });
});

describe('POST /api/wallet/claim-links/create — ledger range', () => {
  it('returns 400 when the expiry ledger is below the expected range', async () => {
    const token = await seedSender();
    const expiryLedger = CURRENT_LEDGER + Math.floor(5 * LEDGERS_PER_DAY);
    const res = await POST(
      createCreateRequest(
        validBody({ expiryLedger, signedXdr: buildDepositXdr({ expiryLedger }) }),
        token
      )
    );
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe(
      'Expiry ledger is out of expected range for the given days'
    );
  });

  it('returns 400 when the expiry ledger is above the expected range', async () => {
    const token = await seedSender();
    const expiryLedger = CURRENT_LEDGER + Math.floor(9 * LEDGERS_PER_DAY);
    const res = await POST(
      createCreateRequest(
        validBody({ expiryLedger, signedXdr: buildDepositXdr({ expiryLedger }) }),
        token
      )
    );
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe(
      'Expiry ledger is out of expected range for the given days'
    );
  });

  it('accepts an expiry ledger a day either side of the nominal value', async () => {
    const token = await seedSender();
    for (const days of [6, 8]) {
      await db.delete(schema.claimLinks);
      const expiryLedger = ledgerFor(days);
      const res = await POST(
        createCreateRequest(
          validBody({ expiryLedger, signedXdr: buildDepositXdr({ expiryLedger }) }),
          token
        )
      );
      expect(res.status).toBe(200);
    }
  });
});

describe('POST /api/wallet/claim-links/create — validateSignedDeposit', () => {
  it('returns 400 when the transaction has more than one operation', async () => {
    const token = await seedSender();
    const source = new Account(FEE_PAYER_PUBLIC, '0');
    const call = new Contract(ESCROW_CONTRACT).call(
      'deposit',
      addressScVal(SENDER_CONTRACT)
    );
    const signedXdr = new TransactionBuilder(source, {
      fee: '100000',
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(call)
      .addOperation(call)
      .setTimeout(30)
      .build()
      .toXDR();

    const res = await POST(createCreateRequest(validBody({ signedXdr }), token));
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe(
      'Deposit transaction must contain exactly one operation'
    );
  });

  it('returns 400 when the operation does not invoke a contract', async () => {
    const token = await seedSender();
    const source = new Account(FEE_PAYER_PUBLIC, '0');
    const signedXdr = new TransactionBuilder(source, {
      fee: '100000',
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        Operation.payment({
          destination: FEE_PAYER_PUBLIC,
          asset: Asset.native(),
          amount: '1',
        })
      )
      .setTimeout(30)
      .build()
      .toXDR();

    const res = await POST(createCreateRequest(validBody({ signedXdr }), token));
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe('Transaction does not invoke a contract');
  });

  it('returns 400 when the transaction invokes another contract', async () => {
    const token = await seedSender();
    const signedXdr = buildDepositXdr({ contractId: OTHER_CONTRACT });

    const res = await POST(createCreateRequest(validBody({ signedXdr }), token));
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe('Transaction invokes the wrong contract');
  });

  it('returns 400 when the transaction calls a function other than deposit', async () => {
    const token = await seedSender();
    const signedXdr = buildDepositXdr({ functionName: 'claim' });

    const res = await POST(createCreateRequest(validBody({ signedXdr }), token));
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe('Transaction must call deposit');
  });

  it('returns 400 when deposit is called with the wrong number of arguments', async () => {
    const token = await seedSender();
    const signedXdr = buildDepositXdr({ args: [addressScVal(SENDER_CONTRACT)] });

    const res = await POST(createCreateRequest(validBody({ signedXdr }), token));
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe('deposit argument count is malformed');
  });

  it('returns 400 when the deposit is signed by a different wallet', async () => {
    const token = await seedSender();
    const signedXdr = buildDepositXdr({ sender: OTHER_CONTRACT });

    const res = await POST(createCreateRequest(validBody({ signedXdr }), token));
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe('Sender does not match user wallet');
  });

  it('returns 400 when the token contract does not match the asset', async () => {
    const token = await seedSender();
    const signedXdr = buildDepositXdr({ token: getXlmContractId() });

    const res = await POST(
      createCreateRequest(validBody({ asset: 'USDC', signedXdr }), token)
    );
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe('Token contract does not match asset');
  });

  it('returns 400 when the signed amount does not match the request', async () => {
    const token = await seedSender();
    const signedXdr = buildDepositXdr({ amount: '2' });

    const res = await POST(
      createCreateRequest(validBody({ amount: '1', signedXdr }), token)
    );
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe('Amount does not match request');
  });

  it('returns 400 when the signed claim hash does not match the request', async () => {
    const token = await seedSender();
    const signedXdr = buildDepositXdr({ claimHash: '99887766'.repeat(8) });

    const res = await POST(createCreateRequest(validBody({ signedXdr }), token));
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe('Claim hash does not match');
  });

  it('returns 400 when the recipient id hash is for a different recipient', async () => {
    const token = await seedSender();
    const signedXdr = buildDepositXdr({
      recipientIdHash: hashRecipientId('carol@example.com'),
    });

    const res = await POST(createCreateRequest(validBody({ signedXdr }), token));
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe('Recipient ID hash does not match');
  });

  it('returns 400 when the signed expiry ledger does not match the request', async () => {
    const token = await seedSender();
    // Still inside the accepted range, so it gets past the range check.
    const signedXdr = buildDepositXdr({ expiryLedger: ledgerFor(7) + 1 });

    const res = await POST(createCreateRequest(validBody({ signedXdr }), token));
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toBe('Expiry ledger does not match request');
  });

  it('returns 500 for a malformed XDR', async () => {
    const token = await seedSender();
    const res = await POST(
      createCreateRequest(validBody({ signedXdr: 'not-valid-xdr' }), token)
    );
    expect(res.status).toBe(500);
  });

  it('returns 500, not 400, when NEXT_PUBLIC_ESCROW_CONTRACT_ID is not configured', async () => {
    const token = await seedSender();
    const body = validBody();
    delete process.env.NEXT_PUBLIC_ESCROW_CONTRACT_ID;

    const res = await POST(createCreateRequest(body, token));
    expect(res.status).toBe(500);
    expect(await errorOf(res)).toBe(
      'NEXT_PUBLIC_ESCROW_CONTRACT_ID is not configured'
    );
  });
});

describe('POST /api/wallet/claim-links/create — success', () => {
  it('records an email claim link, encrypts the secret and queues a notification', async () => {
    const token = await seedSender();

    const res = await POST(createCreateRequest(validBody(), token));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hash: string; claimLinkId: string };
    expect(body.hash).toBe('deposit-tx-hash');

    const [link] = await db.select().from(schema.claimLinks);
    expect(link.id).toBe(body.claimLinkId);
    expect(link.senderEmail).toBe(SENDER_EMAIL);
    expect(link.recipientEmail).toBe(RECIPIENT_EMAIL);
    expect(link.recipientPhone).toBeNull();
    expect(link.tokenContractId).toBe(getUsdcContractId());
    expect(link.amount).toBe('10000000');
    expect(link.claimHash).toBe(CLAIM_HASH);
    expect(link.status).toBe('pending');
    expect(link.txHash).toBe('deposit-tx-hash');
    expect(link.claimedAt).toBeNull();

    // Stored encrypted, not in the clear, but recoverable by the claim route.
    expect(link.secretCiphertext).not.toContain(SECRET);
    expect(decryptSecret(link.secretCiphertext)).toBe(SECRET);

    // The Postgres expiry is a timestamp, not the ledger sequence the contract
    // takes, and is derived from expiryDays rather than from expiryLedger.
    const expectedExpiry = Date.now() + 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(link.expiry.getTime() - expectedExpiry)).toBeLessThan(60_000);

    const notifications = await db.select().from(schema.notifications);
    expect(notifications).toHaveLength(1);
    expect(notifications[0].claimLinkId).toBe(link.id);
    expect(notifications[0].channel).toBe('email');
    expect(notifications[0].recipient).toBe(RECIPIENT_EMAIL);
    expect(notifications[0].status).toBe('sent');
    expect(notifications[0].attempts).toBe(1);
    expect(notifications[0].error).toBeNull();
  });

  it('normalizes an email recipient to lower case', async () => {
    const token = await seedSender();
    const res = await POST(
      createCreateRequest(validBody({ recipient: '  BOB@Example.COM  ' }), token)
    );
    expect(res.status).toBe(200);

    const [link] = await db.select().from(schema.claimLinks);
    expect(link.recipientEmail).toBe(RECIPIENT_EMAIL);
  });

  it('records a phone claim link and queues an SMS notification', async () => {
    const token = await seedSender();
    const signedXdr = buildDepositXdr({
      recipientIdHash: hashRecipientId(RECIPIENT_PHONE),
    });

    const res = await POST(
      createCreateRequest(
        validBody({ recipient: '+63 912 345 6789', signedXdr }),
        token
      )
    );
    expect(res.status).toBe(200);

    const [link] = await db.select().from(schema.claimLinks);
    expect(link.recipientPhone).toBe(RECIPIENT_PHONE);
    expect(link.recipientEmail).toBeNull();

    const notifications = await db.select().from(schema.notifications);
    expect(notifications[0].channel).toBe('sms');
    expect(notifications[0].recipient).toBe(RECIPIENT_PHONE);
    // There is no SMS provider; recording 'sent' would be a lie (issue #60).
    expect(notifications[0].status).toBe('unsupported');
    expect(notifications[0].attempts).toBe(0);
  });

  it('records an XLM claim link', async () => {
    const token = await seedSender();
    const signedXdr = buildDepositXdr({ token: getXlmContractId() });

    const res = await POST(
      createCreateRequest(validBody({ asset: 'XLM', signedXdr }), token)
    );
    expect(res.status).toBe(200);

    const [link] = await db.select().from(schema.claimLinks);
    expect(link.tokenContractId).toBe(getXlmContractId());
  });

  it('returns 500 for a duplicate claim hash, after the deposit has been submitted', async () => {
    // claim_hash is UNIQUE, so the second insert raises rather than failing
    // validation — and it raises *after* submitSignedTransaction has already
    // put the escrow deposit on chain (issue #120).
    const token = await seedSender();
    // Counted per test: the shared mock is never auto-cleared between tests.
    vi.mocked(submitSignedTransaction).mockClear();
    expect((await POST(createCreateRequest(validBody(), token))).status).toBe(200);

    const res = await POST(createCreateRequest(validBody(), token));
    expect(res.status).toBe(500);

    const links = await db.select().from(schema.claimLinks);
    expect(links).toHaveLength(1);
    // The costly half of #120: the second deposit was submitted to the network
    // before the insert failed, so the funds are in escrow with no row to claim.
    expect(vi.mocked(submitSignedTransaction)).toHaveBeenCalledTimes(2);
  });
});

/**
 * Issue #120 — notification delivery must not be able to fail the request.
 *
 * `submitSignedTransaction` has already put the escrow deposit on chain and
 * the claim_links row is committed by the time the notification is attempted.
 * A 500 here sends `send/page.tsx` back to the `claim-link-review` step, from
 * which the user can authorize a SECOND deposit for the same payment. So a
 * mail provider that times out, 4xxs or simply explodes has to leave the
 * response alone.
 */
describe('POST /api/wallet/claim-links/create — notification failures never fail the request', () => {
  async function createAndExpectSuccess(): Promise<string> {
    const token = await seedSender();
    const res = await POST(createCreateRequest(validBody(), token));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hash: string; claimLinkId: string };
    expect(body.hash).toBe('deposit-tx-hash');
    return body.claimLinkId;
  }

  // The single most important test in this change.
  it('returns 200 with the tx hash when the mailer THROWS', async () => {
    mailer = {
      name: 'exploding',
      send: () => Promise.reject(new Error('mail provider exploded')),
    };

    const claimLinkId = await createAndExpectSuccess();

    // The deposit is on chain and the link is claimable; only the telling-them
    // part failed, and it says so on the row.
    const [link] = await db.select().from(schema.claimLinks);
    expect(link.id).toBe(claimLinkId);
    expect(link.status).toBe('pending');
    expect(link.txHash).toBe('deposit-tx-hash');

    const [notification] = await db.select().from(schema.notifications);
    expect(notification.status).toBe('failed');
    expect(notification.error).toContain('mail provider exploded');
    expect(notification.attempts).toBe(1);
    expect(notification.sentAt).toBeNull();
  });

  it('returns 200 and records failed when the mailer returns a failure result', async () => {
    mailer = {
      name: 'resend',
      send: async () => ({
        ok: false as const,
        provider: 'resend',
        error: 'Resend responded 429: rate limited',
      }),
    };

    await createAndExpectSuccess();

    const [notification] = await db.select().from(schema.notifications);
    expect(notification.status).toBe('failed');
    expect(notification.error).toContain('Resend responded 429');
    expect(notification.attempts).toBe(1);
    expect(notification.lastAttemptAt).not.toBeNull();
  });

  it('submits the deposit exactly once when delivery fails', async () => {
    // The costly half of #120 is the retry the 500 invites. One request, one
    // deposit, whatever the mailer does.
    vi.mocked(submitSignedTransaction).mockClear();
    mailer = {
      name: 'exploding',
      send: () => Promise.reject(new Error('mail provider exploded')),
    };

    await createAndExpectSuccess();
    expect(vi.mocked(submitSignedTransaction)).toHaveBeenCalledTimes(1);
  });

  it('does not attempt delivery for an SMS recipient, and still returns 200', async () => {
    let attempts = 0;
    mailer = {
      name: 'counting',
      send: async () => {
        attempts += 1;
        return { ok: true as const, provider: 'counting' };
      },
    };

    const token = await seedSender();
    const signedXdr = buildDepositXdr({
      recipientIdHash: hashRecipientId(RECIPIENT_PHONE),
    });
    const res = await POST(
      createCreateRequest(validBody({ recipient: RECIPIENT_PHONE, signedXdr }), token)
    );

    expect(res.status).toBe(200);
    expect(attempts).toBe(0);
    const [notification] = await db.select().from(schema.notifications);
    expect(notification.status).toBe('unsupported');
  });
});
