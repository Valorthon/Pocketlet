import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import {
  createUser,
  setEmailVerified,
  setProfile,
  setWallet,
} from '@/lib/auth/store';
import { createSessionToken } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/config';
import { encryptSecret } from '@/lib/wallet/claim-secrets';
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

const ENCRYPTION_KEY = 'a'.repeat(64);
const SENDER_EMAIL = 'alice@example.com';
const RECIPIENT_EMAIL = 'bob@example.com';
const RECIPIENT_PHONE = '+639123456789';
const RECIPIENT_CONTRACT =
  'CA7FMXWUMM3C37O4QF4E4R4KKXZIEBV7CTFHKDRDXPBLZQ2NMC5PZC5G';
const TOKEN_CONTRACT =
  'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
const SECRET = 'deadbeef'.repeat(8);
const CLAIM_HASH = '11223344'.repeat(8);
const UNKNOWN_UUID = '00000000-0000-4000-8000-000000000000';

beforeEach(() => {
  cookieJar = {};
  process.env.CLAIM_SECRET_ENCRYPTION_KEY = ENCRYPTION_KEY;
});

afterEach(() => {
  delete process.env.CLAIM_SECRET_ENCRYPTION_KEY;
});

function createClaimRequest(body: unknown, token?: string) {
  if (token) {
    cookieJar[SESSION_COOKIE_NAME] = token;
  }
  return new NextRequest('http://localhost/api/wallet/claim-links/claim', {
    method: 'POST',
    body: JSON.stringify(body),
  });
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
  secretCiphertext?: string;
  claimHash?: string;
  amount?: string;
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
      tokenContractId: TOKEN_CONTRACT,
      amount: overrides?.amount ?? '5000000',
      claimHash: overrides?.claimHash ?? CLAIM_HASH,
      secretCiphertext: overrides?.secretCiphertext ?? encryptSecret(SECRET),
      expiry: overrides?.expiry ?? new Date(Date.now() + 86_400_000),
      status: overrides?.status ?? 'pending',
    })
    .returning();
  return row;
}

