import { Horizon, Address, xdr } from '@stellar/stellar-sdk';
import { isProductionNetwork } from './network';

export const HORIZON_EXPLORER_URL = isProductionNetwork()
  ? 'https://stellar.expert/explorer/public/tx'
  : 'https://stellar.expert/explorer/testnet/tx';

export type TransactionType =
  | 'receive'
  | 'send'
  | 'claim_link_send'
  | 'claim_link_receive'
  | 'claim_link_refund'
  | 'unknown';

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

function formatBalanceChangeAmount(amount: string | undefined): string {
  if (!amount) {
    return '0';
  }
  if (!amount.includes('.')) {
    return amount;
  }
  return amount.replace(/\.?0+$/, '');
}

function parseScValSymbol(base64: string): string | null {
  try {
    const scVal = xdr.ScVal.fromXDR(Buffer.from(base64, 'base64'));
    if (scVal.switch().name !== 'scvSymbol') {
      return null;
    }
    const value = scVal.sym();
    return typeof value === 'string' ? value : value.toString('utf8');
  } catch {
    return null;
  }
}

function parseScValAddress(base64: string): string | null {
  try {
    const scVal = xdr.ScVal.fromXDR(Buffer.from(base64, 'base64'));
    return Address.fromScVal(scVal).toString();
  } catch {
    return null;
  }
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
  ledger: number,
  escrowContractId?: string
): WalletTransaction | null {
  // Horizon reports the host function type at the operation level; the actual
  // contract function name and arguments are encoded as XDR ScVals in the
  // parameters array.
  if (op.function !== 'HostFunctionTypeHostFunctionTypeInvokeContract') {
    return null;
  }

  const functionName = parseScValSymbol(op.parameters[1]?.value ?? '');
  const contractId = parseScValAddress(op.parameters[0]?.value ?? '');

  // --- SAC transfer (existing logic) ---
  if (functionName === 'transfer') {
    const fromAddress = parseScValAddress(op.parameters[2]?.value ?? '');
    const toAddress = parseScValAddress(op.parameters[3]?.value ?? '');
    if (!fromAddress || !toAddress) {
      return null;
    }

    const isReceive = toAddress === walletAddress;
    const isSend = fromAddress === walletAddress;
    if (!isReceive && !isSend) {
      return null;
    }

    const change = op.asset_balance_changes.find(
      (c) => c.from === fromAddress && c.to === toAddress
    );

    return {
      id: op.transaction_hash,
      hash: op.transaction_hash,
      type: isReceive ? 'receive' : 'send',
      status: op.transaction_successful ? 'success' : 'failed',
      createdAt: op.created_at,
      ledger,
      fee: '0',
      asset: change ? describeAssetFromBalanceChange(change) : XLM_ASSET,
      amount: change ? formatBalanceChangeAmount(change.amount) : '0',
      recipient: isReceive ? undefined : toAddress,
      sender: isReceive ? fromAddress : undefined,
    };
  }

  // --- Escrow operations ---
  if (escrowContractId && contractId === escrowContractId) {
    if (functionName === 'deposit') {
      const sender = parseScValAddress(op.parameters[2]?.value ?? '');
      if (sender === walletAddress) {
        const change = op.asset_balance_changes.find(
          (c) => c.from === walletAddress && c.to === escrowContractId
        );
        return {
          id: op.transaction_hash,
          hash: op.transaction_hash,
          type: 'claim_link_send',
          status: op.transaction_successful ? 'success' : 'failed',
          createdAt: op.created_at,
          ledger,
          fee: '0',
          asset: change ? describeAssetFromBalanceChange(change) : USDC_ASSET,
          amount: change ? formatBalanceChangeAmount(change.amount) : '0',
          recipient: escrowContractId,
        };
      }
    }

    if (functionName === 'claim') {
      const recipientWallet = parseScValAddress(op.parameters[2]?.value ?? '');
      if (recipientWallet === walletAddress) {
        const change = op.asset_balance_changes.find(
          (c) => c.from === escrowContractId && c.to === walletAddress
        );
        return {
          id: op.transaction_hash,
          hash: op.transaction_hash,
          type: 'claim_link_receive',
          status: op.transaction_successful ? 'success' : 'failed',
          createdAt: op.created_at,
          ledger,
          fee: '0',
          asset: change ? describeAssetFromBalanceChange(change) : USDC_ASSET,
          amount: change ? formatBalanceChangeAmount(change.amount) : '0',
          sender: escrowContractId,
        };
      }
    }

    if (functionName === 'refund') {
      const change = op.asset_balance_changes.find(
        (c) => c.from === escrowContractId && c.to === walletAddress
      );
      if (change) {
        return {
          id: op.transaction_hash,
          hash: op.transaction_hash,
          type: 'claim_link_refund',
          status: op.transaction_successful ? 'success' : 'failed',
          createdAt: op.created_at,
          ledger,
          fee: '0',
          asset: describeAssetFromBalanceChange(change),
          amount: formatBalanceChangeAmount(change.amount),
          sender: escrowContractId,
        };
      }
    }
  }

  return null;
}

export function classifyOperation(
  op: Horizon.ServerApi.OperationRecord,
  walletAddress: string,
  usdcContractId: string,
  ledger: number,
  escrowContractId?: string
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
        ledger,
        escrowContractId
      );
    default:
      return null;
  }
}

export function buildTransactionDetails(
  tx: Horizon.ServerApi.TransactionRecord,
  ops: Horizon.ServerApi.OperationRecord[],
  walletAddress: string,
  usdcContractId: string,
  escrowContractId?: string
): TransactionDetails {
  const status = tx.successful ? 'success' : 'failed';
  const fee = String(tx.fee_charged);
  const memo = tx.memo_type !== 'none' ? tx.memo : undefined;

  let primary: WalletTransaction | null = null;
  for (const op of ops) {
    const parsed = classifyOperation(op, walletAddress, usdcContractId, tx.ledger_attr, escrowContractId);
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
    case 'claim_link_send':
      return 'Sent claim link';
    case 'claim_link_receive':
      return 'Claimed from link';
    case 'claim_link_refund':
      return 'Refunded link';
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
    case 'claim_link_send':
      return `Sent ${tx.amount} ${tx.asset} claim link`;
    case 'claim_link_receive':
      return `Claimed ${tx.amount} ${tx.asset} from link`;
    case 'claim_link_refund':
      return `Refunded ${tx.amount} ${tx.asset} from link`;
    default:
      return 'Unknown transaction';
  }
}
