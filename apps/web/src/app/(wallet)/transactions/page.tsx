'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { TransactionListItem } from '@/components/ui/TransactionListItem';
import { WalletTransaction } from '@/lib/wallet/transactions';

export default function TransactionsPage() {
  const router = useRouter();
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTransactions = async () => {
    const res = await fetch('/api/wallet/transactions');
    if (res.status === 401) {
      router.push('/login');
      return;
    }
    if (!res.ok) {
      const body = (await res.json()) as { error?: string };
      setError(body.error ?? 'Failed to load transactions');
      setLoading(false);
      return;
    }
    const data = (await res.json()) as { transactions: WalletTransaction[] };
    setTransactions(data.transactions);
    setLoading(false);
  };

  useEffect(() => {
    fetchTransactions();
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-slate-600">Loading activity...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 pb-6">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold text-slate-900">Activity History</h3>
        <span className="text-xs font-medium text-slate-400">Stellar Ledger</span>
      </div>

      {error && <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}

      {transactions.length === 0 ? (
        <div className="rounded-2xl bg-white p-8 text-center shadow-sm">
          <p className="text-slate-600">No transactions yet.</p>
          <p className="mt-2 text-sm text-slate-500">
            Send or receive USDC or XLM to see activity here.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {transactions.map((tx) => (
            <TransactionListItem
              key={tx.hash}
              transaction={tx}
              onClick={() => router.push(`/transactions/${tx.hash}`)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
