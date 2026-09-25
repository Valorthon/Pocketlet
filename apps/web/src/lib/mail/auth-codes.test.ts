import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildAuthCodeEmail, sendAuthCodeEmail } from './auth-codes';
import type { Mailer, MailMessage } from './mailer';
import { VERIFICATION_CODE_EXPIRY_MS } from '@/lib/auth/verification-code';

let mailer: Mailer;
let sent: MailMessage[];

vi.mock('./mailer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./mailer')>();
  return { ...actual, getMailer: () => mailer };
});

beforeEach(() => {
  sent = [];
  mailer = {
    name: 'log',
    send: async (message) => {
      sent.push(message);
      return { ok: true, provider: 'log' };
    },
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

const PURPOSES = ['signup', 'pin-reset', 'recovery'] as const;

describe('buildAuthCodeEmail', () => {
  it.each(PURPOSES)('carries the code for %s', (purpose) => {
    const message = buildAuthCodeEmail('alice@example.com', '135790', purpose);
    expect(message.to).toBe('alice@example.com');
    expect(message.subject).toContain('Pocketlet');
    expect(message.text).toContain('135790');
  });

  it.each(PURPOSES)('has nothing to click for %s', (purpose) => {
    const { text } = buildAuthCodeEmail('alice@example.com', '135790', purpose);
    // A code email is the app's most attractive phishing template; teaching
    // recipients to click links in one would be actively harmful. Same rule as
    // buildClaimLinkEmail in src/lib/notifications.ts.
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).toContain('nothing to click in this email');
  });

  it.each(PURPOSES)('tells the recipient how long they have (%s)', (purpose) => {
    const { text } = buildAuthCodeEmail('alice@example.com', '135790', purpose);
    expect(text).toContain(`${VERIFICATION_CODE_EXPIRY_MS / 60_000} minutes`);
  });

  it('says what the code is for, so three identical emails are distinguishable', () => {
    const subjects = PURPOSES.map(
      (purpose) => buildAuthCodeEmail('a@b.com', '111111', purpose).subject
    );
    expect(new Set(subjects).size).toBe(PURPOSES.length);
  });
});

describe('sendAuthCodeEmail', () => {
  it('hands the message to the configured mailer', async () => {
    const result = await sendAuthCodeEmail('alice@example.com', '135790', 'signup');
    expect(result.ok).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('135790');
  });

  it('returns a failed result rather than throwing', async () => {
    mailer = {
      name: 'broken',
      send: async () => ({ ok: false, provider: 'broken', error: 'nope' }),
    };
    const result = await sendAuthCodeEmail('alice@example.com', '135790', 'signup');
    expect(result).toEqual({ ok: false, provider: 'broken', error: 'nope' });
  });

  it('converts a mailer that breaks its never-throws contract into a result', async () => {
    mailer = {
      name: 'exploding',
      send: async () => {
        throw new Error('provider down');
      },
    };
    const result = await sendAuthCodeEmail('alice@example.com', '135790', 'signup');
    expect(result).toEqual({
      ok: false,
      provider: 'exploding',
      error: 'provider down',
    });
  });
});
