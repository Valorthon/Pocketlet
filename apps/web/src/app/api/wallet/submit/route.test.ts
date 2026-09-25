import {
  describe,
  it,
  expect,
  afterEach,
  beforeEach,
  vi,
} from 'vitest';
import { NextRequest } from 'next/server';
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
  cookieJar = {};
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
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

function createSubmitRequest(
  body: unknown,
  token?: string,
  headers?: Record<string, string>
) {
  if (token) {
    cookieJar[SESSION_COOKIE_NAME] = token;
  }
  return new NextRequest('http://localhost/api/wallet/submit', {
    method: 'POST',
    body: JSON.stringify(body),
    headers,
  });
}

async function createUserWithWallet(
  walletContractId: string,
  email = 'alice@example.com'
) {
  await createUser(email, '000000');
  await setEmailVerified(email);
  await setWallet(email, {
    walletContractId,
    stellarAddress: walletContractId,
    primaryPasskeyKeyId: 'test-key-id',
  });
  return createSessionToken({ email });
}

describe('POST /api/wallet/submit', () => {
  it('returns 401 without a session cookie', async () => {
    const req = createSubmitRequest({ signedXdr: 'AAAA...' });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it('returns 404 if wallet is not deployed', async () => {
    await createUser('alice@example.com', '000000');
    await setEmailVerified('alice@example.com');
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

/**
 * Rate limiting (issue #36).
 *
 * `api/wallet/submit` stands in for the nine routes that reach
 * `submitSignedTransaction`; they all call the same
 * `enforceFeePayerRateLimit` helper with their own route name. The generic
 * behaviour of the limiter lives in `src/lib/rate-limit.test.ts`; what is
 * tested here is that the route actually charges it, and charges it in the
 * right place.
 */
describe('POST /api/wallet/submit rate limiting', () => {
  /** A request the handler will accept all the way to the fee payer. */
  function validSubmit(token: string, headers?: Record<string, string>) {
    return createSubmitRequest(
      { signedXdr: buildInvokeXdr([buildAddressAuthEntry(WALLET_CONTRACT)]) },
      token,
      headers
    );
  }

  it('returns 429 once the per-user limit is exceeded', async () => {
    vi.stubEnv('RATE_LIMIT_FEE_PAYER_PER_USER_PER_MINUTE', '2');
    const token = await createUserWithWallet(WALLET_CONTRACT);

    expect((await POST(validSubmit(token))).status).toBe(200);
    expect((await POST(validSubmit(token))).status).toBe(200);

    const res = await POST(validSubmit(token));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Too many requests');
  });

  it('returns 429 once the per-IP limit is exceeded, across accounts', async () => {
    // Loose per-user limits so it can only be the IP bucket that trips.
    vi.stubEnv('RATE_LIMIT_FEE_PAYER_PER_USER_PER_MINUTE', '50');
    vi.stubEnv('RATE_LIMIT_FEE_PAYER_PER_IP_PER_MINUTE', '2');
    const alice = await createUserWithWallet(WALLET_CONTRACT);
    const bob = await createUserWithWallet(WALLET_CONTRACT, 'bob@example.com');
    const ip = { 'x-forwarded-for': '203.0.113.9' };

    expect((await POST(validSubmit(alice, ip))).status).toBe(200);
    expect((await POST(validSubmit(alice, ip))).status).toBe(200);

    // A different account behind the same address, still refused.
    expect((await POST(validSubmit(bob, ip))).status).toBe(429);

    // ...and the same account from a different address is not.
    expect(
      (await POST(validSubmit(bob, { 'x-forwarded-for': '198.51.100.7' })))
        .status
    ).toBe(200);
  });

  it('keys the IP bucket on the rightmost X-Forwarded-For entry, so a spoofed prefix mints nothing', async () => {
    // The one that matters. Railway appends the real peer address, so a client
    // controls everything to the LEFT of it. Reading split(',')[0] would give
    // this caller a fresh bucket on every request and no limit at all.
    vi.stubEnv('RATE_LIMIT_FEE_PAYER_PER_USER_PER_MINUTE', '50');
    vi.stubEnv('RATE_LIMIT_FEE_PAYER_PER_IP_PER_MINUTE', '1');
    const token = await createUserWithWallet(WALLET_CONTRACT);

    const first = await POST(
      validSubmit(token, { 'x-forwarded-for': '203.0.113.9' })
    );
    expect(first.status).toBe(200);

    const spoofed = await POST(
      validSubmit(token, { 'x-forwarded-for': '1.2.3.4, 203.0.113.9' })
    );
    expect(spoofed.status).toBe(429);

    const longerSpoof = await POST(
      validSubmit(token, {
        'x-forwarded-for': '9.9.9.9, 8.8.8.8, 7.7.7.7, 203.0.113.9',
      })
    );
    expect(longerSpoof.status).toBe(429);

    // A genuinely different peer address is a genuinely different bucket —
    // otherwise the test above would pass against a limiter keyed on a
    // constant.
    const elsewhere = await POST(
      validSubmit(token, { 'x-forwarded-for': '1.2.3.4, 198.51.100.7' })
    );
    expect(elsewhere.status).toBe(200);
  });

  it('does not charge the budget for requests rejected before the fee payer', async () => {
    vi.stubEnv('RATE_LIMIT_FEE_PAYER_PER_USER_PER_MINUTE', '1');
    const token = await createUserWithWallet(WALLET_CONTRACT);

    // Cheap failures: bad JSON body, bad XDR, wrong wallet, no auth entries.
    expect((await POST(createSubmitRequest({}, token))).status).toBe(400);
    expect(
      (await POST(createSubmitRequest({ signedXdr: 'nope' }, token))).status
    ).toBe(500);
    expect(
      (
        await POST(
          createSubmitRequest(
            { signedXdr: buildInvokeXdr([buildAddressAuthEntry(OTHER_CONTRACT)]) },
            token
          )
        )
      ).status
    ).toBe(403);
    expect(
      (await POST(createSubmitRequest({ signedXdr: buildInvokeXdr([]) }, token)))
        .status
    ).toBe(400);

    // The single expensive request the user is entitled to still goes through.
    expect((await POST(validSubmit(token))).status).toBe(200);
  });

  it('lets the caller through again once the window has passed', async () => {
    vi.stubEnv('RATE_LIMIT_FEE_PAYER_PER_USER_PER_MINUTE', '1');

    // Only Date is faked: the limiter reads the clock through Date.now(), and
    // faking the timer queue as well would stall the database driver.
    const base = Date.now();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(base);

    const token = await createUserWithWallet(WALLET_CONTRACT);

    expect((await POST(validSubmit(token))).status).toBe(200);
    expect((await POST(validSubmit(token))).status).toBe(429);

    vi.setSystemTime(base + 60_001);
    expect((await POST(validSubmit(token))).status).toBe(200);
  });
});
