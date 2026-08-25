import { Horizon } from '@stellar/stellar-sdk';
import { isProductionNetwork } from './network';

export const HORIZON_EXPLORER_URL = isProductionNetwork()
  ? 'https://stellar.expert/explorer/public/tx'
  : 'https://stellar.expert/explorer/testnet/tx';

export type TransactionType = 'receive' | 'send' | 'unknown';

export interface WalletTransaction {
  id: string;
  hash: string;
  type: TransactionType;
  status: 'success' | 'failed';
  createdAt: string;
  ledger: number;
  fee: string;
  asset: string;
  amount: string;
  recipient?: string;
  sender?: string;
  memo?: string;
}

export interface TransactionDetails extends WalletTransaction {
  operationCount: number;
  sourceAccount: string;
}

const XLM_ASSET = 'XLM';
const USDC_ASSET = 'USDC';

function formatAmountFromStroops(amount: string | undefined): string {
  if (!amount) {
    return '0';
  }
  const value = BigInt(amount);
  const integer = value / 10_000_000n;
  const fraction = value % 10_000_000n;
  if (fraction === 0n) {
    return integer.toString();
  }
  const fractionStr = fraction.toString().padStart(7, '0').replace(/0+$/, '');
  return `${integer}.${fractionStr}`;
}

function parsePaymentOperation(
  op: Horizon.ServerApi.PaymentOperationRecord,
  walletAddress: string,
  ledger: number
): WalletTransaction | null {
  const isReceive = op.to === walletAddress;
  const isSend = op.from === walletAddress;
  if (!isReceive && !isSend) {
    return null;
  }

  const assetCode = typeof op.asset_code === 'string' ? op.asset_code : XLM_ASSET;
  const amount = formatAmountFromStroops(op.amount);

  return {
    id: op.transaction_hash,
    hash: op.transaction_hash,
    type: isReceive ? 'receive' : 'send',
    status: op.transaction_successful ? 'success' : 'failed',
    createdAt: op.created_at,
    ledger,
    fee: '0',
    asset: assetCode,
    amount,
    recipient: isReceive ? undefined : op.to,
    sender: isReceive ? op.from : undefined,
  };
}

function parsePathPaymentOperation(
  op: Horizon.ServerApi.PathPaymentOperationRecord,
  walletAddress: string,
  ledger: number
): WalletTransaction | null {
  const isReceive = op.to === walletAddress;
  const isSend = op.from === walletAddress;
  if (!isReceive && !isSend) {
    return null;
  }

  const sourceAsset = op.source_asset_code ?? XLM_ASSET;
  const destAsset = op.asset_code ?? XLM_ASSET;

  return {
    id: op.transaction_hash,
    hash: op.transaction_hash,
    type: isReceive ? 'receive' : 'send',
    status: op.transaction_successful ? 'success' : 'failed',
    createdAt: op.created_at,
    ledger,
    fee: '0',
    asset: isReceive ? destAsset : sourceAsset,
    amount: formatAmountFromStroops(isReceive ? op.amount : op.source_amount),
    recipient: isReceive ? undefined : op.to,
    sender: isReceive ? op.from : undefined,
  };
}

function describeAssetFromBalanceChange(
  change: Horizon.HorizonApi.BalanceChange
): string {
  if (change.asset_type === 'native') {
    return XLM_ASSET;
  }
  if (change.asset_code === 'USDC') {
    return USDC_ASSET;
  }
  return change.asset_code ?? `contract:${change.asset_type}`;
}

function parseInvokeHostFunctionOperation(
  op: Horizon.ServerApi.InvokeHostFunctionOperationRecord,
  walletAddress: string,
  ledger: number
): WalletTransaction | null {
  // In fee-sponsored passkey transactions the operation source is the fee
  // payer, not the wallet. Detect wallet involvement through SAC balance
  // changes emitted by Horizon for the invoked contract.
  const functionName = op.function;

  if (functionName === 'transfer') {
    const outgoing = op.asset_balance_changes.find(
      (change) => change.from === walletAddress && change.to !== walletAddress
    );
    const incoming = op.asset_balance_changes.find(
      (change) => change.to === walletAddress && change.from !== walletAddress
    );

    const change = outgoing ?? incoming;
    if (!change) {
      return null;
    }

    const isReceive = !outgoing && Boolean(incoming);

    return {
      id: op.transaction_hash,
      hash: op.transaction_hash,
      type: isReceive ? 'receive' : 'send',
      status: op.transaction_successful ? 'success' : 'failed',
      createdAt: op.created_at,
      ledger,
      fee: '0',
      asset: describeAssetFromBalanceChange(change),
      amount: formatAmountFromStroops(change.amount),
      recipient: isReceive ? undefined : change.to,
      sender: isReceive ? change.from : undefined,
    };
  }

  return null;
}

export function classifyOperation(
  op: Horizon.ServerApi.OperationRecord,
  walletAddress: string,
  usdcContractId: string,
  ledger: number
): WalletTransaction | null {
  switch (op.type) {
    case 'payment':
      return parsePaymentOperation(
        op as Horizon.ServerApi.PaymentOperationRecord,
        walletAddress,
        ledger
      );
    case 'path_payment_strict_receive':
    case 'path_payment_strict_send':
      return parsePathPaymentOperation(
        op as Horizon.ServerApi.PathPaymentOperationRecord,
        walletAddress,
        ledger
      );
    case 'invoke_host_function':
      return parseInvokeHostFunctionOperation(
        op as Horizon.ServerApi.InvokeHostFunctionOperationRecord,
        walletAddress,
        ledger
      );
    default:
      return null;
  }
}

export function buildTransactionDetails(
  tx: Horizon.ServerApi.TransactionRecord,
  ops: Horizon.ServerApi.OperationRecord[],
  walletAddress: string,
  usdcContractId: string
): TransactionDetails {
  const status = tx.successful ? 'success' : 'failed';
  const fee = String(tx.fee_charged);
  const memo = tx.memo_type !== 'none' ? tx.memo : undefined;

  let primary: WalletTransaction | null = null;
  for (const op of ops) {
    const parsed = classifyOperation(op, walletAddress, usdcContractId, tx.ledger_attr);
    if (parsed) {
      primary = parsed;
      break;
    }
  }

  const type: TransactionType = primary?.type ?? 'unknown';

  return {
    id: tx.hash,
    hash: tx.hash,
    type,
    status,
    createdAt: tx.created_at,
    ledger: tx.ledger_attr,
    fee,
    asset: primary?.asset ?? XLM_ASSET,
    amount: primary?.amount ?? '0',
    recipient: primary?.recipient,
    sender: primary?.sender,
    memo,
    operationCount: ops.length,
    sourceAccount: tx.source_account,
  };
}

export function explorerUrl(hash: string): string {
  return `${HORIZON_EXPLORER_URL}/${hash}`;
}

export function formatTransactionType(type: TransactionType): string {
  switch (type) {
    case 'receive':
      return 'Received';
    case 'send':
      return 'Sent';
    default:
      return 'Transaction';
  }
}

export function formatTransactionDescription(tx: WalletTransaction): string {
  switch (tx.type) {
    case 'receive':
      return `Received ${tx.amount} ${tx.asset}`;
    case 'send':
      return `Sent ${tx.amount} ${tx.asset}`;
    default:
      return 'Unknown transaction';
  }
}
