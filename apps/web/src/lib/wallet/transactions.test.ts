import { describe, it, expect } from 'vitest';
import { Horizon } from '@stellar/stellar-sdk';
import {
  buildTransactionDetails,
  classifyOperation,
  explorerUrl,
  formatTransactionDescription,
  formatTransactionType,
} from './transactions';

const USDC_CONTRACT_ID = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
const WALLET_ADDRESS = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNO';
const OTHER_ADDRESS = 'GBBCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNO';

function makeTx(overrides: Partial<Horizon.ServerApi.TransactionRecord> = {}) {
  return {
    hash: 'txhash123',
    successful: true,
    created_at: '2026-07-20T10:00:00Z',
    ledger: 12345,
    fee_charged: '100',
    source_account: WALLET_ADDRESS,
    memo_type: 'none',
    memo: '',
    result_code: 0,
    result_code_transaction: 'tx_success',
    ...overrides,
  } as unknown as Horizon.ServerApi.TransactionRecord;
}

function makePaymentOp(
  overrides: Partial<Horizon.ServerApi.PaymentOperationRecord> = {}
) {
  return {
    id: 'op1',
    type: 'payment',
    type_i: 1,
    transaction_hash: 'txhash123',
    transaction_successful: true,
    created_at: '2026-07-20T10:00:00Z',
    source_account: WALLET_ADDRESS,
    from: OTHER_ADDRESS,
    to: WALLET_ADDRESS,
    amount: '100000000',
    asset_type: 'native',
    asset_code: undefined,
    ...overrides,
  } as unknown as Horizon.ServerApi.PaymentOperationRecord;
}

function makeInvokeOp(
  overrides: Partial<Horizon.ServerApi.InvokeHostFunctionOperationRecord> = {}
) {
  return {
    id: 'op2',
    type: 'invoke_host_function',
    type_i: 24,
    transaction_hash: 'txhash123',
    transaction_successful: true,
    created_at: '2026-07-20T10:00:00Z',
    source_account: WALLET_ADDRESS,
    function: 'transfer',
    parameters: [],
    address: 'CADDR',
    salt: 'salt',
    asset_balance_changes: [],
    ...overrides,
  } as unknown as Horizon.ServerApi.InvokeHostFunctionOperationRecord;
}

function makeBalanceChange(
  overrides: Partial<Horizon.HorizonApi.BalanceChange> = {}
): Horizon.HorizonApi.BalanceChange {
  return {
    asset_type: 'native',
    type: 'transfer',
    from: WALLET_ADDRESS,
    to: OTHER_ADDRESS,
    amount: '150000000',
    ...overrides,
  };
}

describe('transaction parser', () => {
  it('classifies a received payment', () => {
    const op = makePaymentOp({ from: OTHER_ADDRESS, to: WALLET_ADDRESS });
    const tx = classifyOperation(op, WALLET_ADDRESS, USDC_CONTRACT_ID);
    expect(tx).not.toBeNull();
    expect(tx?.type).toBe('receive');
    expect(tx?.amount).toBe('10');
    expect(tx?.sender).toBe(OTHER_ADDRESS);
  });

  it('classifies a sent payment', () => {
    const op = makePaymentOp({ from: WALLET_ADDRESS, to: OTHER_ADDRESS });
    const tx = classifyOperation(op, WALLET_ADDRESS, USDC_CONTRACT_ID);
    expect(tx?.type).toBe('send');
    expect(tx?.recipient).toBe(OTHER_ADDRESS);
  });

  it('ignores payments not involving the wallet', () => {
    const op = makePaymentOp({ from: OTHER_ADDRESS, to: OTHER_ADDRESS });
    const tx = classifyOperation(op, WALLET_ADDRESS, USDC_CONTRACT_ID);
    expect(tx).toBeNull();
  });

  it('classifies a swap invoke operation as unknown', () => {
    const op = makeInvokeOp({ function: 'swap' });
    const tx = classifyOperation(op, WALLET_ADDRESS, USDC_CONTRACT_ID);
    expect(tx).toBeNull();
  });

  it('builds transaction details from a receive payment', () => {
    const tx = makeTx();
    const op = makePaymentOp({ from: OTHER_ADDRESS, to: WALLET_ADDRESS });
    const details = buildTransactionDetails(tx, [op], WALLET_ADDRESS, USDC_CONTRACT_ID);

    expect(details.hash).toBe('txhash123');
    expect(details.type).toBe('receive');
    expect(details.status).toBe('success');
    expect(details.fee).toBe('100');
    expect(details.amount).toBe('10');
    expect(details.asset).toBe('XLM');
    expect(details.operationCount).toBe(1);
    expect(details.sourceAccount).toBe(WALLET_ADDRESS);
  });

  it('marks failed transactions', () => {
    const tx = makeTx({ successful: false });
    const op = makePaymentOp();
    const details = buildTransactionDetails(tx, [op], WALLET_ADDRESS, USDC_CONTRACT_ID);
    expect(details.status).toBe('failed');
  });

  it('falls back to unknown when no matching operation', () => {
    const tx = makeTx();
    const op = makeInvokeOp({ function: 'set_owner', source_account: OTHER_ADDRESS });
    const details = buildTransactionDetails(tx, [op], WALLET_ADDRESS, USDC_CONTRACT_ID);
    expect(details.type).toBe('unknown');
  });

  it('formats transaction types', () => {
    expect(formatTransactionType('receive')).toBe('Received');
    expect(formatTransactionType('send')).toBe('Sent');
    expect(formatTransactionType('unknown')).toBe('Transaction');
  });

  it('formats transaction descriptions', () => {
    expect(formatTransactionDescription({ ...makePaymentOp(), type: 'receive', amount: '10', asset: 'XLM' } as never)).toBe('Received 10 XLM');
    expect(formatTransactionDescription({ ...makePaymentOp(), type: 'send', amount: '5', asset: 'USDC' } as never)).toBe('Sent 5 USDC');
  });

  it('classifies a transfer invoke operation with balance changes', () => {
    const op = makeInvokeOp({
      function: 'transfer',
      asset_balance_changes: [
        makeBalanceChange({
          asset_type: 'credit_alphanum4',
          asset_code: 'USDC',
          amount: '25000000',
        }),
      ],
    });
    const tx = classifyOperation(op, WALLET_ADDRESS, USDC_CONTRACT_ID);
    expect(tx?.type).toBe('send');
    expect(tx?.asset).toBe('USDC');
    expect(tx?.amount).toBe('2.5');
    expect(tx?.recipient).toBe(OTHER_ADDRESS);
  });

  it('classifies a path payment send as a normal send', () => {
    const op = {
      ...makePaymentOp(),
      type: 'path_payment_strict_send',
      type_i: 13,
      from: WALLET_ADDRESS,
      to: OTHER_ADDRESS,
      asset_code: 'XLM',
      source_asset_code: 'USDC',
      amount: '100000000',
      source_amount: '25000000',
    } as unknown as Horizon.ServerApi.PathPaymentOperationRecord;
    const tx = classifyOperation(op, WALLET_ADDRESS, USDC_CONTRACT_ID);
    expect(tx?.type).toBe('send');
    expect(tx?.asset).toBe('USDC');
    expect(tx?.amount).toBe('2.5');
    expect(tx?.recipient).toBe(OTHER_ADDRESS);
  });

  it('builds Stellar Expert explorer URL', () => {
    expect(explorerUrl('hash123')).toBe(
      'https://stellar.expert/explorer/testnet/tx/hash123'
    );
  });
});
