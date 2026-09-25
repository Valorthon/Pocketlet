import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  deliverClaimLinkNotification,
  buildClaimLinkEmail,
} from './notifications';
import type { Mailer, MailResult } from './mail/mailer';
import { db, schema } from './db';
import { createUser } from './auth/store';

/** The mailer `getMailer()` hands back, swapped per test. */
let mailer: Mailer;

vi.mock('./mail/mailer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./mail/mailer')>();
  return { ...actual, getMailer: () => mailer };
});

const SENDER_EMAIL = 'alice@example.com';
const RECIPIENT_EMAIL = 'bob@example.com';
const RECIPIENT_PHONE = '+639123456789';

/** A mailer that records what it was asked to send. */
function stubMailer(result: MailResult): Mailer & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    name: result.provider,
    calls,
    async send(message) {
      calls.push(message);
      return result;
    },
  };
}

async function seedClaimLink(): Promise<string> {
  await createUser(SENDER_EMAIL, '000000');
  const [link] = await db
    .insert(schema.claimLinks)
    .values({
      senderEmail: SENDER_EMAIL,
      recipientEmail: RECIPIENT_EMAIL,
      tokenContractId: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
      amount: '250000000',
      claimHash: 'a'.repeat(64),
      secretCiphertext: 'ciphertext',
      expiry: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    })
    .returning();
  return link.id;
}

async function notificationFor(claimLinkId: string) {
  const rows = await db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.claimLinkId, claimLinkId));
  expect(rows).toHaveLength(1);
  return rows[0];
}

beforeEach(() => {
  mailer = stubMailer({ ok: true, provider: 'log' });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildClaimLinkEmail', () => {
  const message = buildClaimLinkEmail(RECIPIENT_EMAIL, '25', 'USDC');

  it('names the amount and asset in the subject', () => {
    expect(message.subject).toBe('You have 25 USDC waiting on Pocketlet');
    expect(message.to).toBe(RECIPIENT_EMAIL);
  });

  // There is no claim page and no claim URL: api/wallet/claim-links/pending
  // matches pending links against the logged-in user's email or phone. Copy
  // that implies a link to click would be describing a route that does not
  // exist, and would send the recipient looking for one.
  it('tells the recipient to sign up with this exact address, not to click', () => {
    expect(message.text).toContain('nothing to click');
    expect(message.text).toContain('Sign up using this exact email address');
    expect(message.text).toContain(RECIPIENT_EMAIL);
    expect(message.text).toContain('http://localhost:3000');
    expect(message.text.toLowerCase()).not.toContain('click here');
    expect(message.text).not.toMatch(/\/claim/);
  });

  it('carries no claim secret', () => {
    // The secret is the on-chain preimage; anyone holding it could claim the
    // escrow regardless of who they are. It must never leave the database.
    expect(message.text).not.toMatch(/[0-9a-f]{32,}/);
  });
});

