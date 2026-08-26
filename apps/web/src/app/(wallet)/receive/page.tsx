'use client';

import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Copy } from 'lucide-react';
import { truncateAddress } from '@/lib/utils';

export default function ReceivePage() {
  const router = useRouter();
  const [address, setAddress] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/wallet/balance')
      .then((res) => {
        if (res.status === 401) {
          router.push('/login');
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (data && data.stellarAddress) {
          setAddress(data.stellarAddress);
        } else if (data && data.error) {
          setError(data.error);
        }
      })
      .catch(() => setError('Failed to load wallet address'));
  }, []);

  const copy = () => {
    if (address) {
      navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-lg">
          <p className="text-rose-600">{error}</p>
        </div>
      </div>
    );
  }

  if (!address) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-slate-600">Loading receive address...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 pb-6 text-center">
      <h3 className="text-left text-base font-bold text-slate-900">Receive Money</h3>

      <div className="flex flex-col items-center rounded-3xl border border-slate-100 bg-white p-6 shadow-sm">
        <div className="w-fit rounded-2xl bg-white p-3 shadow-md">
          <QRCodeSVG value={address} size={176} />
        </div>

        <div className="mt-4 w-full text-left">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Stellar Public Address
          </span>
          <div className="mt-1 flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 p-2 text-xs font-mono text-slate-700">
            <span className="truncate text-[11px]">{truncateAddress(address, 5)}</span>
            <button
              onClick={copy}
              className="ml-2 flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-100"
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3 text-emerald-600" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3 text-slate-400" />
                  Copy
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      <p className="px-2 text-xs leading-relaxed text-slate-400">
        Anyone can send you USDC or XLM directly from Binance, Coinbase, or any Stellar wallet.
      </p>
    </div>
  );
}
