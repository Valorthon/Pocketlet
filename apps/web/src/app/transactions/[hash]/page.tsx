'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  TransactionDetails,
  explorerUrl,
  formatTransactionDescription,
  formatTransactionType,
} from '@/lib/wallet/transactions';

interface Params {
  hash: string;
}

export default function TransactionDetailsPage({ params }: { params: Params }) {
  const router = useRouter();
  const { hash } = params;
  const [tx, setTx] = useState<TransactionDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchDetails = async () => {
      const res = await fetch(`/api/wallet/transactions/detail?hash=${encodeURIComponent(hash)}`);
      if (res.status === 401) {
        router.push('/login');
        return;
      }
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        setError(body.error ?? 'Failed to load transaction details');
        setLoading(false);
        return;
      }
      setTx(await res.json());
      setLoading(false);
    };

    fetchDetails();
  }, [hash]);

  const formatDate = (value: string) => {
    return new Date(value).toLocaleString();
  };

  const typeColor = (type: TransactionDetails['type']) => {
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
        <div className="text-gray-600">Loading transaction...</div>
      </main>
    );
  }

  if (error || !tx) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-lg">
          <h1 className="mb-2 text-xl font-semibold text-red-600">Transaction not found</h1>
          <p className="text-gray-600">{error}</p>
          <Link
            href="/transactions"
            className="mt-4 inline-block rounded-lg bg-pocketlet-600 px-4 py-2 text-white hover:bg-pocketlet-700"
          >
            Back to activity
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-md">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-pocketlet-600">Transaction details</h1>
          <Link href="/transactions" className="text-sm text-gray-500 underline hover:text-gray-700">
            Back
          </Link>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-lg">
          <div className="mb-4 flex items-center justify-between">
            <span className={`text-lg font-semibold ${typeColor(tx.type)}`}>
              {formatTransactionType(tx.type)}
            </span>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                tx.status === 'success'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-red-100 text-red-700'
              }`}
            >
              {tx.status === 'success' ? 'Confirmed' : 'Failed'}
            </span>
          </div>

          <p className="text-xl font-bold text-gray-900">{formatTransactionDescription(tx)}</p>
          <p className="mt-1 text-sm text-gray-500">{formatDate(tx.createdAt)}</p>

          <hr className="my-4 border-gray-100" />

          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">Asset</dt>
              <dd className="font-medium text-gray-900">{tx.asset}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Amount</dt>
              <dd className="font-medium text-gray-900">{tx.amount}</dd>
            </div>
            {tx.recipient && (
              <div className="flex justify-between">
                <dt className="text-gray-500">Recipient</dt>
                <dd className="max-w-[60%] break-all text-right font-mono text-xs text-gray-900">
                  {tx.recipient}
                </dd>
              </div>
            )}
            {tx.sender && (
              <div className="flex justify-between">
                <dt className="text-gray-500">Sender</dt>
                <dd className="max-w-[60%] break-all text-right font-mono text-xs text-gray-900">
                  {tx.sender}
                </dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-gray-500">Network fee</dt>
              <dd className="font-medium text-gray-900">{tx.fee} stroops</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Ledger</dt>
              <dd className="font-medium text-gray-900">{tx.ledger}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">Operations</dt>
              <dd className="font-medium text-gray-900">{tx.operationCount}</dd>
            </div>
            {tx.memo && (
              <div className="flex justify-between">
                <dt className="text-gray-500">Memo</dt>
                <dd className="font-medium text-gray-900">{tx.memo}</dd>
              </div>
            )}
          </dl>

          <hr className="my-4 border-gray-100" />

          <div>
            <h3 className="mb-1 text-sm font-medium text-gray-700">On-chain hash</h3>
            <div className="break-all rounded-lg bg-gray-100 p-3 text-xs font-mono text-gray-700">
              {tx.hash}
            </div>
            <a
              href={explorerUrl(tx.hash)}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block text-sm font-semibold text-pocketlet-600 hover:text-pocketlet-700"
            >
              View on Stellar Expert →
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}
