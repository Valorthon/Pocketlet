'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { formatCurrency } from '@/lib/utils';
import {
  TransactionDetails,
  explorerUrl,
  formatTransactionType,
} from '@/lib/wallet/transactions';

interface Params {
  hash: string;
}

function toCurrency(asset: string): 'USDC' | 'XLM' {
  return asset === 'XLM' ? 'XLM' : 'USDC';
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

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="text-slate-600">Loading transaction...</div>
      </main>
    );
  }

  if (error || !tx) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-lg">
          <h1 className="mb-2 text-xl font-semibold text-rose-600">Transaction not found</h1>
          <p className="text-slate-600">{error}</p>
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

  const isReceive = tx.type === 'receive';
  const amountDisplay = `${isReceive ? '+' : '-'}${formatCurrency(tx.amount, toCurrency(tx.asset))}`;

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-md">
        <div className="mb-6 flex items-center justify-between">
          <Link href="/transactions" className="text-2xl font-bold text-pocketlet-600">
            ← Transaction details
          </Link>
        </div>

        <Card padded="md" className="space-y-4">
          <div className="py-2 text-center">
            <p className="text-3xl font-extrabold text-slate-900">{amountDisplay}</p>
            <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {tx.status === 'success' ? 'Completed on Stellar' : 'Failed'}
            </span>
          </div>

          <div className="space-y-2.5 rounded-2xl border border-slate-100 bg-slate-50 p-4 text-xs">
            <div className="flex justify-between border-b border-slate-200/60 py-1">
              <span className="text-slate-400">Type</span>
              <span className="font-semibold text-slate-900">{formatTransactionType(tx.type)}</span>
            </div>
            <div className="flex justify-between border-b border-slate-200/60 py-1">
              <span className="text-slate-400">Timestamp</span>
              <span className="text-slate-900">{formatDate(tx.createdAt)}</span>
            </div>
            <div className="flex justify-between border-b border-slate-200/60 py-1">
              <span className="text-slate-400">Network fee</span>
              <span className="font-bold text-emerald-700">{tx.fee} stroops</span>
            </div>
            <div className="flex justify-between border-b border-slate-200/60 py-1">
              <span className="text-slate-400">Stellar ledger #</span>
              <span className="font-mono text-slate-900">{tx.ledger}</span>
            </div>
            {tx.memo && (
              <div className="flex justify-between border-b border-slate-200/60 py-1">
                <span className="text-slate-400">Memo</span>
                <span className="font-mono text-slate-900">{tx.memo}</span>
              </div>
            )}
            {tx.recipient && (
              <div className="flex justify-between border-b border-slate-200/60 py-1">
                <span className="text-slate-400">Recipient</span>
                <span className="max-w-[60%] break-all text-right font-mono text-slate-900">
                  {tx.recipient}
                </span>
              </div>
            )}
            {tx.sender && (
              <div className="flex justify-between border-b border-slate-200/60 py-1">
                <span className="text-slate-400">Sender</span>
                <span className="max-w-[60%] break-all text-right font-mono text-slate-900">
                  {tx.sender}
                </span>
              </div>
            )}
            <div className="flex justify-between py-1">
              <span className="text-slate-400">Tx hash</span>
              <span className="max-w-[60%] break-all text-right font-mono text-slate-900">
                {tx.hash}
              </span>
            </div>
          </div>

          <a
            href={explorerUrl(tx.hash)}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-center text-sm font-semibold text-pocketlet-600 hover:text-pocketlet-700"
          >
            View on Stellar Expert →
          </a>

          <Button variant="outline" fullWidth onClick={() => router.push('/transactions')}>
            Done
          </Button>
        </Card>
      </div>
    </main>
  );
}
