import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Account, Contract, TransactionBuilder } from '@stellar/stellar-sdk';
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
import { getUsdcContractId, getXlmContractId } from '@/lib/wallet/assets';
import { getTokenBalance } from '@/lib/wallet/token';
import { NETWORK_PASSPHRASE } from '@/lib/wallet/network';
import { addressScVal, amountToBaseUnits, i128ScVal } from '@/lib/wallet/amount';

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

vi.mock('@/lib/wallet/submit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/wallet/submit')>();
  return {
    ...actual,
    submitSignedTransaction: vi.fn().mockResolvedValue({ hash: 'test-hash-123' }),
  };
});

vi.mock('@/lib/wallet/token', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/wallet/token')>();
  return {
    ...actual,
    getTokenBalance: vi.fn().mockResolvedValue(BigInt('100000000')),
  };
});

const SENDER_CONTRACT =
  'CA7FMXWUMM3C37O4QF4E4R4KKXZIEBV7CTFHKDRDXPBLZQ2NMC5PZC5G';
const OTHER_CONTRACT =
  'CCTTR6BVBPGWW76HFCRSPQAXZCOC4HKUF5BKK3ZDO7V7B6PIPDKP2BFQ';
const RECIPIENT_ADDRESS =
  'GCHCVLYHMRISIGAYR6HA6LNNMD5OTLLUFKIEZMXEZ4ZPM27SAK5TI46P';
const FEE_PAYER_PUBLIC =
  'GATVJDFPIPADU74ALX4344HEQQZ2LGMNWABPXBOWYMVXM37KMTTUALTU';

