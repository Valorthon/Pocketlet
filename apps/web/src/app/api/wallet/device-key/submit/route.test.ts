import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  Account,
  Address,
  Keypair,
  Operation,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import { POST } from './route';
import {
  createUser,
  setEmailVerified,
  setCredential,
  setWallet,
} from '@/lib/auth/store';
import { createSessionToken } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/config';
import { NETWORK_PASSPHRASE } from '@/lib/wallet/network';
import { exhaustFeePayerBudget } from '@/lib/rate-limit.test-support';

let cookieJar: Record<string, string> = {};

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockImplementation(() => ({
    get: (name: string) =>
      cookieJar[name] ? { value: cookieJar[name], name } : undefined,
    set: (name: string, value: string) => {
      cookieJar[name] = value;
    },
  })),
}));

vi.mock('@/lib/wallet/submit', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/wallet/submit')>();
  return {
    ...actual,
    submitSignedTransaction: vi
      .fn()
      .mockResolvedValue({ hash: 'device-key-tx-hash' }),
  };
});

const WALLET_CONTRACT =
  'CA7FMXWUMM3C37O4QF4E4R4KKXZIEBV7CTFHKDRDXPBLZQ2NMC5PZC5G';
const DEVICE_PUBLIC_KEY =
  'GDDOY5WE2IDQMJS4HIASB5G7GFXMGQ4O4YYT46QETSWAC65JIFBB25KP';
const EMAIL = 'alice@example.com';

beforeEach(() => {
  cookieJar = {};
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** The five-element `Ed25519` signer the contract's `add_signer` expects. */
function buildSignerScVal(publicKey: string): xdr.ScVal {
  const rawPublicKey = Keypair.fromPublicKey(publicKey).rawPublicKey();
  const expiration = Math.floor(Date.now() / 1000) + 3600;

  return xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol('Ed25519'),
    xdr.ScVal.scvBytes(rawPublicKey),
    // SignerExpiration(Some(..)) — the route rejects an unbounded device key.
    xdr.ScVal.scvVec([xdr.ScVal.scvU64(new xdr.Uint64(BigInt(expiration)))]),
    // SignerLimits(Some(empty map)) — no contract outside the allow-list.
    xdr.ScVal.scvVec([xdr.ScVal.scvMap([])]),
    // SignerStorage::Temporary — a device key must not be persistent.
    xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Temporary')]),
  ]);
}

function buildAddSignerXdr(publicKey = DEVICE_PUBLIC_KEY): string {
  const op = Operation.invokeHostFunction({
    func: xdr.HostFunction.hostFunctionTypeInvokeContract(
      new xdr.InvokeContractArgs({
        contractAddress: Address.fromString(WALLET_CONTRACT).toScAddress(),
        functionName: 'add_signer',
        args: [buildSignerScVal(publicKey)],
      })
    ),
    auth: [],
  });

  const source = new Account(
    'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    '0'
  );

  return new TransactionBuilder(source, {
    fee: '100000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(op)
    .setTimeout(30)
    .build()
    .toXDR();
}

function createDeviceKeyRequest(body: unknown, token?: string) {
  if (token) {
    cookieJar[SESSION_COOKIE_NAME] = token;
  }
  return new NextRequest('http://localhost/api/wallet/device-key/submit', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function createUserWithWallet(email = EMAIL) {
  await createUser(email, '000000');
  await setEmailVerified(email);
  await setCredential(email, {
    id: 'primary-key-id',
    publicKey: 'cHVibGljLWtleQ',
    counter: 0,
  });
  await setWallet(email, {
    walletContractId: WALLET_CONTRACT,
    stellarAddress: WALLET_CONTRACT,
    primaryPasskeyKeyId: 'primary-key-id',
  });
  return createSessionToken({ email });
}

describe('POST /api/wallet/device-key/submit', () => {
  it('returns 401 without a session cookie', async () => {
    const res = await POST(
      createDeviceKeyRequest({
        signedXdr: buildAddSignerXdr(),
        publicKey: DEVICE_PUBLIC_KEY,
      })
    );
    expect(res.status).toBe(401);
  });

  it('returns 404 when the wallet is not deployed', async () => {
    await createUser(EMAIL, '000000');
    await setEmailVerified(EMAIL);
    const token = await createSessionToken({ email: EMAIL });

    const res = await POST(
      createDeviceKeyRequest(
        { signedXdr: buildAddSignerXdr(), publicKey: DEVICE_PUBLIC_KEY },
        token
      )
    );
    expect(res.status).toBe(404);
  });

  it('submits a well-formed add_signer transaction', async () => {
    const token = await createUserWithWallet();

    const res = await POST(
      createDeviceKeyRequest(
        { signedXdr: buildAddSignerXdr(), publicKey: DEVICE_PUBLIC_KEY },
        token
      )
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { hash: string };
    expect(body.hash).toBe('device-key-tx-hash');
  });
});

/**
 * Rate-limit wiring (issue #36). The limiter itself is tested in
 * `src/lib/rate-limit.test.ts`; this only proves the handler charges it, which
 * nothing else would catch if the call were removed from this route alone.
 */
describe('POST /api/wallet/device-key/submit rate limiting', () => {
  it('returns 429 once the fee-payer budget is spent', async () => {
    const token = await createUserWithWallet();
    await exhaustFeePayerBudget('wallet.device-key.submit', EMAIL);

    const res = await POST(
      createDeviceKeyRequest(
        { signedXdr: buildAddSignerXdr(), publicKey: DEVICE_PUBLIC_KEY },
        token
      )
    );

    expect(res.status).toBe(429);
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
  });
});
