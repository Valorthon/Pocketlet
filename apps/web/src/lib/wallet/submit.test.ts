import { describe, it, expect, vi } from 'vitest';
import {
  Account,
  Address,
  Contract,
  Keypair,
  Operation,
  SorobanDataBuilder,
  Transaction,
  TransactionBuilder,
  rpc,
  xdr,
} from '@stellar/stellar-sdk';
import {
  getAuthEntryAddresses,
  hasSourceAccountAuth,
  parseSorobanTransaction,
  getInvokeContractDetails,
  submitSignedTransaction,
} from './submit';
import { NETWORK_PASSPHRASE } from './network';

const FEE_PAYER_PUBLIC = 'GATVJDFPIPADU74ALX4344HEQQZ2LGMNWABPXBOWYMVXM37KMTTUALTU';
const WALLET_CONTRACT =
  'CA7FMXWUMM3C37O4QF4E4R4KKXZIEBV7CTFHKDRDXPBLZQ2NMC5PZC5G';

vi.mock('@/lib/wallet/fee-payer', () => ({
  getFeePayerKeypair: () =>
    Keypair.fromSecret(
      'SBI2ATXEXZNK7L53NN4AWQMVCZB2HVULL3LKM7FYVZWL25IUHJOE65YS'
    ),
  fundAccount: vi.fn().mockResolvedValue(undefined),
  isProductionNetwork: () => false,
  RPC_URL: 'https://soroban-testnet.stellar.org',
  NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
}));

function buildTestInvokeTransaction(): Transaction {
  const source = new Account(FEE_PAYER_PUBLIC, '0');
  const contract = new Contract(
    'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA'
  );
  return new TransactionBuilder(source, {
    fee: '100000',
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        'transfer',
        new Address(
          'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA'
        ).toScVal(),
        new Address(
          'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF'
        ).toScVal(),
        xdr.ScVal.scvI128(
          new xdr.Int128Parts({
            hi: xdr.Int64.fromString('0'),
            lo: xdr.Uint64.fromString('10000000'),
          })
        )
      )
    )
    .setTimeout(30)
    .build();
}

function buildAddressAuthEntry(address: string): xdr.SorobanAuthorizationEntry {
  const authorizedFunction = xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
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
  const authorizedFunction = xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
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

function buildInvokeOperation(
  auth: xdr.SorobanAuthorizationEntry[]
): Operation.InvokeHostFunction {
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

  return tx.operations[0] as Operation.InvokeHostFunction;
}

describe('parseSorobanTransaction', () => {
  it('accepts a base64 Soroban transaction envelope', () => {
    const tx = buildTestInvokeTransaction();
    const parsed = parseSorobanTransaction(tx.toXDR());
    expect(parsed).toBeInstanceOf(Transaction);
  });

  it('rejects a fee-bump envelope', () => {
    const inner = buildTestInvokeTransaction();
    const feeBump = TransactionBuilder.buildFeeBumpTransaction(
      FEE_PAYER_PUBLIC,
      '200000',
      inner,
      NETWORK_PASSPHRASE
    );
    expect(() => parseSorobanTransaction(feeBump.toXDR())).toThrow(
      'Fee-bump envelopes are not accepted'
    );
  });

  it('rejects a non-Soroban transaction', () => {
    const source = new Account(FEE_PAYER_PUBLIC, '0');
    const tx = new TransactionBuilder(source, {
      fee: '100000',
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(
        Operation.createAccount({
          destination: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
          startingBalance: '1',
        })
      )
      .setTimeout(30)
      .build();

    expect(() => parseSorobanTransaction(tx.toXDR())).toThrow(
      'does not contain a Soroban invoke_host_function operation'
    );
  });
});

describe('getInvokeContractDetails', () => {
  it('extracts contract id and function name', () => {
    const tx = buildTestInvokeTransaction();
    const details = getInvokeContractDetails(tx.operations[0]);
    expect(details).not.toBeNull();
    expect(details?.functionName).toBe('transfer');
  });
});

describe('getAuthEntryAddresses', () => {
  it('returns the wallet address from address-bound auth entries', () => {
    const op = buildInvokeOperation([buildAddressAuthEntry(WALLET_CONTRACT)]);
    expect(getAuthEntryAddresses(op)).toEqual([WALLET_CONTRACT]);
  });

  it('returns an empty array for source-account auth entries', () => {
    const op = buildInvokeOperation([buildSourceAccountAuthEntry()]);
    expect(getAuthEntryAddresses(op)).toEqual([]);
  });
});

describe('hasSourceAccountAuth', () => {
  it('returns true when an auth entry uses source-account credentials', () => {
    const op = buildInvokeOperation([buildSourceAccountAuthEntry()]);
    expect(hasSourceAccountAuth(op)).toBe(true);
  });

  it('returns false for address-bound auth entries', () => {
    const op = buildInvokeOperation([buildAddressAuthEntry(WALLET_CONTRACT)]);
    expect(hasSourceAccountAuth(op)).toBe(false);
  });
});

describe('submitSignedTransaction', () => {
  it('rebuilds the operation with the fee payer source, signs, and submits', async () => {
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
      auth: [buildAddressAuthEntry(WALLET_CONTRACT)],
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

    const getAccountSpy = vi
      .spyOn(rpc.Server.prototype, 'getAccount')
      .mockResolvedValue(new Account(FEE_PAYER_PUBLIC, '0'));
    const simulateSpy = vi
      .spyOn(rpc.Server.prototype, 'simulateTransaction')
      .mockResolvedValue({
        id: 'sim-id',
        latestLedger: 100,
        _parsed: true,
        events: [],
        transactionData: new SorobanDataBuilder(),
        minResourceFee: '1000',
      } as unknown as rpc.Api.SimulateTransactionSuccessResponse);
    const sendSpy = vi
      .spyOn(rpc.Server.prototype, 'sendTransaction')
      .mockResolvedValue({
        status: 'PENDING',
        hash: 'test-hash-123',
      } as unknown as rpc.Api.SendTransactionResponse);
    const getTransactionSpy = vi
      .spyOn(rpc.Server.prototype, 'getTransaction')
      .mockResolvedValue({
        status: 'SUCCESS',
        txHash: 'test-hash-123',
        ledger: 100,
      } as unknown as rpc.Api.GetSuccessfulTransactionResponse);

    const result = await submitSignedTransaction(tx.toXDR());

    expect(result.hash).toBe('test-hash-123');
    expect(getAccountSpy).toHaveBeenCalledWith(FEE_PAYER_PUBLIC);
    expect(simulateSpy).toHaveBeenCalled();
    expect(sendSpy).toHaveBeenCalled();
    expect(getTransactionSpy).toHaveBeenCalledWith('test-hash-123');

    getAccountSpy.mockRestore();
    simulateSpy.mockRestore();
    sendSpy.mockRestore();
    getTransactionSpy.mockRestore();
  });
});
