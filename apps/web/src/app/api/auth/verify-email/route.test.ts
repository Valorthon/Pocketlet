import { describe, it, expect, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { createUser, getUserByEmail, setVerificationCode } from '@/lib/auth/store';
import { SESSION_COOKIE_NAME } from '@/lib/auth/config';
import {
  VERIFICATION_CODE_EXPIRY_MS,
  VERIFICATION_CODE_MAX_ATTEMPTS,
} from '@/lib/auth/verification-code';

afterEach(() => {
  vi.useRealTimers();
});

function createVerifyRequest(body: unknown) {
  return new NextRequest('http://localhost/api/auth/verify-email', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/verify-email', () => {
  it('verifies email and sets a session cookie', async () => {
    await createUser('alice@example.com', '123456');

    const res = await POST(
      createVerifyRequest({ email: 'alice@example.com', code: '123456' })
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { email: string; verified: boolean };
    expect(body.email).toBe('alice@example.com');
    expect(body.verified).toBe(true);

    const cookie = res.cookies.get(SESSION_COOKIE_NAME);
    expect(cookie).toBeDefined();
    expect(cookie?.value).toBeTruthy();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.secure).toBe(false);
    expect(cookie?.sameSite).toBe('lax');

    const user = await getUserByEmail('alice@example.com');
    expect(user?.emailVerified).toBe(true);
    expect(user?.verificationCode).toBeUndefined();
  });

  it('returns 400 if email or code is missing', async () => {
    const res = await POST(createVerifyRequest({ email: 'alice@example.com' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Email and code are required');
  });

  it('returns 404 if user is not found', async () => {
    const res = await POST(
      createVerifyRequest({ email: 'missing@example.com', code: '123456' })
    );
    expect(res.status).toBe(404);
  });

  it('returns 401 if verification code is invalid', async () => {
    await createUser('alice@example.com', '123456');

    const res = await POST(
      createVerifyRequest({ email: 'alice@example.com', code: '000000' })
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Invalid verification code');

    const cookie = res.cookies.get(SESSION_COOKIE_NAME);
    expect(cookie).toBeUndefined();
  });
});

/**
 * Expiry, attempt cap and constant-time comparison (issue #121).
 *
 * These are what make the code a secret worth having now that issue #18 has
 * stopped handing it to the caller. Without them, removing it from the
 * response would be a net regression: a six-digit code that never expires and
 * accepts unlimited guesses is a 10^6 space anyone can walk.
 */
describe('POST /api/auth/verify-email code handling', () => {
  it('rejects an expired code and does not verify the address', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await createUser('alice@example.com', '123456');

    vi.advanceTimersByTime(VERIFICATION_CODE_EXPIRY_MS + 1000);

    const res = await POST(
      createVerifyRequest({ email: 'alice@example.com', code: '123456' })
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('expired');

    const user = await getUserByEmail('alice@example.com');
    expect(user?.emailVerified).toBe(false);
    expect(res.cookies.get(SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it('accepts a code right up to its expiry', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await createUser('alice@example.com', '123456');

    vi.advanceTimersByTime(VERIFICATION_CODE_EXPIRY_MS - 1000);

    const res = await POST(
      createVerifyRequest({ email: 'alice@example.com', code: '123456' })
    );
    expect(res.status).toBe(200);
  });

  it('counts wrong guesses against the cap', async () => {
    await createUser('alice@example.com', '123456');

    await POST(createVerifyRequest({ email: 'alice@example.com', code: '000000' }));
    expect((await getUserByEmail('alice@example.com'))?.verificationCodeAttempts).toBe(1);

    await POST(createVerifyRequest({ email: 'alice@example.com', code: '000001' }));
    expect((await getUserByEmail('alice@example.com'))?.verificationCodeAttempts).toBe(2);
  });

  it('destroys the code at the cap, so the correct code afterwards still fails', async () => {
    await createUser('alice@example.com', '123456');

    for (let i = 1; i < VERIFICATION_CODE_MAX_ATTEMPTS; i += 1) {
      const res = await POST(
        createVerifyRequest({ email: 'alice@example.com', code: '000000' })
      );
      expect(res.status, `attempt ${i}`).toBe(401);
    }

    const capped = await POST(
      createVerifyRequest({ email: 'alice@example.com', code: '000000' })
    );
    expect(capped.status).toBe(429);

    const afterLockout = await POST(
      createVerifyRequest({ email: 'alice@example.com', code: '123456' })
    );
    expect(afterLockout.status).toBe(401);

    const user = await getUserByEmail('alice@example.com');
    expect(user?.emailVerified).toBe(false);
    expect(user?.verificationCode).toBeUndefined();
  });

  it('gives a re-issued code a full attempt budget', async () => {
    await createUser('alice@example.com', '123456');
    for (let i = 0; i < VERIFICATION_CODE_MAX_ATTEMPTS; i += 1) {
      await POST(createVerifyRequest({ email: 'alice@example.com', code: '000000' }));
    }

    await setVerificationCode('alice@example.com', '654321');
    const res = await POST(
      createVerifyRequest({ email: 'alice@example.com', code: '654321' })
    );
    expect(res.status).toBe(200);
  });

  it('clears the code and its expiry once the address is verified', async () => {
    await createUser('alice@example.com', '123456');
    await POST(createVerifyRequest({ email: 'alice@example.com', code: '123456' }));

    const user = await getUserByEmail('alice@example.com');
    expect(user?.verificationCode).toBeUndefined();
    expect(user?.verificationCodeExpiresAt).toBeUndefined();
    expect(user?.verificationCodeAttempts).toBeUndefined();

    // A replay of the same code finds nothing to match against.
    const replay = await POST(
      createVerifyRequest({ email: 'alice@example.com', code: '123456' })
    );
    expect(replay.status).toBe(401);
  });

  it('compares the whole code, not a prefix', async () => {
    // The behavioural half of "constant-time": `constantTimeEquals` hashes
    // both sides, so a code sharing five of six digits with the real one is
    // exactly as wrong as one sharing none, and a longer string that starts
    // with the code is wrong too. Timing itself is not asserted — that test
    // would be flaky — but a `startsWith`/prefix comparison fails here.
    await createUser('alice@example.com', '123456');

    for (const wrong of ['12345', '1234567', '123450', '999999', '']) {
      const res = await POST(
        createVerifyRequest({ email: 'alice@example.com', code: wrong })
      );
      expect(res.status, `code ${JSON.stringify(wrong)}`).not.toBe(200);
      expect((await getUserByEmail('alice@example.com'))?.emailVerified).toBe(false);
    }
  });
});
