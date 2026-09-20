import { describe, it, expect, beforeEach, vi } from 'vitest';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { NextRequest } from 'next/server';
import { POST } from './route';
import {
  createUser,
  setEmailVerified,
  setWallet,
  getUserByEmail,
  setPasskeyChallenge,
} from '@/lib/auth/store';
import { createSessionToken } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/config';

const CHALLENGE = 'test-passkey-challenge';

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

async function seedWalletUser() {
  await createUser('alice@example.com', '000000');
  await setEmailVerified('alice@example.com');
  await setWallet('alice@example.com', {
    walletContractId: 'CD4YJ2YQFJFMYF5E5LXGJZW2CWALN6VBPQSVLY2BJUEP4XNIPQHVJVDM',
    stellarAddress: 'CD4YJ2YQFJFMYF5E5LXGJZW2CWALN6VBPQSVLY2BJUEP4XNIPQHVJVDM',
    primaryPasskeyKeyId: 'test-key-id',
  });
  return createSessionToken({ email: 'alice@example.com' });
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
    await setPasskeyChallenge('alice@example.com', CHALLENGE);
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
  it('rejects the registration when no challenge was issued', async () => {
    const token = await seedWalletUser();
    const req = createBackupRequest(
      { keyIdBase64: 'backup-key-id', response: { id: 'backup-key-id' } },
      token
    );

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('No pending passkey challenge');
  });

  // The replay this issue is about: the same registration response, replayed
  // after the challenge has been spent, must not enrol a second passkey.
  it('rejects a replayed registration response', async () => {
    const token = await seedWalletUser();
    await setPasskeyChallenge('alice@example.com', CHALLENGE);
    const body = {
      keyIdBase64: 'backup-key-id',
      response: { id: 'backup-key-id' },
    };

    const first = await POST(createBackupRequest(body, token));
    expect(first.status).toBe(200);

    const replay = await POST(createBackupRequest(body, token));
    expect(replay.status).toBe(400);
    expect(((await replay.json()) as { error: string }).error).toContain(
      'No pending passkey challenge'
    );
  });

  it('passes the issued challenge to the verifier', async () => {
    const token = await seedWalletUser();
    await setPasskeyChallenge('alice@example.com', CHALLENGE);

    await POST(
      createBackupRequest(
        { keyIdBase64: 'backup-key-id', response: { id: 'backup-key-id' } },
        token
      )
    );

    expect(verifyRegistrationResponse).toHaveBeenCalledWith(
      expect.objectContaining({ expectedChallenge: CHALLENGE })
    );
  });

  it('spends the challenge even when verification fails', async () => {
    const token = await seedWalletUser();
    await setPasskeyChallenge('alice@example.com', CHALLENGE);
    vi.mocked(verifyRegistrationResponse).mockRejectedValueOnce(
      new Error('bad signature')
    );

    const body = {
      keyIdBase64: 'backup-key-id',
      response: { id: 'backup-key-id' },
    };
    expect((await POST(createBackupRequest(body, token))).status).toBe(401);

    const retry = await POST(createBackupRequest(body, token));
    expect(retry.status).toBe(400);
  });
});
