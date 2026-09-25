import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import {
  createUser,
  setEmailVerified,
  setCredential,
  setWallet,
  setProfile,
} from '@/lib/auth/store';
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

afterEach(() => {
  vi.unstubAllEnvs();
});

async function createUserWithWallet(email: string, username?: string, phone?: string) {
  await createUser(email, '000000');
  await setEmailVerified(email);
  await setCredential(email, {
    id: 'cred-id',
    publicKey: 'base64-pubkey',
    counter: 0,
  });
  await setWallet(email, {
    walletContractId: 'CRECIPIENT',
    stellarAddress: 'GCHCVLYHMRISIGAYR6HA6LNNMD5OTLLUFKIEZMXEZ4ZPM27SAK5TI46P',
    primaryPasskeyKeyId: 'cred-id',
  });
  if (username || phone) {
    await setProfile(email, { username, phone });
  }
  return createSessionToken({ email });
}

const RECIPIENT_ADDRESS =
  'GCCUPAD2H2RHIQMAPPY6RPLOVCAU5MY5BA43UPKU2UGB4AIEPJSXDDGI';

/** A second, registered user — the one being addressed, not the caller. */
async function createRecipient(email: string) {
  await createUser(email, '000000');
  await setEmailVerified(email);
  await setCredential(email, {
    id: 'cred-id-2',
    publicKey: 'base64-pubkey-2',
    counter: 0,
  });
  await setWallet(email, {
    walletContractId: 'CRECIPIENT2',
    stellarAddress: RECIPIENT_ADDRESS,
    primaryPasskeyKeyId: 'cred-id-2',
  });
}

function createResolveRequest(
  body: unknown,
  token?: string,
  headers?: Record<string, string>
) {
  if (token) {
    cookieJar[SESSION_COOKIE_NAME] = token;
  }
  return new NextRequest('http://localhost/api/wallet/resolve', {
    method: 'POST',
    body: JSON.stringify(body),
    headers,
  });
}

