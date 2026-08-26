import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import {
  createUser,
  setEmailVerified,
  setCredential,
  setWallet,
  setRecoveryPublicKey,
  getUserByEmail,
} from '@/lib/auth/store';

function createRequest(body: unknown) {
  return new NextRequest('http://localhost/api/auth/recovery/initiate', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function makeRecoverableUser(email: string) {
  await createUser(email, '000000');
  await setEmailVerified(email);
  await setCredential(email, {
    id: 'primary-key-id',
    publicKey: 'cHVibGljLWtleQ',
    counter: 0,
  });
  await setWallet(email, {
    walletContractId: 'CD4YJ2YQFJFMYF5E5LXGJZW2CWALN6VBPQSVLY2BJUEP4XNIPQHVJVDM',
    stellarAddress: 'CD4YJ2YQFJFMYF5E5LXGJZW2CWALN6VBPQSVLY2BJUEP4XNIPQHVJVDM',
    primaryPasskeyKeyId: 'primary-key-id',
  });
  await setRecoveryPublicKey(email, 'GDDOY5WE2IDQMJS4HIASB5G7GFXMGQ4O4YYT46QETSWAC65JIFBB25KP');
}

describe('POST /api/auth/recovery/initiate', () => {
  it('returns 400 for an invalid email', async () => {
    const req = createRequest({ email: 'not-an-email' });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unrecoverable account', async () => {
    await createUser('alice@example.com', '000000');
    await setEmailVerified('alice@example.com');
    const req = createRequest({ email: 'alice@example.com' });
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it('generates a recovery code for a recoverable account', async () => {
    await makeRecoverableUser('alice@example.com');
    const req = createRequest({ email: 'alice@example.com' });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { email: string; code: string };
    expect(body.email).toBe('alice@example.com');
    expect(body.code).toMatch(/^\d{6}$/);

    const user = await getUserByEmail('alice@example.com');
    expect(user?.recoveryCode).toBe(body.code);
    expect(user?.recoveryInitiatedAt).toBeDefined();
  });

  it('rate-limits rapid initiations', async () => {
    await makeRecoverableUser('alice@example.com');
    await POST(createRequest({ email: 'alice@example.com' }));
    const res = await POST(createRequest({ email: 'alice@example.com' }));
    expect(res.status).toBe(429);
  });

  it('enforces the hourly initiation cap', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await makeRecoverableUser('alice@example.com');

    // 5 initiations within an hour should succeed.
    for (let i = 0; i < 5; i += 1) {
      if (i > 0) {
        vi.advanceTimersByTime(2 * 60 * 1000); // advance past the 1-minute retry window
      }
      const res = await POST(createRequest({ email: 'alice@example.com' }));
      expect(res.status).toBe(200);
    }

    // A 6th initiation within the same hour is blocked.
    vi.advanceTimersByTime(2 * 60 * 1000);
    const res = await POST(createRequest({ email: 'alice@example.com' }));
    expect(res.status).toBe(429);

    vi.useRealTimers();
  });
});
