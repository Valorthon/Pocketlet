import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  Account,
  Address,
  Transaction,
  rpc,
  xdr,
  nativeToScVal,
  SorobanDataBuilder,
} from '@stellar/stellar-sdk';
import {
  prepareEscrowDepositTx,
  prepareEscrowClaimTx,
  prepareEscrowRefundTx,
  prepareEscrowGetDepositTx,
} from './escrow';

const ESCROW_CONTRACT_ID =
  'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
const PUBLIC_KEY =
  'GATVJDFPIPADU74ALX4344HEQQZ2LGMNWABPXBOWYMVXM37KMTTUALTU';
const TOKEN_CONTRACT_ID =
  'CA7FMXWUMM3C37O4QF4E4R4KKXZIEBV7CTFHKDRDXPBLZQ2NMC5PZC5G';

beforeEach(() => {
  process.env.NEXT_PUBLIC_ESCROW_CONTRACT_ID = ESCROW_CONTRACT_ID;
});

afterEach(() => {
  delete process.env.NEXT_PUBLIC_ESCROW_CONTRACT_ID;
  vi.restoreAllMocks();
});

function buildSuccessSimulation(): rpc.Api.SimulateTransactionSuccessResponse {
  return {
    id: 'sim-id',
    latestLedger: 100,
    _parsed: true,
    events: [],
    transactionData: new SorobanDataBuilder(),
    minResourceFee: '1000',
    result: {
      auth: [],
      retval: xdr.ScVal.scvVoid(),
    },
  } as unknown as rpc.Api.SimulateTransactionSuccessResponse;
}

function buildDepositScVal(): xdr.ScVal {
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('sender'),
      val: new Address(PUBLIC_KEY).toScVal(),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('token'),
      val: new Address(TOKEN_CONTRACT_ID).toScVal(),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('amount'),
      val: xdr.ScVal.scvI128(
        new xdr.Int128Parts({
          hi: xdr.Int64.fromString('0'),
          lo: xdr.Uint64.fromString('5000000'),
        })
      ),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('recipient_id_hash'),
      val: nativeToScVal(Buffer.from('aabbccdd'.repeat(8), 'hex'), {
        type: 'bytes',
      }),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('expiry'),
      val: xdr.ScVal.scvU64(xdr.Uint64.fromString('1000')),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('claimed'),
      val: xdr.ScVal.scvBool(false),
    }),
  ]);
}

function mockRpc() {
  const getAccountSpy = vi
    .spyOn(rpc.Server.prototype, 'getAccount')
    .mockResolvedValue(new Account(PUBLIC_KEY, '0'));

  const simulateSpy = vi
    .spyOn(rpc.Server.prototype, 'simulateTransaction')
    .mockResolvedValue(buildSuccessSimulation());

  return { getAccountSpy, simulateSpy };
}

function getContractFunctionName(simulatedTx: Transaction): string {
  const op = simulatedTx.operations[0] as unknown as {
    type: string;
    func: xdr.HostFunction;
  };
  return op.func.invokeContract().functionName().toString();
}

describe('prepareEscrowDepositTx', () => {
  it('builds an AssembledTransaction for the deposit contract method', async () => {
    const { getAccountSpy, simulateSpy } = mockRpc();

    const tx = await prepareEscrowDepositTx(
      { publicKey: PUBLIC_KEY },
      TOKEN_CONTRACT_ID,
      5000000n,
      'aabbccdd'.repeat(8),
      '11223344'.repeat(8),
      1000
    );

    expect(tx).toBeDefined();
    expect(getAccountSpy).toHaveBeenCalledWith(PUBLIC_KEY);
    expect(simulateSpy).toHaveBeenCalled();

    const simulatedTx = simulateSpy.mock.calls[0][0] as Transaction;
    expect(getContractFunctionName(simulatedTx)).toBe('deposit');
  });
});

describe('prepareEscrowClaimTx', () => {
  it('builds an AssembledTransaction for the claim contract method', async () => {
    const { getAccountSpy, simulateSpy } = mockRpc();

    const tx = await prepareEscrowClaimTx(
      { publicKey: PUBLIC_KEY },
      'deadbeef'.repeat(8),
      PUBLIC_KEY
    );

    expect(tx).toBeDefined();
    expect(getAccountSpy).toHaveBeenCalledWith(PUBLIC_KEY);
    expect(simulateSpy).toHaveBeenCalled();

    const simulatedTx = simulateSpy.mock.calls[0][0] as Transaction;
    expect(getContractFunctionName(simulatedTx)).toBe('claim');
  });
});

