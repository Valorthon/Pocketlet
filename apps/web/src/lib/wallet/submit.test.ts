import { describe, it, expect } from 'vitest';
import {
  Account,
  Address,
  Contract,
  Operation,
  Transaction,
  TransactionBuilder,
  xdr,
} from '@stellar/stellar-sdk';
import { parseSorobanTransaction, getInvokeContractDetails } from './submit';
import { NETWORK_PASSPHRASE } from './network';

const FEE_PAYER_PUBLIC = 'GATVJDFPIPADU74ALX4344HEQQZ2LGMNWABPXBOWYMVXM37KMTTUALTU';

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
