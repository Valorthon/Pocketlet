import Link from 'next/link';
import { Wallet } from 'lucide-react';

export default function LandingPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6 text-center">
      <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-pocketlet-500 text-white shadow-lg shadow-pocketlet-200">
        <Wallet className="h-7 w-7" />
      </div>
      <h1 className="mb-4 text-4xl font-bold tracking-tight text-pocketlet-600">Pocketlet</h1>
      <p className="mb-8 max-w-md text-slate-600">
        A simple, passkey-powered wallet for USDC and XLM on Stellar testnet. Built for anyone who
        earns and moves money across borders.
      </p>
      <div className="flex gap-4">
        <Link
          href="/signup"
          className="rounded-xl bg-pocketlet-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-pocketlet-100 hover:bg-pocketlet-700"
        >
          Sign up
        </Link>
        <Link
          href="/login"
          className="rounded-xl bg-white px-6 py-3 text-sm font-bold text-pocketlet-600 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50"
        >
          Log in
        </Link>
      </div>
    </main>
  );
}