describe('prepareEscrowRefundTx', () => {
  it('builds an AssembledTransaction for the refund contract method', async () => {
    const { getAccountSpy, simulateSpy } = mockRpc();

    const tx = await prepareEscrowRefundTx(
      { publicKey: PUBLIC_KEY },
      'aabbccdd'.repeat(8)
    );

    expect(tx).toBeDefined();
    expect(getAccountSpy).toHaveBeenCalledWith(PUBLIC_KEY);
    expect(simulateSpy).toHaveBeenCalled();

    const simulatedTx = simulateSpy.mock.calls[0][0] as Transaction;
    expect(getContractFunctionName(simulatedTx)).toBe('refund');
  });
});

describe('prepareEscrowGetDepositTx', () => {
  it('returns EscrowDeposit when the contract returns Some(Deposit)', async () => {
    const getAccountSpy = vi
      .spyOn(rpc.Server.prototype, 'getAccount')
      .mockResolvedValue(new Account(PUBLIC_KEY, '0'));

    const simulateSpy = vi
      .spyOn(rpc.Server.prototype, 'simulateTransaction')
      .mockResolvedValue({
        ...buildSuccessSimulation(),
        result: {
          auth: [],
          retval: buildDepositScVal(),
        },
      } as unknown as rpc.Api.SimulateTransactionSuccessResponse);

    const deposit = await prepareEscrowGetDepositTx(
      { publicKey: PUBLIC_KEY },
      'aabbccdd'.repeat(8)
    );

    expect(deposit).not.toBeNull();
    expect(deposit?.sender).toBe(PUBLIC_KEY);
    expect(deposit?.token).toBe(TOKEN_CONTRACT_ID);
    expect(deposit?.amount).toBe(5000000n);
    expect(deposit?.recipientIdHash).toBe('aabbccdd'.repeat(8));
    expect(deposit?.expiry).toBe(1000n);
    expect(deposit?.claimed).toBe(false);

    expect(getAccountSpy).toHaveBeenCalledWith(PUBLIC_KEY);
    expect(simulateSpy).toHaveBeenCalled();

    const simulatedTx = simulateSpy.mock.calls[0][0] as Transaction;
    expect(getContractFunctionName(simulatedTx)).toBe('get_deposit');

    getAccountSpy.mockRestore();
    simulateSpy.mockRestore();
  });

  it('returns null when the contract returns None', async () => {
    const getAccountSpy = vi
      .spyOn(rpc.Server.prototype, 'getAccount')
      .mockResolvedValue(new Account(PUBLIC_KEY, '0'));

    const simulateSpy = vi
      .spyOn(rpc.Server.prototype, 'simulateTransaction')
      .mockResolvedValue({
        ...buildSuccessSimulation(),
        result: {
          auth: [],
          retval: xdr.ScVal.scvVoid(),
        },
      } as unknown as rpc.Api.SimulateTransactionSuccessResponse);

    const deposit = await prepareEscrowGetDepositTx(
      { publicKey: PUBLIC_KEY },
      '00000000'.repeat(8)
    );

    expect(deposit).toBeNull();

    getAccountSpy.mockRestore();
    simulateSpy.mockRestore();
  });

  it('throws when simulation returns an error', async () => {
    const getAccountSpy = vi
      .spyOn(rpc.Server.prototype, 'getAccount')
      .mockResolvedValue(new Account(PUBLIC_KEY, '0'));

    const simulateSpy = vi
      .spyOn(rpc.Server.prototype, 'simulateTransaction')
      .mockResolvedValue({
        id: 'sim-id',
        latestLedger: 100,
        _parsed: true,
        events: [],
        error: 'contract not found',
      } as unknown as rpc.Api.SimulateTransactionErrorResponse);

    await expect(
      prepareEscrowGetDepositTx(
        { publicKey: PUBLIC_KEY },
        'aabbccdd'.repeat(8)
      )
    ).rejects.toThrow('Simulation failed: contract not found');

    getAccountSpy.mockRestore();
    simulateSpy.mockRestore();
  });
});
