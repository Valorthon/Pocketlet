'use client';

import Link from 'next/link';

/**
 * Lost-passkey recovery is being rebuilt for the passkey-kit wallet. The
 * previous flow relied on a platform recovery admin that could rotate the
 * wallet owner on the deleted custom smart contract.
 *
 * The replacement flow (Phase 1b) will use a BIP39 recovery phrase and an
 * optional backup passkey to let users recover access without platform custody.
 */
export default function RecoverPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-lg text-center">
        <h1 className="mb-2 text-2xl font-bold text-gray-900">Recovery is being rebuilt</h1>
        <p className="mb-6 text-sm text-gray-600">
          Lost-passkey recovery is temporarily unavailable while we move to a
          self-custodial recovery phrase + backup passkey model.
        </p>
        <Link
          href="/login"
          className="inline-block rounded-lg bg-pocketlet-600 px-4 py-2 font-semibold text-white hover:bg-pocketlet-700"
        >
          Back to login
        </Link>
      </div>
    </main>
  );
}
