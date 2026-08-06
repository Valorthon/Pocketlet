import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
  getUserByEmail,
} from '@/lib/auth/store';
import { keyStorage } from '@/lib/wallet/keys';

let dataDir: string;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'pocketlet-recovery-'));
  process.env.POCKETLET_DATA_DIR = dataDir;
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.POCKETLET_DATA_DIR;
});

function createEligibleUser(email: string) {
  createUser(email, '000000');
  setEmailVerified(email);
  setCredential(email, {
    id: 'cred-id',
    publicKey: 'base64-pubkey',
    counter: 0,
  });
  setWallet(email, {
    contractId: 'CABC',
    stellarAddress: 'CABC',
  });
  keyStorage.store(email, 'SABC');
}

describe('POST /api/auth/recovery/initiate', () => {
  it('returns a recovery code for an eligible user', async () => {
    createEligibleUser('user@example.com');
    const req = new NextRequest('http://localhost/api/auth/recovery/initiate', {
      method: 'POST',
      body: JSON.stringify({ email: 'user@example.com' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { code: string; email: string };
    expect(body.email).toBe('user@example.com');
    expect(body.code).toMatch(/^\d{6}$/);
    const user = getUserByEmail('user@example.com');
    expect(user?.recoveryCode).toBe(body.code);
  });

  it('rejects invalid email', async () => {
    const req = new NextRequest('http://localhost/api/auth/recovery/initiate', {
      method: 'POST',
      body: JSON.stringify({ email: 'not-an-email' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 404 for unregistered email', async () => {
    const req = new NextRequest('http://localhost/api/auth/recovery/initiate', {
      method: 'POST',
      body: JSON.stringify({ email: 'unknown@example.com' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it('returns 404 for a user without a credential or wallet', async () => {
    createUser('partial@example.com', '000000');
    setEmailVerified('partial@example.com');
    const req = new NextRequest('http://localhost/api/auth/recovery/initiate', {
      method: 'POST',
      body: JSON.stringify({ email: 'partial@example.com' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it('rate-limits rapid initiations', async () => {
    createEligibleUser('rapid@example.com');
    const req1 = new NextRequest('http://localhost/api/auth/recovery/initiate', {
      method: 'POST',
      body: JSON.stringify({ email: 'rapid@example.com' }),
    });
    await POST(req1);
    const req2 = new NextRequest('http://localhost/api/auth/recovery/initiate', {
      method: 'POST',
      body: JSON.stringify({ email: 'rapid@example.com' }),
    });
    const res2 = await POST(req2);
    expect(res2.status).toBe(429);
  });
});
