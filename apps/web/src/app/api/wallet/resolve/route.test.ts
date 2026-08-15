import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

let dataDir: string;
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
  dataDir = mkdtempSync(join(tmpdir(), 'pocketlet-resolve-'));
  process.env.POCKETLET_DATA_DIR = dataDir;
  cookieJar = {};
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.POCKETLET_DATA_DIR;
  vi.clearAllMocks();
});

async function createUserWithWallet(email: string, username?: string, phone?: string) {
  createUser(email, '000000');
  setEmailVerified(email);
  setCredential(email, {
    id: 'cred-id',
    publicKey: 'base64-pubkey',
    counter: 0,
  });
  setWallet(email, {
    contractId: 'CRECIPIENT',
    stellarAddress: 'GCHCVLYHMRISIGAYR6HA6LNNMD5OTLLUFKIEZMXEZ4ZPM27SAK5TI46P',
  });
  if (username || phone) {
    setProfile(email, { username, phone });
  }
  return createSessionToken({ email });
}

function createResolveRequest(body: unknown, token?: string) {
  if (token) {
    cookieJar[SESSION_COOKIE_NAME] = token;
  }
  return new NextRequest('http://localhost/api/wallet/resolve', {
    method: 'POST',
    body: JSON.stringify(body),
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

  it('returns 400 when recipient is missing', async () => {
    const token = await createUserWithWallet('alice@example.com');
    const req = createResolveRequest({}, token);
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
