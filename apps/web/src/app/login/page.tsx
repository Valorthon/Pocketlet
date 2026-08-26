'use client';

import { startAuthentication } from '@simplewebauthn/browser';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

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
    <main className="flex min-h-screen flex-col items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-lg">
        <h1 className="mb-2 text-2xl font-bold text-pocketlet-600">Welcome back</h1>
        <p className="mb-6 text-sm text-gray-500">Log in with your email and passkey.</p>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            login();
          }}
          className="space-y-4"
        >
          <label className="block text-sm font-medium text-gray-700" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-pocketlet-500 focus:outline-none focus:ring-2 focus:ring-pocketlet-100"
            placeholder="you@example.com"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-pocketlet-600 py-2.5 font-semibold text-white hover:bg-pocketlet-700 disabled:opacity-50"
          >
            {loading ? 'Logging in...' : 'Log in with passkey'}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-gray-600">
          Don&apos;t have an account?{' '}
          <a href="/signup" className="text-pocketlet-600 hover:underline">
            Sign up
          </a>
        </p>
        <p className="mt-2 text-center text-sm text-gray-600">
          Lost your passkey?{' '}
          <a href="/recover" className="text-pocketlet-600 hover:underline">
            Recover your account
          </a>
        </p>
      </div>
    </main>
  );
}
