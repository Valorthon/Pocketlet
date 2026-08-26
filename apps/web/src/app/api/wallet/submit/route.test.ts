import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import { NextRequest } from 'next/server';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Account,
  Address,
  Operation,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import { POST } from './route';
import { createUser, setEmailVerified, setWallet } from '@/lib/auth/store';
import { createSessionToken } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/config';
import { NETWORK_PASSPHRASE } from '@/lib/wallet/network';

let dataDir: string;
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
      .mockResolvedValue({ hash: 'submitted-tx-hash' }),
  };
});

const WALLET_CONTRACT =
  'CA7FMXWUMM3C37O4QF4E4R4KKXZIEBV7CTFHKDRDXPBLZQ2NMC5PZC5G';
const OTHER_CONTRACT =
  'CCTTR6BVBPGWW76HFCRSPQAXZCOC4HKUF5BKK3ZDO7V7B6PIPDKP2BFQ';

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'pocketlet-submit-'));
  process.env.POCKETLET_DATA_DIR = dataDir;
  cookieJar = {};
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.POCKETLET_DATA_DIR;
  vi.clearAllMocks();
});

function buildAddressAuthEntry(address: string): xdr.SorobanAuthorizationEntry {
  const authorizedFunction =
    xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: Address.fromString(
          'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA'
        ).toScAddress(),
        functionName: 'transfer',
        args: [],
      })
    );

  const credentials = xdr.SorobanCredentials.sorobanCredentialsAddress(
    new xdr.SorobanAddressCredentials({
      address: Address.fromString(address).toScAddress(),
      nonce: xdr.Int64.fromString('0'),
      signatureExpirationLedger: 0,
      signature: xdr.ScVal.scvVoid(),
    })
  );

  return new xdr.SorobanAuthorizationEntry({
    credentials,
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: authorizedFunction,
      subInvocations: [],
    }),
  });
}

function buildSourceAccountAuthEntry(): xdr.SorobanAuthorizationEntry {
  const authorizedFunction =
    xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: Address.fromString(
          'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA'
        ).toScAddress(),
        functionName: 'transfer',
        args: [],
      })
    );

  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: authorizedFunction,
      subInvocations: [],
    }),
  });
}

function buildInvokeXdr(auth: xdr.SorobanAuthorizationEntry[]): string {
  const op = Operation.invokeHostFunction({
    func: xdr.HostFunction.hostFunctionTypeInvokeContract(
      new xdr.InvokeContractArgs({
        contractAddress: Address.fromString(
          'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA'
        ).toScAddress(),
        functionName: 'transfer',
        args: [],
      })
    ),
    auth,
  });

  const source = new Account(
    'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
    '0'
  );
  const tx = new TransactionBuilder(source, {
    fee: '100000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(op)
    .setTimeout(30)
    .build();

  return tx.toXDR();
}

function createSubmitRequest(body: unknown, token?: string) {
  if (token) {
    cookieJar[SESSION_COOKIE_NAME] = token;
  }
  return new NextRequest('http://localhost/api/wallet/submit', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

async function createUserWithWallet(walletContractId: string) {
  createUser('alice@example.com', '000000');
  setEmailVerified('alice@example.com');
  setWallet('alice@example.com', {
    walletContractId,
    stellarAddress: walletContractId,
    primaryPasskeyKeyId: 'test-key-id',
  });
  return createSessionToken({ email: 'alice@example.com' });
}

describe('POST /api/wallet/submit', () => {
  it('returns 401 without a session cookie', async () => {
    const req = createSubmitRequest({ signedXdr: 'AAAA...' });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 404 if wallet is not deployed', async () => {
    createUser('alice@example.com', '000000');
    setEmailVerified('alice@example.com');
    const token = await createSessionToken({ email: 'alice@example.com' });

    const req = createSubmitRequest({ signedXdr: 'AAAA...' }, token);
    const res = await POST(req);
    expect(res.status).toBe(404);
  });

  it('returns 500 for a malformed XDR', async () => {
    const token = await createUserWithWallet(WALLET_CONTRACT);

    const req = createSubmitRequest({ signedXdr: 'not-valid-xdr' }, token);
    const res = await POST(req);
    expect(res.status).toBe(500);
  });

  it('returns 400 for source-account authorization', async () => {
    const token = await createUserWithWallet(WALLET_CONTRACT);
    const signedXdr = buildInvokeXdr([buildSourceAccountAuthEntry()]);

    const req = createSubmitRequest({ signedXdr }, token);
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Source-account authorization');
  });

  it('returns 400 when there are no wallet auth entries', async () => {
    const token = await createUserWithWallet(WALLET_CONTRACT);
    const signedXdr = buildInvokeXdr([]);

    const req = createSubmitRequest({ signedXdr }, token);
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('No wallet authorization entries');
  });

  it('returns 403 when auth entries are for a different wallet', async () => {
    const token = await createUserWithWallet(WALLET_CONTRACT);
    const signedXdr = buildInvokeXdr([buildAddressAuthEntry(OTHER_CONTRACT)]);

    const req = createSubmitRequest({ signedXdr }, token);
    const res = await POST(req);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('not for this wallet');
  });

  it('submits a transaction with auth entries for the user wallet', async () => {
    const token = await createUserWithWallet(WALLET_CONTRACT);
    const signedXdr = buildInvokeXdr([buildAddressAuthEntry(WALLET_CONTRACT)]);

    const req = createSubmitRequest({ signedXdr }, token);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hash: string };
    expect(body.hash).toBe('submitted-tx-hash');
  });
});
