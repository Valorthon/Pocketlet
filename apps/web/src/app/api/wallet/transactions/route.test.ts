import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Address, xdr } from '@stellar/stellar-sdk';
import { GET } from './route';
import { createUser, setEmailVerified, setWallet } from '@/lib/auth/store';
import { createSessionToken } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/config';

let dataDir: string;
let cookieJar: Record<string, string> = {};

const USDC_CONTRACT_ID =
  'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
const WALLET_CONTRACT_ID =
  'CANWB6BIHTG37UGKBXNCFA7X6XD4XSA6FVSP4GVYSWRAQ3LID7LQ52ZG';
const OTHER_ADDRESS =
  'GAEBH5ZALWM4SFBG3XEE7FBGKNPUVX5JT7URH34XHQ6SVRT6IGY4SXAM';

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockImplementation(() => ({
    get: (name: string) =>
      cookieJar[name] ? { value: cookieJar[name], name } : undefined,
    set: (name: string, value: string) => {
      cookieJar[name] = value;
    },
  })),
}));

vi.mock('@/lib/wallet/fee-payer', () => ({
  getFeePayerKeypair: vi.fn().mockReturnValue({
    publicKey: () => 'GCCVPYFOHY7B7M4SCIQRMX2VTZVOB7VDJBJGN4NVBHPQAJLZS4KKJLPO',
  }),
}));

vi.mock('@/lib/wallet/assets', () => ({
  getUsdcContractId: vi.fn().mockReturnValue(
    'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA'
  ),
}));

interface MockOperation {
  hash: string;
  parameters: Array<{ value: string; type: string }>;
  balanceChanges: Array<{
    assetType: string;
    assetCode?: string;
    from: string;
    to: string;
    amount: string;
  }>;
}

function makeAddressParam(address: string): { value: string; type: string } {
  return {
    value: Address.fromString(address).toScVal().toXDR('base64'),
    type: 'Address',
  };
}

function makeSymbolParam(name: string): { value: string; type: string } {
  return {
    value: xdr.ScVal.scvSymbol(name).toXDR('base64'),
    type: 'Sym',
  };
}

function makeTransferParameters(
  token: string,
  from: string,
  to: string
): Array<{ value: string; type: string }> {
  return [
    makeAddressParam(token),
    makeSymbolParam('transfer'),
    makeAddressParam(from),
    makeAddressParam(to),
  ];
}

function makeMockOperation(op: MockOperation) {
  return {
    id: `op-${op.hash}`,
    type: 'invoke_host_function',
    type_i: 24,
    transaction_hash: op.hash,
    transaction_successful: true,
    created_at: '2026-07-20T10:00:00Z',
    source_account: 'GCCVPYFOHY7B7M4SCIQRMX2VTZVOB7VDJBJGN4NVBHPQAJLZS4KKJLPO',
    function: 'HostFunctionTypeHostFunctionTypeInvokeContract',
    parameters: op.parameters,
    address: '',
    salt: '',
    asset_balance_changes: op.balanceChanges.map((change) => ({
      asset_type: change.assetType,
      asset_code: change.assetCode,
      type: 'transfer',
      from: change.from,
      to: change.to,
      amount: change.amount,
    })),
  };
}

const mockTransactions = [
  {
    hash: 'tx-send',
    successful: true,
    created_at: '2026-07-20T10:00:00Z',
    ledger_attr: 12345,
    fee_charged: '100',
    source_account: 'GCCVPYFOHY7B7M4SCIQRMX2VTZVOB7VDJBJGN4NVBHPQAJLZS4KKJLPO',
    memo_type: 'none',
    memo: '',
  },
  {
    hash: 'tx-admin',
    successful: true,
    created_at: '2026-07-20T10:01:00Z',
    ledger_attr: 12346,
    fee_charged: '100',
    source_account: 'GCCVPYFOHY7B7M4SCIQRMX2VTZVOB7VDJBJGN4NVBHPQAJLZS4KKJLPO',
    memo_type: 'none',
    memo: '',
  },
];

const mockOperations: Record<string, unknown[]> = {
  'tx-send': [
    makeMockOperation({
      hash: 'tx-send',
      parameters: makeTransferParameters(
        USDC_CONTRACT_ID,
        WALLET_CONTRACT_ID,
        OTHER_ADDRESS
      ),
      balanceChanges: [
        {
          assetType: 'credit_alphanum4',
          assetCode: 'USDC',
          from: WALLET_CONTRACT_ID,
          to: OTHER_ADDRESS,
          amount: '2.5000000',
        },
      ],
    }),
  ],
  'tx-admin': [
    makeMockOperation({
      hash: 'tx-admin',
      parameters: makeTransferParameters(
        USDC_CONTRACT_ID,
        OTHER_ADDRESS,
        'GAEBH5ZALWM4SFBG3XEE7FBGKNPUVX5JT7URH34XHQ6SVRT6IGY4SXAM'
      ).map((p, idx) => (idx === 1 ? makeSymbolParam('set_owner') : p)),
      balanceChanges: [],
    }),
  ],
};

vi.mock('@stellar/stellar-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@stellar/stellar-sdk')>();
  return {
    ...actual,
    Horizon: {
      Server: vi.fn().mockImplementation(function () {
        return {
          transactions: vi.fn().mockReturnValue({
            forAccount: vi.fn().mockReturnValue({
              order: vi.fn().mockReturnValue({
                limit: vi.fn().mockReturnValue({
                  call: vi.fn().mockResolvedValue({ records: mockTransactions }),
                }),
              }),
            }),
          }),
          operations: vi.fn().mockReturnValue({
            forTransaction: vi.fn().mockImplementation((hash: string) => ({
              call: vi.fn().mockResolvedValue({
                records: mockOperations[hash] ?? [],
              }),
            })),
          }),
        };
      }),
    },
  };
});

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'pocketlet-transactions-'));
  process.env.POCKETLET_DATA_DIR = dataDir;
  cookieJar = {};
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  delete process.env.POCKETLET_DATA_DIR;
  vi.clearAllMocks();
});

async function createSession(): Promise<string> {
  createUser('alice@example.com', '000000');
  setEmailVerified('alice@example.com');
  setWallet('alice@example.com', {
    walletContractId: WALLET_CONTRACT_ID,
    stellarAddress: WALLET_CONTRACT_ID,
    primaryPasskeyKeyId: 'test-key-id',
  });
  return createSessionToken({ email: 'alice@example.com' });
}

describe('GET /api/wallet/transactions', () => {
  it('returns 401 without a session cookie', async () => {
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns 404 if wallet is not deployed', async () => {
    createUser('alice@example.com', '000000');
    setEmailVerified('alice@example.com');
    const token = await createSessionToken({ email: 'alice@example.com' });
    cookieJar[SESSION_COOKIE_NAME] = token;

    const res = await GET();
    expect(res.status).toBe(404);
  });

  it('queries the fee payer and returns only transactions involving the wallet', async () => {
    const token = await createSession();
    cookieJar[SESSION_COOKIE_NAME] = token;

    const res = await GET();
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      transactions: Array<{ hash: string; type: string }>;
    };
    expect(body.transactions).toHaveLength(1);
    expect(body.transactions[0].hash).toBe('tx-send');
    expect(body.transactions[0].type).toBe('send');
  });
});
