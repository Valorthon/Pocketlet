'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowDownLeft, Send } from 'lucide-react';
import { CurrencyDisplay } from '@/components/ui/CurrencyDisplay';
import { TransactionListItem } from '@/components/ui/TransactionListItem';
import { WalletTransaction } from '@/lib/wallet/transactions';

interface BalanceData {
  xlm: string;
  usdc: string;
  contractId: string;
  stellarAddress: string;
}

export default function HomePage() {
  const router = useRouter();
  const [data, setData] = useState<BalanceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hideBalance, setHideBalance] = useState(false);
  const [recent, setRecent] = useState<WalletTransaction[]>([]);

  const fetchBalance = async () => {
    const res = await fetch('/api/wallet/balance');
    if (res.status === 401) {
      router.push('/login');
      return;
    }
    if (!res.ok) {
      const body = (await res.json()) as { error?: string };
      setError(body.error ?? 'Failed to load wallet');
      setLoading(false);
      return;
    }
    setData(await res.json());
    setError(null);
    setLoading(false);
  };

  const fetchRecent = async () => {
    try {
      const res = await fetch('/api/wallet/transactions');
      if (res.status === 401) {
        router.push('/login');
        return;
      }
      if (!res.ok) return;
      const body = (await res.json()) as { transactions: WalletTransaction[] };
      setRecent(body.transactions.slice(0, 3));
    } catch {
      setRecent([]);
    }
  };

  useEffect(() => {
    fetchBalance();
    fetchRecent();
    const id = setInterval(() => fetchBalance(), 15000);
    return () => clearInterval(id);
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-slate-600">Loading your wallet...</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-lg">
          <h1 className="mb-2 text-xl font-semibold text-rose-600">Wallet unavailable</h1>
          <p className="text-slate-600">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 rounded-lg bg-pocketlet-600 px-4 py-2 text-white hover:bg-pocketlet-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const usdcNumber = Number(data.usdc) / 10_000_000;
  const xlmNumber = Number(data.xlm) / 10_000_000;

  return (
    <div className="flex flex-col gap-6 pb-6">
      <CurrencyDisplay
        usdcAmount={usdcNumber}
        xlmAmount={xlmNumber}
        hideBalance={hideBalance}
        onToggleHide={() => setHideBalance(!hideBalance)}
      />

      <div className="grid grid-cols-2 gap-2 px-1">
        <Link
          href="/send"
          className="flex flex-col items-center gap-2 transition-all active:scale-95"
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-pocketlet-600 text-white shadow-lg shadow-pocketlet-200">
            <Send className="h-6 w-6" />
          </div>
          <span className="text-xs font-semibold text-slate-700">Send</span>
        </Link>

        <Link
          href="/receive"
          className="flex flex-col items-center gap-2 transition-all active:scale-95"
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-pocketlet-100 text-pocketlet-600">
            <ArrowDownLeft className="h-6 w-6" />
          </div>
          <span className="text-xs font-semibold text-slate-700">Receive</span>
        </Link>
      </div>

      <div className="-mx-6 flex-1 rounded-t-[32px] bg-slate-50/70 px-4 pb-2 pt-5">
        <div className="mb-3 flex items-center justify-between px-2">
          <h3 className="text-sm font-bold text-slate-800">Recent Activity</h3>
          <Link href="/transactions" className="text-xs font-bold text-pocketlet-600 hover:underline">
            See all
          </Link>
        </div>

        {recent.length === 0 ? (
          <div className="rounded-2xl bg-white p-6 text-center shadow-sm">
            <p className="text-sm text-slate-500">No transactions yet.</p>
            <p className="mt-1 text-xs text-slate-400">
              Send or receive USDC or XLM to see activity here.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {recent.map((tx) => (
              <TransactionListItem
                key={tx.hash}
                transaction={tx}
                onClick={() => router.push(`/transactions/${tx.hash}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
