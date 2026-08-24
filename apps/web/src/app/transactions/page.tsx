'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  WalletTransaction,
  formatTransactionDescription,
  formatTransactionType,
} from '@/lib/wallet/transactions';

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTransactions = async () => {
    const res = await fetch('/api/wallet/transactions');
    if (res.status === 401) {
      window.location.href = '/login';
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

  const formatDate = (value: string) => {
    return new Date(value).toLocaleString();
  };

  const typeColor = (type: WalletTransaction['type']) => {
    switch (type) {
      case 'receive':
        return 'text-green-600';
      case 'send':
        return 'text-red-600';
      default:
        return 'text-gray-600';
    }
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="text-gray-600">Loading activity...</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-md">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-pocketlet-600">Activity</h1>
          <Link href="/home" className="text-sm text-gray-500 underline hover:text-gray-700">
            Back to wallet
          </Link>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}

        {transactions.length === 0 ? (
          <div className="rounded-2xl bg-white p-8 text-center shadow-lg">
            <p className="text-gray-600">No transactions yet.</p>
            <p className="mt-2 text-sm text-gray-500">
              Send or receive USDC or XLM to see activity here.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {transactions.map((tx) => (
              <Link
                key={tx.hash}
                href={`/transactions/${tx.hash}`}
                className="block rounded-2xl bg-white p-4 shadow-lg transition hover:shadow-md"
              >
                <div className="flex items-center justify-between">
                  <span className={`font-semibold ${typeColor(tx.type)}`}>
                    {formatTransactionType(tx.type)}
                  </span>
                  <span className="text-xs text-gray-500">{formatDate(tx.createdAt)}</span>
                </div>
                <p className="mt-1 text-sm text-gray-800">{formatTransactionDescription(tx)}</p>
                <p className="mt-2 text-xs text-gray-500">
                  {tx.status === 'success' ? 'Confirmed' : 'Failed'} · Ledger {tx.ledger}
                </p>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