describe('POST /api/wallet/resolve', () => {
  it('returns 401 without a session cookie', async () => {
    const req = createResolveRequest({ recipient: '@alice' });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('resolves a username', async () => {
    const token = await createUserWithWallet('alice@example.com', 'alice');
    const req = createResolveRequest({ recipient: '@alice' }, token);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { type: string; address: string; display: string };
    expect(body.type).toBe('username');
    expect(body.display).toBe('@alice');
    expect(body.address).toBe('GCHCVLYHMRISIGAYR6HA6LNNMD5OTLLUFKIEZMXEZ4ZPM27SAK5TI46P');
  });

  it('resolves a phone number', async () => {
    const token = await createUserWithWallet('alice@example.com', undefined, '+639123456789');
    const req = createResolveRequest({ recipient: '+63 912 345 6789' }, token);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { type: string; address: string; display: string };
    expect(body.type).toBe('phone');
    expect(body.display).toBe('+639123456789');
    expect(body.address).toBe('GCHCVLYHMRISIGAYR6HA6LNNMD5OTLLUFKIEZMXEZ4ZPM27SAK5TI46P');
  });

  it('resolves a raw Stellar address', async () => {
    const token = await createUserWithWallet('alice@example.com');
    const address = 'GCCUPAD2H2RHIQMAPPY6RPLOVCAU5MY5BA43UPKU2UGB4AIEPJSXDDGI';
    const req = createResolveRequest({ recipient: address }, token);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { type: string; address: string; display: string };
    expect(body.type).toBe('address');
    expect(body.address).toBe(address);
    expect(body.display).toBe(address);
  });

  it('returns 404 for an unknown recipient', async () => {
    const token = await createUserWithWallet('alice@example.com');
    const req = createResolveRequest({ recipient: '@unknown' }, token);
    const res = await POST(req);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Recipient not found');
  });

  it('resolves a registered email to a direct transfer', async () => {
    const token = await createUserWithWallet('alice@example.com');
    await createRecipient('bob@example.com');
    const req = createResolveRequest({ recipient: 'bob@example.com' }, token);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { type: string; address: string; display: string };
    expect(body.type).toBe('email');
    expect(body.display).toBe('bob@example.com');
    expect(body.address).toBe(RECIPIENT_ADDRESS);
  });

  it('resolves a registered email regardless of case', async () => {
    const token = await createUserWithWallet('alice@example.com');
    await createRecipient('bob@example.com');
    const req = createResolveRequest({ recipient: '  Bob@Example.COM ' }, token);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { type: string; display: string };
    expect(body.type).toBe('email');
    expect(body.display).toBe('bob@example.com');
  });

  it('offers a claim link for an email nobody is registered under', async () => {
    const token = await createUserWithWallet('alice@example.com');
    const req = createResolveRequest({ recipient: 'nobody@example.com' }, token);
    const res = await POST(req);
    expect(res.status).toBe(404);
    const body = (await res.json()) as {
      unregistered: boolean;
      identifier: string;
      type: string;
    };
    expect(body.unregistered).toBe(true);
    expect(body.type).toBe('email');
    expect(body.identifier).toBe('nobody@example.com');
  });

  it('offers a claim link for a registered email whose wallet is not deployed', async () => {
    const token = await createUserWithWallet('alice@example.com');
    await createUser('carol@example.com', '000000');
    await setEmailVerified('carol@example.com');
    const req = createResolveRequest({ recipient: 'carol@example.com' }, token);
    const res = await POST(req);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { unregistered: boolean; type: string };
    expect(body.unregistered).toBe(true);
    expect(body.type).toBe('email');
  });

  it('returns 400 when recipient is missing', async () => {
    const token = await createUserWithWallet('alice@example.com');
    const req = createResolveRequest({}, token);
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 for a malformed recipient', async () => {
    const token = await createUserWithWallet('alice@example.com');
    const req = createResolveRequest({ recipient: 'hello world' }, token);
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Enter a valid username, phone number, email, or Stellar address.');
  });
});

/**
 * Rate limiting (issue #36).
 *
 * This route spends no fee-payer funds, so its limit is deliberately much
 * looser than the submission routes'. It is limited at all because since #110
 * it answers for emails, phones and usernames, so its 200-vs-404 tells a
 * caller with a session whether an identifier belongs to a registered account.
 */
describe('POST /api/wallet/resolve rate limiting', () => {
  it('returns 429 once the per-user resolve limit is exceeded', async () => {
    vi.stubEnv('RATE_LIMIT_RESOLVE_PER_USER_PER_MINUTE', '2');
    const token = await createUserWithWallet('alice@example.com', 'alice');

    expect((await POST(createResolveRequest({ recipient: '@alice' }, token))).status).toBe(200);
    expect((await POST(createResolveRequest({ recipient: '@alice' }, token))).status).toBe(200);

    const res = await POST(createResolveRequest({ recipient: '@alice' }, token));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
  });

  it('returns 429 once the per-IP resolve limit is exceeded', async () => {
    vi.stubEnv('RATE_LIMIT_RESOLVE_PER_USER_PER_MINUTE', '50');
    vi.stubEnv('RATE_LIMIT_RESOLVE_PER_IP_PER_MINUTE', '1');
    const token = await createUserWithWallet('alice@example.com', 'alice');
    const ip = { 'x-forwarded-for': '203.0.113.9' };

    expect(
      (await POST(createResolveRequest({ recipient: '@alice' }, token, ip))).status
    ).toBe(200);
    expect(
      (
        await POST(
          createResolveRequest({ recipient: '@alice' }, token, {
            'x-forwarded-for': '1.2.3.4, 203.0.113.9',
          })
        )
      ).status
    ).toBe(429);
  });

  it('is looser than the fee-payer routes at the default settings', async () => {
    // A tight fee-payer budget must not make the send screen's recipient
    // lookup stop working.
    vi.stubEnv('RATE_LIMIT_FEE_PAYER_PER_USER_PER_MINUTE', '1');
    const token = await createUserWithWallet('alice@example.com', 'alice');

    for (let i = 0; i < 12; i += 1) {
      const res = await POST(createResolveRequest({ recipient: '@alice' }, token));
      expect(res.status, `lookup ${i + 1}`).toBe(200);
    }
  });

  it('does not charge a lookup that never happened', async () => {
    vi.stubEnv('RATE_LIMIT_RESOLVE_PER_USER_PER_MINUTE', '1');
    const token = await createUserWithWallet('alice@example.com', 'alice');

    // Rejected by format validation before any directory read.
    expect(
      (await POST(createResolveRequest({ recipient: 'hello world' }, token))).status
    ).toBe(400);
    expect((await POST(createResolveRequest({}, token))).status).toBe(400);

    expect((await POST(createResolveRequest({ recipient: '@alice' }, token))).status).toBe(200);
  });
});