function buildTransferXdr(
  tokenContractId: string,
  from: string,
  to: string,
  amount: string
): string {
  const source = new Account(FEE_PAYER_PUBLIC, '0');
  const tokenContract = new Contract(tokenContractId);
  const tx = new TransactionBuilder(source, {
    fee: '100000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      tokenContract.call(
        'transfer',
        addressScVal(from),
        addressScVal(to),
        i128ScVal(amountToBaseUnits(amount))
      )
    )
    .setTimeout(30)
    .build();
  return tx.toXDR();
}

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
    walletContractId: SENDER_CONTRACT,
    stellarAddress: SENDER_CONTRACT,
    primaryPasskeyKeyId: 'cred-id',
  });
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
    walletContractId: 'CRECIPIENT',
    stellarAddress: RECIPIENT_ADDRESS,
    primaryPasskeyKeyId: 'cred-id-2',
  });
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
      signedXdr: buildTransferXdr(getUsdcContractId(), SENDER_CONTRACT, RECIPIENT_ADDRESS, '1'),
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
        signedXdr: buildTransferXdr(
          getUsdcContractId(),
          SENDER_CONTRACT,
          RECIPIENT_ADDRESS,
          '1'
        ),
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
        signedXdr: buildTransferXdr(
          getXlmContractId(),
          SENDER_CONTRACT,
          RECIPIENT_ADDRESS,
          '2'
        ),
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
        signedXdr: buildTransferXdr(
          getUsdcContractId(),
          SENDER_CONTRACT,
          RECIPIENT_ADDRESS,
          '0.5'
        ),
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
        signedXdr: buildTransferXdr(
          getUsdcContractId(),
          SENDER_CONTRACT,
          RECIPIENT_ADDRESS,
          '1'
        ),
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

  it('returns 401 for an invalid PIN', async () => {
    const token = await createSender('alice@example.com');
    const req = createTransferRequest(
      {
        signedXdr: buildTransferXdr(
          getUsdcContractId(),
          SENDER_CONTRACT,
          RECIPIENT_ADDRESS,
          '1'
        ),
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

  it('returns 400 when the signed XDR calls the wrong token contract', async () => {
    const token = await createSender('alice@example.com');
    const wrongContract = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
    const req = createTransferRequest(
      {
        signedXdr: buildTransferXdr(wrongContract, SENDER_CONTRACT, RECIPIENT_ADDRESS, '1'),
        asset: 'XLM',
        amount: '1',
        recipient: RECIPIENT_ADDRESS,
        pin: '123456',
      },
      token
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('wrong token contract');
  });

  it('returns 400 when the signed transfer is from a different wallet', async () => {
    const token = await createSender('alice@example.com');
    const req = createTransferRequest(
      {
        signedXdr: buildTransferXdr(
          getUsdcContractId(),
          OTHER_CONTRACT,
          RECIPIENT_ADDRESS,
          '1'
        ),
        asset: 'USDC',
        amount: '1',
        recipient: RECIPIENT_ADDRESS,
        pin: '123456',
      },
      token
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('not from the user wallet');
  });

  it('returns 400 when the signed amount does not match the request', async () => {
    const token = await createSender('alice@example.com');
    const req = createTransferRequest(
      {
        signedXdr: buildTransferXdr(
          getUsdcContractId(),
          SENDER_CONTRACT,
          RECIPIENT_ADDRESS,
          '2'
        ),
        asset: 'USDC',
        amount: '1',
        recipient: RECIPIENT_ADDRESS,
        pin: '123456',
      },
      token
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('amount does not match');
  });

  it('returns 400 when signedXdr is missing', async () => {
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
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('signedXdr is required');
  });

  it('returns 400 for an unsupported asset', async () => {
    const token = await createSender('alice@example.com');
    const req = createTransferRequest(
      {
        signedXdr: buildTransferXdr(
          getUsdcContractId(),
          SENDER_CONTRACT,
          RECIPIENT_ADDRESS,
          '1'
        ),
        asset: 'BTC',
        amount: '1',
        recipient: RECIPIENT_ADDRESS,
        pin: '123456',
      },
      token
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Asset must be USDC or XLM');
  });

  it('returns 400 for a non-numeric amount', async () => {
    const token = await createSender('alice@example.com');
    const req = createTransferRequest(
      {
        signedXdr: buildTransferXdr(
          getUsdcContractId(),
          SENDER_CONTRACT,
          RECIPIENT_ADDRESS,
          '1'
        ),
        asset: 'USDC',
        amount: 'not-a-number',
        recipient: RECIPIENT_ADDRESS,
        pin: '123456',
      },
      token
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Amount must be a positive number');
  });

  it('returns 400 for an amount with too many decimals', async () => {
    const token = await createSender('alice@example.com');
    const req = createTransferRequest(
      {
        signedXdr: buildTransferXdr(
          getUsdcContractId(),
          SENDER_CONTRACT,
          RECIPIENT_ADDRESS,
          '1'
        ),
        asset: 'USDC',
        amount: '1.12345678',
        recipient: RECIPIENT_ADDRESS,
        pin: '123456',
      },
      token
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Amount cannot have more than 7 decimal places');
  });

  it('returns 400 when the recipient is missing', async () => {
    const token = await createSender('alice@example.com');
    const req = createTransferRequest(
      {
        signedXdr: buildTransferXdr(
          getUsdcContractId(),
          SENDER_CONTRACT,
          RECIPIENT_ADDRESS,
          '1'
        ),
        asset: 'USDC',
        amount: '1',
        pin: '123456',
      },
      token
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Recipient is required');
  });

  it('returns 400 when the balance is insufficient', async () => {
    vi.mocked(getTokenBalance).mockResolvedValueOnce(BigInt('1000000'));
    const token = await createSender('alice@example.com');
    const req = createTransferRequest(
      {
        signedXdr: buildTransferXdr(
          getUsdcContractId(),
          SENDER_CONTRACT,
          RECIPIENT_ADDRESS,
          '5'
        ),
        asset: 'USDC',
        amount: '5',
        recipient: RECIPIENT_ADDRESS,
        pin: '123456',
      },
      token
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Insufficient USDC balance');
  });
});
