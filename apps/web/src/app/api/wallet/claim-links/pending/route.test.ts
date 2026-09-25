import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GET } from './route';
import { createUser, setEmailVerified, setProfile } from '@/lib/auth/store';
import { createSessionToken } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/config';
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

const SENDER_EMAIL = 'alice@example.com';
const RECIPIENT_EMAIL = 'bob@example.com';
const RECIPIENT_PHONE = '+639123456789';
const TOKEN_CONTRACT =
  'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';

interface PendingClaim {
  id: string;
  senderEmail: string;
  tokenContractId: string;
  amount: string;
  expiry: string;
  createdAt: string;
}

beforeEach(() => {
  cookieJar = {};
});

async function seedSender(email = SENDER_EMAIL) {
  await createUser(email, '000000');
  await setEmailVerified(email);
  return email;
}

async function seedRecipient(
  email: string,
  profile?: { username?: string; phone?: string }
) {
  await createUser(email, '000000');
  await setEmailVerified(email);
  if (profile) {
    await setProfile(email, profile);
  }
  cookieJar[SESSION_COOKIE_NAME] = await createSessionToken({ email });
}

async function seedClaimLink(overrides: {
  claimHash: string;
  recipientEmail?: string | null;
  recipientPhone?: string | null;
  status?: string;
  senderEmail?: string;
  amount?: string;
  expiry?: Date;
}) {
  const [row] = await db
    .insert(schema.claimLinks)
    .values({
      senderEmail: overrides.senderEmail ?? SENDER_EMAIL,
      recipientEmail: overrides.recipientEmail ?? null,
      recipientPhone: overrides.recipientPhone ?? null,
      tokenContractId: TOKEN_CONTRACT,
      amount: overrides.amount ?? '10000000',
      claimHash: overrides.claimHash,
      secretCiphertext: 'iv:tag:ciphertext',
      expiry: overrides.expiry ?? new Date(Date.now() + 86_400_000),
      status: overrides.status ?? 'pending',
    })
    .returning();
  return row;
}

describe('GET /api/wallet/claim-links/pending', () => {
  it('returns 401 without a session cookie', async () => {
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns 401 for a session cookie that is not a valid token', async () => {
    cookieJar[SESSION_COOKIE_NAME] = 'not-a-jwt';
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns 404 when the session user no longer exists', async () => {
    cookieJar[SESSION_COOKIE_NAME] = await createSessionToken({
      email: 'ghost@example.com',
    });
    const res = await GET();
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('User not found');
  });

  it('returns an empty list when nothing is addressed to the user', async () => {
    await seedSender();
    await seedRecipient(RECIPIENT_EMAIL);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { claims: PendingClaim[] };
    expect(body.claims).toEqual([]);
  });

  it('returns a pending link addressed to the user email', async () => {
    await seedSender();
    await seedRecipient(RECIPIENT_EMAIL);
    const link = await seedClaimLink({
      claimHash: 'hash-email',
      recipientEmail: RECIPIENT_EMAIL,
      amount: '2500000',
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { claims: PendingClaim[] };
    expect(body.claims).toHaveLength(1);
    expect(body.claims[0].id).toBe(link.id);
    expect(body.claims[0].senderEmail).toBe(SENDER_EMAIL);
    expect(body.claims[0].tokenContractId).toBe(TOKEN_CONTRACT);
    expect(body.claims[0].amount).toBe('2500000');
    expect(body.claims[0].expiry).toBe(link.expiry.toISOString());
    expect(body.claims[0].createdAt).toBe(link.createdAt.toISOString());
  });

  it('returns a pending link addressed to the user phone', async () => {
    await seedSender();
    await seedRecipient(RECIPIENT_EMAIL, { phone: RECIPIENT_PHONE });
    const link = await seedClaimLink({
      claimHash: 'hash-phone',
      recipientPhone: RECIPIENT_PHONE,
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { claims: PendingClaim[] };
    expect(body.claims.map((c) => c.id)).toEqual([link.id]);
  });

  it('omits the encrypted secret and the claim hash from the response', async () => {
    await seedSender();
    await seedRecipient(RECIPIENT_EMAIL);
    await seedClaimLink({
      claimHash: 'hash-secrecy',
      recipientEmail: RECIPIENT_EMAIL,
    });

    const res = await GET();
    const body = (await res.json()) as { claims: Record<string, unknown>[] };
    expect(body.claims).toHaveLength(1);
    expect(Object.keys(body.claims[0]).sort()).toEqual([
      'amount',
      'createdAt',
      'expiry',
      'id',
      'senderEmail',
      'tokenContractId',
    ]);
    expect(JSON.stringify(body)).not.toContain('iv:tag:ciphertext');
    expect(JSON.stringify(body)).not.toContain('hash-secrecy');
  });

  it('excludes links that are no longer pending', async () => {
    await seedSender();
    await seedRecipient(RECIPIENT_EMAIL);
    await seedClaimLink({
      claimHash: 'hash-claimed',
      recipientEmail: RECIPIENT_EMAIL,
      status: 'claimed',
    });
    await seedClaimLink({
      claimHash: 'hash-refunded',
      recipientEmail: RECIPIENT_EMAIL,
      status: 'refunded',
    });

    const res = await GET();
    const body = (await res.json()) as { claims: PendingClaim[] };
    expect(body.claims).toEqual([]);
  });

  it('still lists a pending link whose expiry has already passed (documented bug)', async () => {
    // Documents current behaviour, not desired behaviour: the query filters on
    // `status = 'pending'` and the recipient only, never on `expiry`. So an
    // expired link is offered to the recipient here and then rejected with 410
    // by claim-submit. The fix belongs in a separate PR; when it lands, this
    // test should expect an empty list.
    await seedSender();
    await seedRecipient(RECIPIENT_EMAIL);
    const expired = await seedClaimLink({
      claimHash: 'hash-expired',
      recipientEmail: RECIPIENT_EMAIL,
      expiry: new Date(Date.now() - 86_400_000),
    });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { claims: PendingClaim[] };
    expect(body.claims.map((c) => c.id)).toEqual([expired.id]);
  });

  it('excludes links addressed to somebody else', async () => {
    await seedSender();
    await seedRecipient(RECIPIENT_EMAIL, { phone: RECIPIENT_PHONE });
    await seedClaimLink({
      claimHash: 'hash-other-email',
      recipientEmail: 'carol@example.com',
    });
    await seedClaimLink({
      claimHash: 'hash-other-phone',
      recipientPhone: '+639987654321',
    });
    const mine = await seedClaimLink({
      claimHash: 'hash-mine',
      recipientEmail: RECIPIENT_EMAIL,
    });

    const res = await GET();
    const body = (await res.json()) as { claims: PendingClaim[] };
    expect(body.claims.map((c) => c.id)).toEqual([mine.id]);
  });
});
