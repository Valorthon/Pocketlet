import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { createUser, setEmailVerified, setWallet, getUserByEmail } from '@/lib/auth/store';
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

vi.mock('@simplewebauthn/server', () => ({
  verifyRegistrationResponse: vi.fn().mockResolvedValue({
    verified: true,
    registrationInfo: {
      credential: {
        id: 'backup-key-id',
        publicKey: Buffer.from('backup-public-key'),
        counter: 0,
        transports: [],
      },
    },
  }),
}));

beforeEach(() => {
  cookieJar = {};
});

function createBackupRequest(body: unknown, token?: string) {
  if (token) {
    cookieJar[SESSION_COOKIE_NAME] = token;
  }
  return new NextRequest('http://localhost/api/wallet/backup-passkey', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/wallet/backup-passkey', () => {
  it('returns 401 without a session cookie', async () => {
    const req = createBackupRequest({
      keyIdBase64: 'backup-key-id',
      response: { id: 'backup-key-id' },
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('records a backup passkey', async () => {
    await createUser('alice@example.com', '000000');
    await setEmailVerified('alice@example.com');
    await setWallet('alice@example.com', {
      walletContractId: 'CD4YJ2YQFJFMYF5E5LXGJZW2CWALN6VBPQSVLY2BJUEP4XNIPQHVJVDM',
      stellarAddress: 'CD4YJ2YQFJFMYF5E5LXGJZW2CWALN6VBPQSVLY2BJUEP4XNIPQHVJVDM',
      primaryPasskeyKeyId: 'test-key-id',
    });
    const token = await createSessionToken({ email: 'alice@example.com' });

    const req = createBackupRequest(
      {
        keyIdBase64: 'backup-key-id',
        response: { id: 'backup-key-id' },
      },
      token
    );
    const res = await POST(req);
    expect(res.status).toBe(200);

    const user = await getUserByEmail('alice@example.com');
    expect(user?.hasBackupPasskey).toBe(true);
    expect(user?.backupCredential?.id).toBe('backup-key-id');
  });

  it('rejects a missing keyIdBase64', async () => {
    await createUser('bob@example.com', '000000');
    await setEmailVerified('bob@example.com');
    await setWallet('bob@example.com', {
      walletContractId: 'CD4YJ2YQFJFMYF5E5LXGJZW2CWALN6VBPQSVLY2BJUEP4XNIPQHVJVDM',
      stellarAddress: 'CD4YJ2YQFJFMYF5E5LXGJZW2CWALN6VBPQSVLY2BJUEP4XNIPQHVJVDM',
      primaryPasskeyKeyId: 'test-key-id',
    });
    const token = await createSessionToken({ email: 'bob@example.com' });

    const req = createBackupRequest({}, token);
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
