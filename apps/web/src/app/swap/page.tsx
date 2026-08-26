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
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md rounded-3xl border border-slate-100 bg-white p-6 text-center shadow-lg">
        <h1 className="mb-2 text-xl font-bold text-slate-900">Swaps coming soon</h1>
        <p className="mb-4 text-sm text-slate-600">
          USDC ↔ XLM swaps are being rebuilt for the new passkey-kit wallet. You can still send
          and receive USDC and XLM from the home screen.
        </p>
        <Link
          href="/home"
          className="inline-block rounded-xl bg-pocketlet-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-pocketlet-700"
        >
          Back to home
        </Link>
      </div>
    </main>
  );
}
