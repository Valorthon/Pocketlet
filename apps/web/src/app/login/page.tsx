'use client';

import { startAuthentication } from '@simplewebauthn/browser';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Wallet } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const login = async () => {
    setLoading(true);
    setError(null);
    try {
      if (!window.PublicKeyCredential) {
        setError('Passkeys are not supported on this device or browser.');
        return;
      }

      const optionsRes = await fetch('/api/auth/login-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const options = await optionsRes.json();
      if (!optionsRes.ok) {
        setError(options.error ?? 'Failed to start login');
        return;
      }

      const assertion = await startAuthentication({ optionsJSON: options });
      const verifyRes = await fetch('/api/auth/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, response: assertion }),
      });
      const data = (await verifyRes.json()) as { error?: string; verified?: boolean };
      if (!verifyRes.ok) {
        setError(data.error ?? 'Login failed');
        return;
      }
      router.push('/home');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md rounded-3xl border border-slate-100 bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-pocketlet-500 text-white">
            <Wallet className="h-5 w-5" />
          </div>
          <span className="text-lg font-bold tracking-tight text-slate-900">Pocketlet</span>
        </div>

        <h1 className="mb-2 text-2xl font-bold text-slate-900">Welcome back</h1>
        <p className="mb-6 text-sm text-slate-500">Log in with your email and passkey.</p>

        {error && <div className="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            login();
          }}
          className="space-y-4"
        >
          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-700" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 focus:border-pocketlet-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-pocketlet-500"
              placeholder="you@example.com"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-pocketlet-600 py-3 text-sm font-bold text-white hover:bg-pocketlet-700 disabled:opacity-50"
          >
            {loading ? 'Logging in...' : 'Log in with passkey'}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-slate-600">
          Don&apos;t have an account?{' '}
          <a href="/signup" className="font-semibold text-pocketlet-600 hover:underline">
            Sign up
          </a>
        </p>
        <p className="mt-2 text-center text-sm text-slate-600">
          Lost your passkey?{' '}
          <a href="/recover" className="font-semibold text-pocketlet-600 hover:underline">
            Recover your account
          </a>
        </p>
      </div>
    </main>
  );
}
