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
  setPin,
  setProfile,
} from '@/lib/auth/store';
import { createSessionToken } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/config';
import { keyStorage } from '@/lib/wallet/keys';

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

vi.mock('@/lib/wallet/invoke', () => ({
  invokeWalletContract: vi.fn().mockResolvedValue({ hash: 'test-hash-123' }),
  amountToBaseUnits: vi.fn().mockReturnValue('10000000'),
  i128ScVal: vi.fn().mockReturnValue('i128'),
  addressScVal: vi.fn().mockReturnValue('address'),
}));

vi.mock('@/lib/wallet/deploy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/wallet/deploy')>();
  return {
    ...actual,
    getTokenBalance: vi.fn().mockResolvedValue(BigInt('100000000')),
  };
});

const SENDER_ADDRESS = 'GCCUPAD2H2RHIQMAPPY6RPLOVCAU5MY5BA43UPKU2UGB4AIEPJSXDDGI';
const RECIPIENT_ADDRESS = 'GCHCVLYHMRISIGAYR6HA6LNNMD5OTLLUFKIEZMXEZ4ZPM27SAK5TI46P';

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'pocketlet-transfer-'));
  process.env.POCKETLET_DATA_DIR = dataDir;
  cookieJar = {};
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.POCKETLET_DATA_DIR;
  vi.clearAllMocks();
});

async function createSender(email: string) {
  createUser(email, '000000');
  setEmailVerified(email);
  setCredential(email, {
    id: 'cred-id',
    publicKey: 'base64-pubkey',
    counter: 0,
  });
  setWallet(email, {
    contractId: 'CSENDER',
    stellarAddress: SENDER_ADDRESS,
  });
  keyStorage.store(email, 'SSENDER');
  setPin(email, '123456');
  return createSessionToken({ email });
}

async function createRecipient(email: string, username?: string, phone?: string) {
  createUser(email, '000000');
  setEmailVerified(email);
  setCredential(email, {
    id: 'cred-id-2',
    publicKey: 'base64-pubkey-2',
    counter: 0,
  });
  setWallet(email, {
    contractId: 'CRECIPIENT',
    stellarAddress: RECIPIENT_ADDRESS,
  });
  keyStorage.store(email, 'SRECIPIENT');
  if (username || phone) {
    setProfile(email, { username, phone });
  }
}

function createTransferRequest(body: unknown, token?: string) {
  if (token) {
    cookieJar[SESSION_COOKIE_NAME] = token;
  }
  return new NextRequest('http://localhost/api/wallet/transfer', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/wallet/transfer', () => {
  it('returns 401 without a session cookie', async () => {
    const req = createTransferRequest({
      asset: 'USDC',
      amount: '1',
      recipient: RECIPIENT_ADDRESS,
      pin: '123456',
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('transfers to a raw Stellar address', async () => {
    const token = await createSender('alice@example.com');
    const req = createTransferRequest(
      {
        asset: 'USDC',
        amount: '1',
        recipient: RECIPIENT_ADDRESS,
        pin: '123456',
      },
      token
    );
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hash: string };
    expect(body.hash).toBe('test-hash-123');
  });

  it('resolves a username to a Stellar address', async () => {
    const token = await createSender('alice@example.com');
    await createRecipient('bob@example.com', 'bob_user');

    const req = createTransferRequest(
      {
        asset: 'XLM',
        amount: '2',
        recipient: '@bob_user',
        pin: '123456',
      },
      token
    );
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hash: string };
    expect(body.hash).toBe('test-hash-123');
  });

  it('resolves a phone number to a Stellar address', async () => {
    const token = await createSender('alice@example.com');
    await createRecipient('bob@example.com', undefined, '+639123456789');

    const req = createTransferRequest(
      {
        asset: 'USDC',
        amount: '0.5',
        recipient: '+63 912 345 6789',
        pin: '123456',
      },
      token
    );
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hash: string };
    expect(body.hash).toBe('test-hash-123');
  });

  it('returns 404 for an unknown recipient', async () => {
    const token = await createSender('alice@example.com');
    const req = createTransferRequest(
      {
        asset: 'USDC',
        amount: '1',
        recipient: '@unknown_user',
        pin: '123456',
      },
      token
    );
    const res = await POST(req);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Recipient not found');
  });

  it('returns 404 when the resolved user has no wallet', async () => {
    const token = await createSender('alice@example.com');
    createUser('bob@example.com', '000000');
    setProfile('bob@example.com', { username: 'nowallet' });

    const req = createTransferRequest(
      {
        asset: 'USDC',
        amount: '1',
        recipient: '@nowallet',
        pin: '123456',
      },
      token
    );
    const res = await POST(req);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Recipient not found');
  });

  it('returns 401 for an invalid PIN', async () => {
    const token = await createSender('alice@example.com');
    const req = createTransferRequest(
      {
        asset: 'USDC',
        amount: '1',
        recipient: RECIPIENT_ADDRESS,
        pin: '000000',
      },
      token
    );
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Invalid PIN');
  });

  it('returns 400 for an invalid amount', async () => {
    const token = await createSender('alice@example.com');
    const req = createTransferRequest(
      {
        asset: 'USDC',
        amount: '-1',
        recipient: RECIPIENT_ADDRESS,
        pin: '123456',
      },
      token
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
