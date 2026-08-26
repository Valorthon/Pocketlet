import { describe, it, expect } from 'vitest';
import { Horizon, Address, xdr } from '@stellar/stellar-sdk';
import {
  buildTransactionDetails,
  classifyOperation,
  explorerUrl,
  formatTransactionDescription,
  formatTransactionType,
} from './transactions';
import { getXlmContractId } from './assets';

const USDC_CONTRACT_ID = 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA';
const WALLET_CONTRACT_ID =
  'CANWB6BIHTG37UGKBXNCFA7X6XD4XSA6FVSP4GVYSWRAQ3LID7LQ52ZG';
const OTHER_ADDRESS =
  'GAEBH5ZALWM4SFBG3XEE7FBGKNPUVX5JT7URH34XHQ6SVRT6IGY4SXAM';
const CLASSIC_WALLET_ADDRESS =
  'GABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNO';
const CLASSIC_OTHER_ADDRESS =
  'GBBCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNO';
const FEE_PAYER_ADDRESS =
  'GCCVPYFOHY7B7M4SCIQRMX2VTZVOB7VDJBJGN4NVBHPQAJLZS4KKJLPO';

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

function makeTx(overrides: Partial<Horizon.ServerApi.TransactionRecord> = {}) {
  return {
    hash: 'txhash123',
    successful: true,
    created_at: '2026-07-20T10:00:00Z',
    ledger: 12345,
    fee_charged: '100',
    source_account: CLASSIC_WALLET_ADDRESS,
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
    source_account: CLASSIC_WALLET_ADDRESS,
    from: CLASSIC_OTHER_ADDRESS,
    to: CLASSIC_WALLET_ADDRESS,
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
    source_account: FEE_PAYER_ADDRESS,
    function: 'HostFunctionTypeHostFunctionTypeInvokeContract',
    parameters: makeTransferParameters(
      USDC_CONTRACT_ID,
      WALLET_CONTRACT_ID,
      OTHER_ADDRESS
    ),
    address: '',
    salt: '',
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
    from: WALLET_CONTRACT_ID,
    to: OTHER_ADDRESS,
    amount: '15.0000000',
    ...overrides,
  };
}

