import { describe, it, expect, beforeEach, vi } from 'vitest';
import { POST } from './route';
import {
  createUser,
  setEmailVerified,
  getUserByEmail,
  takePasskeyChallenge,
} from '@/lib/auth/store';
import { createSessionToken } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/config';
import {
  createRecoveryToken,
  RECOVERY_COOKIE_NAME,
} from '@/lib/auth/recovery-token';

let cookieJar: Record<string, string> = {};

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockImplementation(() => ({
    get: (name: string) =>
      cookieJar[name] ? { value: cookieJar[name], name } : undefined,
    set: (name: string, value: string) => {
      cookieJar[name] = value;
    },
  })),
}));

beforeEach(() => {
  cookieJar = {};
});

async function seedUser(email = 'alice@example.com') {
  await createUser(email, '000000');
  await setEmailVerified(email);
  return email;
}

describe('POST /api/wallet/passkey-challenge', () => {
  it('returns 401 without any credential', async () => {
    const res = await POST();
    expect(res.status).toBe(401);
  });

  it('returns 401 for a garbage session cookie', async () => {
    cookieJar[SESSION_COOKIE_NAME] = 'not-a-jwt';
    const res = await POST();
    expect(res.status).toBe(401);
  });

  it('issues a challenge to a session', async () => {
    const email = await seedUser();
    cookieJar[SESSION_COOKIE_NAME] = await createSessionToken({ email });

    const res = await POST();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { challenge: string };
    expect(body.challenge).toBeTruthy();

    const user = await getUserByEmail(email);
    expect(user?.passkeyChallenge).toBe(body.challenge);
  });

  // Recovery enrols a new passkey precisely when there is no session, so the
  // recovery cookie has to be accepted here too.
  it('issues a challenge to a recovery cookie', async () => {
    const email = await seedUser();
    cookieJar[RECOVERY_COOKIE_NAME] = await createRecoveryToken(email);

    const res = await POST();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { challenge: string };
    expect(body.challenge).toBeTruthy();
  });

  it('issues base64url, which is how WebAuthn encodes the challenge', async () => {
    const email = await seedUser();
    cookieJar[SESSION_COOKIE_NAME] = await createSessionToken({ email });

    const res = await POST();
    const body = (await res.json()) as { challenge: string };
    expect(body.challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    // 32 random bytes.
    expect(Buffer.from(body.challenge, 'base64url')).toHaveLength(32);
  });

  it('issues a different challenge every time', async () => {
    const email = await seedUser();
    cookieJar[SESSION_COOKIE_NAME] = await createSessionToken({ email });

    const first = (await (await POST()).json()) as { challenge: string };
    const second = (await (await POST()).json()) as { challenge: string };
    expect(second.challenge).not.toBe(first.challenge);

    // Only the most recent one is live.
    expect(await takePasskeyChallenge(email)).toBe(second.challenge);
  });

  it('does not disturb the login challenge', async () => {
    const email = await seedUser();
    cookieJar[SESSION_COOKIE_NAME] = await createSessionToken({ email });
    const { setPendingChallenge } = await import('@/lib/auth/store');
    await setPendingChallenge(email, 'login-challenge');

    await POST();

    const user = await getUserByEmail(email);
    expect(user?.pendingChallenge).toBe('login-challenge');
  });
});