describe('POST /api/wallet/claim-links/claim', () => {
  it('returns 401 without a session cookie', async () => {
    const res = await POST(createClaimRequest({ claimLinkId: UNKNOWN_UUID }));
    expect(res.status).toBe(401);
  });

  it('returns 401 for a session cookie that is not a valid token', async () => {
    const res = await POST(
      createClaimRequest({ claimLinkId: UNKNOWN_UUID }, 'not-a-jwt')
    );
    expect(res.status).toBe(401);
  });

  it('returns 404 when the session user does not exist', async () => {
    const token = await createSessionToken({ email: 'ghost@example.com' });
    const res = await POST(createClaimRequest({ claimLinkId: UNKNOWN_UUID }, token));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Wallet not deployed');
  });

  it('returns 404 when the wallet is not deployed', async () => {
    await createUser(RECIPIENT_EMAIL, '000000');
    await setEmailVerified(RECIPIENT_EMAIL);
    const token = await createSessionToken({ email: RECIPIENT_EMAIL });

    const res = await POST(createClaimRequest({ claimLinkId: UNKNOWN_UUID }, token));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Wallet not deployed');
  });

  it('returns 400 for a body that is not JSON', async () => {
    const token = await seedRecipient();
    cookieJar[SESSION_COOKIE_NAME] = token;
    const req = new NextRequest('http://localhost/api/wallet/claim-links/claim', {
      method: 'POST',
      body: 'not json',
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Invalid JSON body');
  });

  it('returns 400 when claimLinkId is missing', async () => {
    const token = await seedRecipient();
    const res = await POST(createClaimRequest({}, token));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('claimLinkId is required');
  });

  it('returns 403 when the account has neither phone nor email to match on', async () => {
    // The email column is the primary key, so the only account whose `email`
    // is falsy is one stored with the empty string. Signup cannot produce one,
    // but the route's 403 branch is otherwise unreachable.
    await createUser('', '000000');
    await setEmailVerified('');
    await setWallet('', {
      walletContractId: RECIPIENT_CONTRACT,
      stellarAddress: RECIPIENT_CONTRACT,
      primaryPasskeyKeyId: 'cred-id',
    });
    const token = await createSessionToken({ email: '' });

    const res = await POST(createClaimRequest({ claimLinkId: UNKNOWN_UUID }, token));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Your account has no phone or email to match against');
  });

  it('returns 404 when no claim link has that id', async () => {
    const token = await seedRecipient();
    const res = await POST(createClaimRequest({ claimLinkId: UNKNOWN_UUID }, token));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Claim link not found or not available to you');
  });

  it('returns 404 for a link addressed to somebody else', async () => {
    await seedSender();
    const token = await seedRecipient();
    const link = await seedClaimLink({ recipientEmail: 'carol@example.com' });

    const res = await POST(createClaimRequest({ claimLinkId: link.id }, token));
    expect(res.status).toBe(404);
  });

  it('returns 404 for a link that is no longer pending', async () => {
    await seedSender();
    const token = await seedRecipient();
    const link = await seedClaimLink({ status: 'claimed' });

    const res = await POST(createClaimRequest({ claimLinkId: link.id }, token));
    expect(res.status).toBe(404);
  });

  it('returns 410 for an expired link', async () => {
    await seedSender();
    const token = await seedRecipient();
    const link = await seedClaimLink({ expiry: new Date(Date.now() - 1000) });

    const res = await POST(createClaimRequest({ claimLinkId: link.id }, token));
    expect(res.status).toBe(410);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Claim link has expired');
  });

  it('returns 500 when the stored secret cannot be decrypted', async () => {
    await seedSender();
    const token = await seedRecipient();
    const link = await seedClaimLink({ secretCiphertext: 'garbage' });

    const res = await POST(createClaimRequest({ claimLinkId: link.id }, token));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Failed to decrypt claim secret');
  });

  it('returns the decrypted secret for a link addressed to the user email', async () => {
    await seedSender();
    const token = await seedRecipient();
    const link = await seedClaimLink();

    const res = await POST(createClaimRequest({ claimLinkId: link.id }, token));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      secret: string;
      claimHash: string;
      amount: string;
      tokenContractId: string;
    };
    expect(body.secret).toBe(SECRET);
    expect(body.claimHash).toBe(CLAIM_HASH);
    expect(body.amount).toBe('5000000');
    expect(body.tokenContractId).toBe(TOKEN_CONTRACT);
  });

  it('returns the decrypted secret for a link addressed to the user phone', async () => {
    await seedSender();
    const token = await seedRecipient({ phone: RECIPIENT_PHONE });
    const link = await seedClaimLink({
      recipientEmail: null,
      recipientPhone: RECIPIENT_PHONE,
    });

    const res = await POST(createClaimRequest({ claimLinkId: link.id }, token));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { secret: string };
    expect(body.secret).toBe(SECRET);
  });

  it('throws instead of answering when claimLinkId is not a UUID', async () => {
    // Documents current behaviour, not desired behaviour: the id goes straight
    // into a `uuid` comparison with no format check, so Postgres rejects it
    // (SQLSTATE 22P02) outside any try/catch and the handler rejects rather
    // than returning 400 or 404.
    const token = await seedRecipient();
    await expect(
      POST(createClaimRequest({ claimLinkId: 'not-a-uuid' }, token))
    ).rejects.toThrow();
  });

  it('leaves the link pending — reading the secret does not claim it', async () => {
    await seedSender();
    const token = await seedRecipient();
    const link = await seedClaimLink();

    await POST(createClaimRequest({ claimLinkId: link.id }, token));

    const [after] = await db.select().from(schema.claimLinks);
    expect(after.id).toBe(link.id);
    expect(after.status).toBe('pending');
    expect(after.claimedAt).toBeNull();
  });
});
