'use client';

import React from 'react';
import { ArrowDownLeft, ArrowUpRight, ChevronRight, Receipt } from 'lucide-react';
import { cn, formatCurrency, truncateAddress } from '@/lib/utils';
import { WalletTransaction } from '@/lib/wallet/transactions';

export interface TransactionListItemProps {
  transaction: WalletTransaction;
  onClick?: (tx: WalletTransaction) => void;
  compact?: boolean;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function toCurrency(asset: string): 'USDC' | 'XLM' {
  return asset === 'XLM' ? 'XLM' : 'USDC';
}

export const TransactionListItem: React.FC<TransactionListItemProps> = ({
  transaction,
  onClick,
  compact = false,
}) => {
  const isReceive = transaction.type === 'receive';
  const isSend = transaction.type === 'send';

  const icon = isReceive ? (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
      <ArrowDownLeft className="h-5 w-5 stroke-[2.2]" />
    </div>
  ) : isSend ? (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-50 text-slate-600">
      <ArrowUpRight className="h-5 w-5 stroke-[2.2]" />
    </div>
  ) : (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600">
      <Receipt className="h-5 w-5 stroke-[2.2]" />
    </div>
  );

  const title = isReceive ? `Received ${transaction.asset}` : isSend ? `Sent ${transaction.asset}` : 'Transaction';

  const counterparty = isReceive ? transaction.sender : transaction.recipient;
  const detail = transaction.memo ?? (counterparty ? truncateAddress(counterparty) : 'Stellar Network');
  const subtitle = `${formatDate(transaction.createdAt)} • ${detail}`;

  return (
    <div
      onClick={() => onClick?.(transaction)}
      className={cn(
        'group mb-2.5 flex select-none items-center justify-between rounded-2xl border border-slate-100 bg-white p-3 shadow-sm transition-all duration-150 last:mb-0',
        onClick ? 'cursor-pointer hover:border-slate-200 active:scale-[0.99]' : '',
        compact ? 'p-2' : 'p-3'
      )}
    >
      <div className="flex min-w-0 items-center gap-3 pr-2">
        {icon}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-bold leading-snug text-slate-900">{title}</p>
            {transaction.status === 'failed' && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-rose-50 px-1.5 py-0.2 text-[9px] font-bold text-rose-700">
                Failed
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-[10px] font-medium text-slate-400">{subtitle}</p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 text-right">
        <div>
          <p
            className={cn(
              'text-sm font-bold tracking-tight',
              isReceive ? 'text-emerald-600' : 'text-slate-900'
            )}
          >
            {isReceive ? '+' : isSend ? '-' : ''}
            {formatCurrency(transaction.amount, toCurrency(transaction.asset))}
          </p>
        </div>
        {onClick && (
          <ChevronRight className="h-4 w-4 text-slate-300 transition-colors group-hover:text-slate-500" />
        )}
      </div>
    </div>
  );
};
