'use client';

import React from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { cn, formatCurrency } from '@/lib/utils';

export interface CurrencyDisplayProps {
  usdcAmount: number;
  xlmAmount: number;
  showToggle?: boolean;
  hideBalance?: boolean;
  onToggleHide?: () => void;
  className?: string;
}

export const CurrencyDisplay: React.FC<CurrencyDisplayProps> = ({
  usdcAmount,
  xlmAmount,
  showToggle = true,
  hideBalance = false,
  onToggleHide,
  className,
}) => {
  const formatted = formatCurrency(usdcAmount, 'USDC');
  const dotIndex = formatted.lastIndexOf('.');
  const wholePart = dotIndex !== -1 ? formatted.substring(0, dotIndex) : formatted;
  const decimalPart = dotIndex !== -1 ? formatted.substring(dotIndex) : '';

  return (
    <div
      className={cn(
        'relative w-full rounded-3xl bg-gradient-to-br from-white via-white to-pocketlet-50/30 border border-slate-100 shadow-sm p-6',
        className
      )}
    >
      <div className="mb-1.5 flex items-center justify-between">
        <p className="text-xs font-semibold text-slate-400">Personal Wallet Balance</p>

        {showToggle && (
          <button
            onClick={onToggleHide}
            type="button"
            className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-50 hover:text-slate-600"
            title={hideBalance ? 'Show balance' : 'Hide balance'}
            aria-label={hideBalance ? 'Show balance' : 'Hide balance'}
          >
            {hideBalance ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>

      <div className="my-1 flex items-baseline gap-2">
        {hideBalance ? (
          <div className="flex h-12 items-center font-mono text-3xl tracking-widest text-slate-300">
            $••••••
          </div>
        ) : (
          <h1 className="mb-2 text-4xl font-bold tracking-tight text-slate-900">
            {wholePart}
            <span className="font-semibold text-slate-400">{decimalPart}</span>
          </h1>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between border-t border-slate-50 pt-2">
        <div className="flex w-fit items-center gap-2 rounded-full bg-pocketlet-100 px-2.5 py-1">
          <div className="flex h-4 w-4 items-center justify-center rounded-full bg-pocketlet-500 text-[8px] font-bold text-white">
            S
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-pocketlet-700">
            {hideBalance ? '•••• XLM' : `${xlmAmount.toLocaleString('en-US', { maximumFractionDigits: 4 })} XLM`}
          </span>
        </div>

        <span className="text-[10px] font-semibold text-slate-400">Stellar Network</span>
      </div>
    </div>
  );
};
