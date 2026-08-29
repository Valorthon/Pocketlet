'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowDownLeft, Send, Loader2, X, ShieldAlert, ShieldCheck, Gift } from 'lucide-react';
import { CurrencyDisplay } from '@/components/ui/CurrencyDisplay';
import { TransactionListItem } from '@/components/ui/TransactionListItem';
import { WalletTransaction } from '@/lib/wallet/transactions';
import PinModal from '@/components/PinModal';
import { createPasskeyKit } from '@/lib/wallet/passkey-kit';
import { getUsdcContractId } from '@/lib/wallet/assets';
import { hasUsableDeviceKey, getDeviceSigner } from '@/lib/wallet/device-key';
import { prepareEscrowClaimTx } from '@/lib/wallet/escrow';

interface BalanceData {
  xlm: string;
  usdc: string;
  contractId: string;
  stellarAddress: string;
}

interface UserStatus {
  recoveryPublicKey: string | null;
  recoveryPhraseConfirmed: boolean;
}

interface PendingClaim {
  id: string;
  senderEmail: string;
  tokenContractId: string;
  amount: string;
  expiry: string;
  createdAt: string;
}

const BANNER_DISMISS_KEY = 'pocketlet:setupBannerDismissedAt';
const BANNER_DISMISS_TTL_MS = 24 * 60 * 60 * 1000;

