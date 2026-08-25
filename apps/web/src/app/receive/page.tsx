'use client';

import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, Check } from 'lucide-react';

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
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md rounded-2xl bg-white p-8 shadow-lg text-center">
          <p className="text-red-600">{error}</p>
        </div>
      </main>
    );
  }

  if (!address) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="text-gray-600">Loading receive address...</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-md rounded-2xl bg-white p-8 shadow-lg text-center">
        <h1 className="mb-2 text-2xl font-bold text-pocketlet-600">Receive</h1>
        <p className="mb-6 text-sm text-gray-500">
          Share this address or QR code to receive USDC or XLM on Stellar testnet.
        </p>

        <div className="mx-auto mb-6 w-fit rounded-2xl bg-white p-3 shadow-md">
          <QRCodeSVG value={address} size={200} />
        </div>

        <div className="flex items-center gap-2 rounded-lg bg-gray-100 p-3">
          <code className="flex-1 break-all text-left text-sm text-gray-700">{address}</code>
          <button
            onClick={copy}
            className="rounded-md p-2 text-gray-600 hover:bg-gray-200"
            aria-label="Copy address"
          >
            {copied ? <Check size={18} className="text-green-600" /> : <Copy size={18} />}
          </button>
        </div>

        <p className="mt-6 text-xs text-gray-500">
          Only send USDC or XLM on Stellar testnet to this address.
        </p>
      </div>
    </main>
  );
}
