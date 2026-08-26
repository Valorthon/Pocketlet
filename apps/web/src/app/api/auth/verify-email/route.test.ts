import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { createUser, getUserByEmail } from '@/lib/auth/store';
import { SESSION_COOKIE_NAME } from '@/lib/auth/config';




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
