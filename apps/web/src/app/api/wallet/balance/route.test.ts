import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GET } from './route';
import { createUser, setEmailVerified, setWallet } from '@/lib/auth/store';
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

vi.mock('@/lib/wallet/token', () => ({
  getTokenBalance: vi.fn().mockResolvedValue(BigInt('50000000')),
}));

beforeEach(() => {
  cookieJar = {};
});

describe('GET /api/wallet/balance', () => {
  it('returns 401 without a session cookie', async () => {
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns 404 if wallet is not deployed', async () => {
    await createUser('alice@example.com', '000000');
    await setEmailVerified('alice@example.com');
    const token = await createSessionToken({ email: 'alice@example.com' });
    cookieJar[SESSION_COOKIE_NAME] = token;

    const res = await GET();
    expect(res.status).toBe(404);
  });

  it('returns XLM, USDC, contractId, and stellarAddress for a deployed wallet', async () => {
    await createUser('alice@example.com', '000000');
    await setEmailVerified('alice@example.com');
    await setWallet('alice@example.com', {
      walletContractId: 'CD4YJ2YQFJFMYF5E5LXGJZW2CWALN6VBPQSVLY2BJUEP4XNIPQHVJVDM',
      stellarAddress: 'CD4YJ2YQFJFMYF5E5LXGJZW2CWALN6VBPQSVLY2BJUEP4XNIPQHVJVDM',
      primaryPasskeyKeyId: 'test-key-id',
    });
    const token = await createSessionToken({ email: 'alice@example.com' });
    cookieJar[SESSION_COOKIE_NAME] = token;

    const res = await GET();
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      xlm: string;
      usdc: string;
      contractId: string;
      stellarAddress: string;
    };
    expect(body.xlm).toBe('50000000');
    expect(body.usdc).toBe('50000000');
    expect(body.contractId).toBe('CD4YJ2YQFJFMYF5E5LXGJZW2CWALN6VBPQSVLY2BJUEP4XNIPQHVJVDM');
    expect(body.stellarAddress).toBe('CD4YJ2YQFJFMYF5E5LXGJZW2CWALN6VBPQSVLY2BJUEP4XNIPQHVJVDM');
  });
});
