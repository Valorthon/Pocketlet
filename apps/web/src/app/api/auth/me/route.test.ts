import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GET } from './route';
import { createUser, setEmailVerified, setCredential, setProfile } from '@/lib/auth/store';
import { createSessionToken } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/config';

let cookieJar: Record<string, string> = {};

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockImplementation(() => ({
    get: (name: string) => (cookieJar[name] ? { value: cookieJar[name], name } : undefined),
    set: (name: string, value: string) => {
      cookieJar[name] = value;
    },
  })),
}));

beforeEach(() => {
  cookieJar = {};
});

describe('GET /api/auth/me', () => {
  it('returns 401 without a session cookie', async () => {
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns the current user with username and phone', async () => {
    await createUser('alice@example.com', '000000');
    await setEmailVerified('alice@example.com');
    await setCredential('alice@example.com', {
      id: 'cred-id',
      publicKey: 'base64-pubkey',
      counter: 0,
    });
    await setProfile('alice@example.com', { username: 'alice', phone: '+639123456789' });

    const token = await createSessionToken({ email: 'alice@example.com' });
    cookieJar[SESSION_COOKIE_NAME] = token;

    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      user: { email: string; username?: string; phone?: string };
    };
    expect(body.user.email).toBe('alice@example.com');
    expect(body.user.username).toBe('alice');
    expect(body.user.phone).toBe('+639123456789');
  });
});
