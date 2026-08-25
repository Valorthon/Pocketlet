'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import PinModal from '@/components/PinModal';
import { baseUnitsToDisplay } from '@/lib/wallet/amount';
import { clearSessionKey } from '@/lib/wallet/session-key';

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
  const [refreshing, setRefreshing] = useState(false);
  const [hasPin, setHasPin] = useState<boolean | null>(null);
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [pinToast, setPinToast] = useState<string | null>(null);

  const fetchBalance = async (isBackground = false) => {
    if (!isBackground) {
      setRefreshing(true);
    }
    const res = await fetch('/api/wallet/balance');
    if (res.status === 401) {
      router.push('/login');
      return;
    }
    if (!res.ok) {
      const body = (await res.json()) as { error?: string };
      setError(body.error ?? 'Failed to load wallet');
      setLoading(false);
      setRefreshing(false);
      return;
    }
    setData(await res.json());
    setError(null);
    setLoading(false);
    setRefreshing(false);
  };

  const fetchPinStatus = async () => {
    const res = await fetch('/api/auth/pin');
    if (res.ok) {
      const body = (await res.json()) as { hasPin?: boolean };
      setHasPin(body.hasPin ?? false);
    }
  };

  useEffect(() => {
    fetchBalance(true);
    fetchPinStatus();
    const id = setInterval(() => fetchBalance(true), 15000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!pinToast) {
      return;
    }
    const id = setTimeout(() => setPinToast(null), 3000);
    return () => clearTimeout(id);
  }, [pinToast]);

  const logout = async () => {
    await clearSessionKey();
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="text-gray-600">Loading your wallet...</div>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md rounded-2xl bg-white p-8 shadow-lg text-center">
          <h1 className="mb-2 text-xl font-semibold text-red-600">Wallet unavailable</h1>
          <p className="text-gray-600">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 rounded-lg bg-pocketlet-600 px-4 py-2 text-white hover:bg-pocketlet-700"
          >
            Retry
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-md">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-pocketlet-600">Pocketlet</h1>
          <div className="flex items-center gap-4">
            <Link
              href="/profile"
              className="text-sm font-medium text-pocketlet-600 hover:text-pocketlet-700"
            >
              Profile
            </Link>
            <button
              onClick={logout}
              className="text-sm text-gray-500 underline hover:text-gray-700"
            >
              Log out
            </button>
          </div>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm text-gray-500">Total balance</p>
            <button
              onClick={() => fetchBalance()}
              disabled={refreshing}
              aria-label="Refresh balance"
              className="rounded-full p-1.5 text-gray-400 hover:bg-gray-100 hover:text-pocketlet-600 disabled:opacity-50"
            >
              <RefreshCw size={18} className={refreshing ? 'animate-spin' : ''} />
            </button>
          </div>
          <div className="text-3xl font-bold text-gray-900">
            {baseUnitsToDisplay(data.usdc)} USDC
          </div>
          <div className="mt-1 text-sm text-gray-500">
            {baseUnitsToDisplay(data.xlm)} XLM
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3">
            <Link
              href="/receive"
              className="rounded-lg bg-pocketlet-100 py-3 text-center font-semibold text-pocketlet-700 hover:bg-pocketlet-200"
            >
              Receive
            </Link>
            <Link
              href="/send"
              className="rounded-lg bg-pocketlet-100 py-3 text-center font-semibold text-pocketlet-700 hover:bg-pocketlet-200"
            >
              Send
            </Link>
          </div>
        </div>

        <Link
          href="/transactions"
          className="mt-6 block rounded-2xl bg-white p-6 shadow-lg transition hover:shadow-md"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">Activity</h2>
            <span className="text-pocketlet-600">→</span>
          </div>
          <p className="mt-1 text-sm text-gray-500">View your transaction history and details.</p>
        </Link>

        <div className="mt-6 rounded-2xl bg-white p-6 shadow-lg">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-gray-700">Security</h2>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                hasPin ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
              }`}
            >
              {hasPin ? 'PIN set' : 'No PIN'}
            </span>
          </div>
          <div className="space-y-3">
            <Link
              href={hasPin ? '/pin/reset' : '/pin/setup'}
              className="block rounded-lg bg-pocketlet-100 py-2.5 text-center font-semibold text-pocketlet-700 hover:bg-pocketlet-200"
            >
              {hasPin ? 'Reset PIN' : 'Set up PIN'}
            </Link>
            <button
              onClick={() => setPinModalOpen(true)}
              disabled={!hasPin}
              className="w-full rounded-lg bg-gray-100 py-2.5 font-semibold text-gray-700 hover:bg-gray-200 disabled:opacity-50 disabled:hover:bg-gray-100"
            >
              Test PIN confirmation
            </button>
          </div>
        </div>
      </div>

      {pinToast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-green-600 px-4 py-2 text-sm font-medium text-white shadow-lg">
          {pinToast}
        </div>
      )}

      <PinModal
        isOpen={pinModalOpen}
        title="Test PIN confirmation"
        onConfirm={() => {
          setPinModalOpen(false);
          setPinToast('PIN confirmed successfully');
        }}
        onCancel={() => setPinModalOpen(false)}
      />
    </main>
  );
}
