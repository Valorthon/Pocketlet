import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PATCH } from './route';
import { createUser, setEmailVerified, setCredential } from '@/lib/auth/store';
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

async function createAuthenticatedUser(email: string) {
  await createUser(email, '000000');
  await setEmailVerified(email);
  await setCredential(email, {
    id: 'cred-id',
    publicKey: 'base64-pubkey',
    counter: 0,
  });
  return createSessionToken({ email });
}

function setSession(token: string) {
  cookieJar[SESSION_COOKIE_NAME] = token;
}

function createPatchRequest(body: unknown) {
  return new NextRequest('http://localhost/api/auth/profile', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/auth/profile', () => {
  it('returns 401 without a session cookie', async () => {
    const req = createPatchRequest({ username: 'alice' });
    const res = await PATCH(req);
    expect(res.status).toBe(401);
  });

  it('updates username and phone for the authenticated user', async () => {
    const token = await createAuthenticatedUser('alice@example.com');
    setSession(token);
    const req = createPatchRequest({ username: 'alice', phone: '+639123456789' });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { email: string; username: string; phone: string };
    expect(body.email).toBe('alice@example.com');
    expect(body.username).toBe('alice');
    expect(body.phone).toBe('+639123456789');
  });

  it('normalizes and strips @ from usernames', async () => {
    const token = await createAuthenticatedUser('alice@example.com');
    setSession(token);
    const req = createPatchRequest({ username: '@Alice_123' });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { username: string };
    expect(body.username).toBe('alice_123');
  });

  it('rejects an invalid username format', async () => {
    const token = await createAuthenticatedUser('alice@example.com');
    setSession(token);
    const req = createPatchRequest({ username: 'ab' });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Username must be');
  });

  it('rejects an invalid phone format', async () => {
    const token = await createAuthenticatedUser('alice@example.com');
    setSession(token);
    const req = createPatchRequest({ phone: '09123456789' });
    const res = await PATCH(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Phone number must include');
  });

  it('returns 409 when the username is taken by another user', async () => {
    const aliceToken = await createAuthenticatedUser('alice@example.com');
    const bobToken = await createAuthenticatedUser('bob@example.com');

    setSession(aliceToken);
    await PATCH(createPatchRequest({ username: 'taken' }));

    setSession(bobToken);
    const bobRes = await PATCH(createPatchRequest({ username: 'taken' }));
    expect(bobRes.status).toBe(409);
    const body = (await bobRes.json()) as { error: string };
    expect(body.error).toContain('Username already taken');
  });

  it('returns 409 when the phone is registered by another user', async () => {
    const aliceToken = await createAuthenticatedUser('alice@example.com');
    const bobToken = await createAuthenticatedUser('bob@example.com');

    setSession(aliceToken);
    await PATCH(createPatchRequest({ phone: '+639123456789' }));

    setSession(bobToken);
    const bobRes = await PATCH(createPatchRequest({ phone: '+639123456789' }));
    expect(bobRes.status).toBe(409);
    const body = (await bobRes.json()) as { error: string };
    expect(body.error).toContain('Phone number already registered');
  });

  it('allows clearing profile fields', async () => {
    const token = await createAuthenticatedUser('alice@example.com');
    setSession(token);
    await PATCH(createPatchRequest({ username: 'alice', phone: '+639123456789' }));

    const req = createPatchRequest({ username: null, phone: '' });
    const res = await PATCH(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { username?: string; phone?: string };
    expect(body.username).toBeUndefined();
    expect(body.phone).toBeUndefined();
  });
});