describe('transaction parser', () => {
  it('classifies a received payment', () => {
    const op = makePaymentOp({
      from: CLASSIC_OTHER_ADDRESS,
      to: CLASSIC_WALLET_ADDRESS,
    });
    const tx = classifyOperation(
      op,
      CLASSIC_WALLET_ADDRESS,
      USDC_CONTRACT_ID,
      12345
    );
    expect(tx).not.toBeNull();
    expect(tx?.type).toBe('receive');
    expect(tx?.amount).toBe('10');
    expect(tx?.ledger).toBe(12345);
    expect(tx?.sender).toBe(CLASSIC_OTHER_ADDRESS);
  });

  it('classifies a sent payment', () => {
    const op = makePaymentOp({
      from: CLASSIC_WALLET_ADDRESS,
      to: CLASSIC_OTHER_ADDRESS,
    });
    const tx = classifyOperation(
      op,
      CLASSIC_WALLET_ADDRESS,
      USDC_CONTRACT_ID,
      12345
    );
    expect(tx?.type).toBe('send');
    expect(tx?.recipient).toBe(CLASSIC_OTHER_ADDRESS);
  });

  it('ignores payments not involving the wallet', () => {
    const op = makePaymentOp({
      from: CLASSIC_OTHER_ADDRESS,
      to: CLASSIC_OTHER_ADDRESS,
    });
    const tx = classifyOperation(
      op,
      CLASSIC_WALLET_ADDRESS,
      USDC_CONTRACT_ID,
      12345
    );
    expect(tx).toBeNull();
  });

  it('classifies a swap invoke operation as unknown', () => {
    const op = makeInvokeOp({
      parameters: makeTransferParameters(
        USDC_CONTRACT_ID,
        WALLET_CONTRACT_ID,
        OTHER_ADDRESS
      ).map((p, idx) =>
        idx === 1 ? makeSymbolParam('swap') : p
      ),
    });
    const tx = classifyOperation(
      op,
      WALLET_CONTRACT_ID,
      USDC_CONTRACT_ID,
      12345
    );
    expect(tx).toBeNull();
  });

  it('builds transaction details from a receive payment', () => {
    const tx = makeTx();
    const op = makePaymentOp({
      from: CLASSIC_OTHER_ADDRESS,
      to: CLASSIC_WALLET_ADDRESS,
    });
    const details = buildTransactionDetails(
      tx,
      [op],
      CLASSIC_WALLET_ADDRESS,
      USDC_CONTRACT_ID
    );

    expect(details.hash).toBe('txhash123');
    expect(details.type).toBe('receive');
    expect(details.status).toBe('success');
    expect(details.fee).toBe('100');
    expect(details.amount).toBe('10');
    expect(details.asset).toBe('XLM');
    expect(details.operationCount).toBe(1);
    expect(details.sourceAccount).toBe(CLASSIC_WALLET_ADDRESS);
  });

  it('marks failed transactions', () => {
    const tx = makeTx({ successful: false });
    const op = makePaymentOp();
    const details = buildTransactionDetails(
      tx,
      [op],
      CLASSIC_WALLET_ADDRESS,
      USDC_CONTRACT_ID
    );
    expect(details.status).toBe('failed');
  });

  it('falls back to unknown when no matching operation', () => {
    const tx = makeTx();
    const op = makeInvokeOp({
      parameters: makeTransferParameters(
        USDC_CONTRACT_ID,
        OTHER_ADDRESS,
        OTHER_ADDRESS
      ),
      asset_balance_changes: [],
    });
    const details = buildTransactionDetails(
      tx,
      [op],
      WALLET_CONTRACT_ID,
      USDC_CONTRACT_ID
    );
    expect(details.type).toBe('unknown');
  });

  it('formats transaction types', () => {
    expect(formatTransactionType('receive')).toBe('Received');
    expect(formatTransactionType('send')).toBe('Sent');
    expect(formatTransactionType('unknown')).toBe('Transaction');
  });

  it('formats transaction descriptions', () => {
    expect(
      formatTransactionDescription({
        ...makePaymentOp(),
        type: 'receive',
        amount: '10',
        asset: 'XLM',
      } as never)
    ).toBe('Received 10 XLM');
    expect(
      formatTransactionDescription({
        ...makePaymentOp(),
        type: 'send',
        amount: '5',
        asset: 'USDC',
      } as never)
    ).toBe('Sent 5 USDC');
  });

  it('classifies a sent USDC transfer invoke operation with balance changes', () => {
    const op = makeInvokeOp({
      parameters: makeTransferParameters(
        USDC_CONTRACT_ID,
        WALLET_CONTRACT_ID,
        OTHER_ADDRESS
      ),
      asset_balance_changes: [
        makeBalanceChange({
          asset_type: 'credit_alphanum4',
          asset_code: 'USDC',
          amount: '2.5000000',
        }),
      ],
    });
    const tx = classifyOperation(
      op,
      WALLET_CONTRACT_ID,
      USDC_CONTRACT_ID,
      12345
    );
    expect(tx?.type).toBe('send');
    expect(tx?.asset).toBe('USDC');
    expect(tx?.amount).toBe('2.5');
    expect(tx?.recipient).toBe(OTHER_ADDRESS);
  });

  it('classifies a received XLM transfer invoke operation with balance changes', () => {
    const op = makeInvokeOp({
      parameters: makeTransferParameters(
        USDC_CONTRACT_ID,
        OTHER_ADDRESS,
        WALLET_CONTRACT_ID
      ),
      asset_balance_changes: [
        makeBalanceChange({
          asset_type: 'native',
          from: OTHER_ADDRESS,
          to: WALLET_CONTRACT_ID,
          amount: '30.0000000',
        }),
      ],
    });
    const tx = classifyOperation(
      op,
      WALLET_CONTRACT_ID,
      USDC_CONTRACT_ID,
      12345
    );
    expect(tx?.type).toBe('receive');
    expect(tx?.asset).toBe('XLM');
    expect(tx?.amount).toBe('30');
    expect(tx?.sender).toBe(OTHER_ADDRESS);
    expect(tx?.recipient).toBeUndefined();
  });

  it('ignores invoke transfers not involving the wallet', () => {
    const op = makeInvokeOp({
      parameters: makeTransferParameters(
        USDC_CONTRACT_ID,
        OTHER_ADDRESS,
        OTHER_ADDRESS
      ),
      asset_balance_changes: [
        makeBalanceChange({
          from: OTHER_ADDRESS,
          to: OTHER_ADDRESS,
          amount: '1.0000000',
        }),
      ],
    });
    const tx = classifyOperation(
      op,
      WALLET_CONTRACT_ID,
      USDC_CONTRACT_ID,
      12345
    );
    expect(tx).toBeNull();
  });

  it('classifies a real Horizon XLM SAC transfer shape', () => {
    const op = makeInvokeOp({
      function: 'HostFunctionTypeHostFunctionTypeInvokeContract',
      parameters: makeTransferParameters(
        getXlmContractId(),
        WALLET_CONTRACT_ID,
        OTHER_ADDRESS
      ),
      asset_balance_changes: [
        makeBalanceChange({
          from: WALLET_CONTRACT_ID,
          to: OTHER_ADDRESS,
          amount: '50.0000000',
        }),
      ],
    });
    const tx = classifyOperation(
      op,
      WALLET_CONTRACT_ID,
      USDC_CONTRACT_ID,
      12345
    );
    expect(tx?.type).toBe('send');
    expect(tx?.asset).toBe('XLM');
    expect(tx?.amount).toBe('50');
    expect(tx?.recipient).toBe(OTHER_ADDRESS);
  });

  it('classifies a path payment send as a normal send', () => {
    const op = {
      ...makePaymentOp(),
      type: 'path_payment_strict_send',
      type_i: 13,
      from: CLASSIC_WALLET_ADDRESS,
      to: CLASSIC_OTHER_ADDRESS,
      asset_code: 'XLM',
      source_asset_code: 'USDC',
      amount: '100000000',
      source_amount: '25000000',
    } as unknown as Horizon.ServerApi.PathPaymentOperationRecord;
    const tx = classifyOperation(
      op,
      CLASSIC_WALLET_ADDRESS,
      USDC_CONTRACT_ID,
      12345
    );
    expect(tx?.type).toBe('send');
    expect(tx?.asset).toBe('USDC');
    expect(tx?.amount).toBe('2.5');
    expect(tx?.recipient).toBe(CLASSIC_OTHER_ADDRESS);
  });

  it('builds Stellar Expert explorer URL', () => {
    expect(explorerUrl('hash123')).toBe(
      'https://stellar.expert/explorer/testnet/tx/hash123'
    );
  });
});
