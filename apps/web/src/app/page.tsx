import Link from 'next/link';

export default function LandingPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 text-center">
      <h1 className="mb-4 text-4xl font-bold text-pocketlet-600">Pocketlet</h1>
      <p className="mb-8 max-w-md text-gray-600">
        A simple, passkey-powered wallet for USDC and XLM on Stellar testnet.
        Built for anyone who earns and moves money across borders.
      </p>
      <div className="flex gap-4">
        <Link
          href="/signup"
          className="rounded-lg bg-pocketlet-600 px-6 py-3 font-semibold text-white hover:bg-pocketlet-700"
        >
          Sign up
        </Link>
        <Link
          href="/login"
          className="rounded-lg bg-white px-6 py-3 font-semibold text-pocketlet-600 shadow hover:bg-gray-50"
        >
          Log in
        </Link>
      </div>
    </main>
  );
}