function SetupBanner() {
  const [status, setStatus] = useState<UserStatus | null>(null);
  const [phase, setPhase] = useState<'loading' | 'pending' | 'timeout' | 'confirm' | 'complete'>('loading');
  const [visible, setVisible] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = useRef<number>(0);

  const checkDismissed = useCallback(() => {
    const raw = localStorage.getItem(BANNER_DISMISS_KEY);
    if (!raw) return false;
    const at = Number(raw);
    return !Number.isNaN(at) && Date.now() - at < BANNER_DISMISS_TTL_MS;
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (!res.ok) return;
      const body = (await res.json()) as { user: UserStatus };
      setStatus(body.user);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (checkDismissed()) {
      setVisible(false);
      return;
    }
    void fetchStatus();
  }, [checkDismissed, fetchStatus]);

  useEffect(() => {
    if (!status) return;

    if (status.recoveryPublicKey && status.recoveryPhraseConfirmed) {
      setPhase('complete');
      return;
    }
    if (status.recoveryPublicKey && !status.recoveryPhraseConfirmed) {
      setPhase('confirm');
      return;
    }

    setPhase('pending');
  }, [status]);

  useEffect(() => {
    if (phase !== 'pending') {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    startRef.current = Date.now();
    intervalRef.current = setInterval(async () => {
      await fetchStatus();
      if (Date.now() - startRef.current > 30_000) {
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        setPhase('timeout');
      }
    }, 5000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [phase, fetchStatus]);

  useEffect(() => {
    if (phase === 'complete') {
      const t = setTimeout(() => setVisible(false), 2000);
      return () => clearTimeout(t);
    }
  }, [phase]);

  if (!visible || phase === 'complete') return null;

  const dismiss = () => {
    localStorage.setItem(BANNER_DISMISS_KEY, String(Date.now()));
    setVisible(false);
  };

  return (
    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
      <div className="flex items-start gap-3">
        {phase === 'pending' ? (
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-amber-600" />
        ) : phase === 'timeout' ? (
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        ) : (
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
        )}
        <div className="flex-1">
          <p className="text-xs font-semibold text-amber-800">
            {phase === 'pending' && 'Finishing wallet setup…'}
            {phase === 'timeout' && 'Wallet setup incomplete'}
            {phase === 'confirm' && 'Save your recovery phrase'}
          </p>
          <p className="mt-0.5 text-[10px] text-amber-700">
            {phase === 'pending' && 'Your recovery key is being registered on-chain.'}
            {phase === 'timeout' && 'Something went wrong during setup. You can retry from your profile.'}
            {phase === 'confirm' && 'Confirm your recovery phrase to finish securing your wallet.'}
          </p>
          {phase === 'timeout' && (
            <Link
              href="/recovery/setup"
              className="mt-1 inline-block text-[10px] font-bold text-amber-800 underline"
            >
              Secure my wallet
            </Link>
          )}
          {phase === 'confirm' && (
            <Link
              href="/recovery-phrase"
              className="mt-1 inline-block text-[10px] font-bold text-blue-700 underline"
            >
              View recovery phrase
            </Link>
          )}
        </div>
        <button onClick={dismiss} className="rounded p-1 text-amber-600 hover:bg-amber-100">
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

export default function HomePage() {
  const router = useRouter();
  const [data, setData] = useState<BalanceData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [hideBalance, setHideBalance] = useState(false);
  const [recent, setRecent] = useState<WalletTransaction[]>([]);
  const [pendingClaims, setPendingClaims] = useState<PendingClaim[]>([]);
  const [claimLoading, setClaimLoading] = useState<string | null>(null);
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [activeClaimId, setActiveClaimId] = useState<string | null>(null);

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

  const fetchPendingClaims = async () => {
    try {
      const res = await fetch('/api/wallet/claim-links/pending');
      if (!res.ok) return;
      const body = (await res.json()) as { claims: PendingClaim[] };
      setPendingClaims(body.claims);
    } catch {
      setPendingClaims([]);
    }
  };

  useEffect(() => {
    fetchBalance();
    fetchRecent();
    fetchPendingClaims();
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

  const startClaim = (claimId: string) => {
    setActiveClaimId(claimId);
    setPinModalOpen(true);
  };

  const executeClaim = async (pin: string) => {
    setPinModalOpen(false);
    if (!activeClaimId || !data) return;
    setClaimLoading(activeClaimId);

    try {
      const res = await fetch('/api/wallet/claim-links/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claimLinkId: activeClaimId }),
      });

      const body = (await res.json()) as { error?: string; secret?: string; claimHash?: string; amount?: string; tokenContractId?: string };
      if (!res.ok || !body.secret) {
        alert(body.error ?? 'Failed to retrieve claim secret');
        setClaimLoading(null);
        return;
      }

      if (!(await hasUsableDeviceKey())) {
        alert('Device key expired. Please log in again.');
        setClaimLoading(null);
        return;
      }

      const kit = createPasskeyKit();
      const infoRes = await fetch('/api/wallet/session-key/info');
      const info = (await infoRes.json()) as { primaryPasskeyKeyId: string };
      await kit.connectWallet({ keyId: info.primaryPasskeyKeyId });

      if (!kit.contractId) {
        alert('Wallet not connected');
        setClaimLoading(null);
        return;
      }

      const tx = await prepareEscrowClaimTx(
        { publicKey: kit.contractId },
        body.secret,
        kit.contractId
      );

      const signer = await getDeviceSigner(pin);
      await kit.sign(tx, signer);
      const signedXdr = tx.toXDR();

      const submitRes = await fetch('/api/wallet/claim-links/claim-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claimLinkId: activeClaimId, signedXdr }),
      });

      const submitBody = (await submitRes.json()) as { error?: string; hash?: string };
      if (!submitRes.ok) {
        alert(submitBody.error ?? 'Claim failed');
        setClaimLoading(null);
        return;
      }

      await fetchPendingClaims();
      await fetchBalance();
      router.push(`/transactions/${submitBody.hash}`);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Claim failed');
    } finally {
      setClaimLoading(null);
      setActiveClaimId(null);
    }
  };

  return (
    <div className="flex flex-col gap-6 pb-6">
      <SetupBanner />

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

      {pendingClaims.length > 0 && (
        <div className="px-1">
          <h3 className="mb-2 text-sm font-bold text-slate-800">Pending Claims</h3>
          <div className="space-y-2">
            {pendingClaims.map((claim) => (
              <div
                key={claim.id}
                className="flex items-center justify-between rounded-2xl bg-white p-4 shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
                    <Gift className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900">
                      {(Number(claim.amount) / 10_000_000).toLocaleString(undefined, { maximumFractionDigits: 7 })}{' '}
                      {claim.tokenContractId === getUsdcContractId() ? 'USDC' : 'XLM'}
                    </p>
                    <p className="text-xs text-slate-500">
                      From {claim.senderEmail} · Expires {new Date(claim.expiry).toLocaleDateString()}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => startClaim(claim.id)}
                  disabled={claimLoading === claim.id}
                  className="rounded-xl bg-pocketlet-600 px-4 py-2 text-xs font-bold text-white hover:bg-pocketlet-700 disabled:opacity-50"
                >
                  {claimLoading === claim.id ? 'Claiming…' : 'Claim'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

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

      <PinModal
        isOpen={pinModalOpen}
        title="Claim funds"
        subtitle="Enter your 6-digit PIN to authorize."
        onConfirm={executeClaim}
        onCancel={() => {
          setPinModalOpen(false);
          setActiveClaimId(null);
        }}
      />
    </div>
  );
}
