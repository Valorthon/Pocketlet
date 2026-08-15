'use client';

import Link from 'next/link';

/**
 * Swaps are deferred to a future phase. The DEX integration currently pointed
 * to a deleted `mock_dex` contract and needs to be rebuilt around a real
 * Stellar DEX/AMM quote-and-swap flow using passkey-kit signing and the
 * platform fee payer.
 *
 * See FUTURE_VERSIONS.md (V3 — Cross-Asset Swaps) for the deferred roadmap.
 */
export default function SwapPage() {
  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-md">
        <div className="mb-6 flex items-center justify-between">
          <Link href="/home" className="text-2xl font-bold text-pocketlet-600">
            ← Pocketlet
          </Link>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-lg text-center">
          <h1 className="mb-2 text-xl font-semibold text-gray-900">Swaps coming soon</h1>
          <p className="mb-4 text-sm text-gray-600">
            USDC ↔ XLM swaps are being rebuilt for the new passkey-kit wallet.
            You can still send and receive USDC and XLM from the home screen.
          </p>
          <Link
            href="/home"
            className="inline-block rounded-lg bg-pocketlet-600 px-6 py-2.5 font-semibold text-white hover:bg-pocketlet-700"
          >
            Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}