describe('deliverClaimLinkNotification — email', () => {
  it('records a sent notification when the mailer succeeds', async () => {
    const claimLinkId = await seedClaimLink();
    const sender = stubMailer({ ok: true, provider: 'log' });
    mailer = sender;

    const outcome = await deliverClaimLinkNotification({
      claimLinkId,
      channel: 'email',
      recipient: RECIPIENT_EMAIL,
      amount: '25',
      asset: 'USDC',
    });

    expect(outcome).toEqual({ status: 'sent' });
    expect(sender.calls).toHaveLength(1);

    const row = await notificationFor(claimLinkId);
    expect(row.channel).toBe('email');
    expect(row.recipient).toBe(RECIPIENT_EMAIL);
    expect(row.status).toBe('sent');
    expect(row.attempts).toBe(1);
    expect(row.error).toBeNull();
    expect(row.sentAt).not.toBeNull();
    expect(row.lastAttemptAt).not.toBeNull();
  });

  it('records a failed notification, with the error, when the mailer reports failure', async () => {
    const claimLinkId = await seedClaimLink();
    mailer = stubMailer({
      ok: false,
      provider: 'resend',
      error: 'Resend responded 422: domain not verified',
    });

    const outcome = await deliverClaimLinkNotification({
      claimLinkId,
      channel: 'email',
      recipient: RECIPIENT_EMAIL,
      amount: '25',
      asset: 'USDC',
    });

    expect(outcome.status).toBe('failed');
    expect(outcome.error).toContain('domain not verified');

    const row = await notificationFor(claimLinkId);
    expect(row.status).toBe('failed');
    expect(row.attempts).toBe(1);
    expect(row.error).toContain('resend: Resend responded 422');
    expect(row.sentAt).toBeNull();
    expect(row.lastAttemptAt).not.toBeNull();
  });

  // A Mailer is contractually forbidden from throwing, but this function is
  // the last thing between a provider bug and a 500 on a request whose escrow
  // deposit is already on chain (issue #120).
  it('records a failure instead of propagating when the mailer throws', async () => {
    const claimLinkId = await seedClaimLink();
    mailer = {
      name: 'exploding',
      send: () => Promise.reject(new Error('provider client blew up')),
    };

    const outcome = await deliverClaimLinkNotification({
      claimLinkId,
      channel: 'email',
      recipient: RECIPIENT_EMAIL,
      amount: '25',
      asset: 'USDC',
    });

    expect(outcome.status).toBe('failed');
    const row = await notificationFor(claimLinkId);
    expect(row.status).toBe('failed');
    expect(row.error).toContain('provider client blew up');
  });

  it('records a failure when the mailer throws synchronously', async () => {
    const claimLinkId = await seedClaimLink();
    mailer = {
      name: 'exploding',
      send: () => {
        throw new Error('synchronous blow-up');
      },
    };

    const outcome = await deliverClaimLinkNotification({
      claimLinkId,
      channel: 'email',
      recipient: RECIPIENT_EMAIL,
      amount: '25',
      asset: 'USDC',
    });

    expect(outcome.status).toBe('failed');
    expect((await notificationFor(claimLinkId)).error).toContain(
      'synchronous blow-up'
    );
  });

  it('truncates a very long provider error rather than storing an essay', async () => {
    const claimLinkId = await seedClaimLink();
    mailer = stubMailer({ ok: false, provider: 'resend', error: 'x'.repeat(5000) });

    await deliverClaimLinkNotification({
      claimLinkId,
      channel: 'email',
      recipient: RECIPIENT_EMAIL,
      amount: '25',
      asset: 'USDC',
    });

    const row = await notificationFor(claimLinkId);
    expect(row.error?.length).toBeLessThanOrEqual(500);
  });
});

describe('deliverClaimLinkNotification — sms', () => {
  it('records unsupported without attempting delivery', async () => {
    const claimLinkId = await seedClaimLink();
    const sender = stubMailer({ ok: true, provider: 'log' });
    mailer = sender;

    const outcome = await deliverClaimLinkNotification({
      claimLinkId,
      channel: 'sms',
      recipient: RECIPIENT_PHONE,
      amount: '25',
      asset: 'USDC',
    });

    expect(outcome).toEqual({ status: 'unsupported' });
    // No SMS provider exists; sending the text by email would be worse than
    // not sending it, so nothing is attempted at all.
    expect(sender.calls).toHaveLength(0);

    const row = await notificationFor(claimLinkId);
    expect(row.channel).toBe('sms');
    expect(row.recipient).toBe(RECIPIENT_PHONE);
    expect(row.status).toBe('unsupported');
    expect(row.attempts).toBe(0);
    expect(row.sentAt).toBeNull();
    expect(row.lastAttemptAt).toBeNull();
    expect(row.error).toContain('No SMS provider');
  });

  it('does not claim the SMS was sent', async () => {
    const claimLinkId = await seedClaimLink();
    await deliverClaimLinkNotification({
      claimLinkId,
      channel: 'sms',
      recipient: RECIPIENT_PHONE,
      amount: '25',
      asset: 'USDC',
    });
    expect((await notificationFor(claimLinkId)).status).not.toBe('sent');
  });
});

describe('deliverClaimLinkNotification — never throws', () => {
  it('returns a failure rather than throwing when the row cannot be inserted', async () => {
    // A claim link id that does not exist violates the foreign key, so the
    // very first statement raises. Even that resolves.
    const outcome = await deliverClaimLinkNotification({
      claimLinkId: '00000000-0000-0000-0000-000000000000',
      channel: 'email',
      recipient: RECIPIENT_EMAIL,
      amount: '25',
      asset: 'USDC',
    });

    expect(outcome.status).toBe('failed');
    expect(outcome.error).toBeTruthy();
    expect(await db.select().from(schema.notifications)).toHaveLength(0);
  });
});
