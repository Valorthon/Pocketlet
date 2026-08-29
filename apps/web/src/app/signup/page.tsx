'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Wallet, Loader2 } from 'lucide-react';
import { createPasskeyKit } from '@/lib/wallet/passkey-kit';
import {
  checkPasskeySupport,
  formatPasskeyKitError,
  logPasskeyKitError,
} from '@/lib/auth/passkey-errors';

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code' | 'passkey'>('email');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  const requestCode = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/email-challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json()) as { error?: string; code?: string; message?: string };
      if (!res.ok) {
        setError(data.error ?? 'Failed to send code');
        return;
      }
      setCode(data.code ?? '');
      setStep('code');
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });
      const data = (await res.json()) as { error?: string; verified?: boolean };
      if (!res.ok) {
        setError(data.error ?? 'Invalid code');
        return;
      }
      setStep('passkey');
    } finally {
      setLoading(false);
    }
  };

  const registerPasskeyAndDeploy = async () => {
    setLoading(true);
    setError(null);
    setCreating(true);

    try {
      const supportError = checkPasskeySupport();
      if (supportError) {
        setError(supportError);
        setCreating(false);
        return;
      }

      const kit = createPasskeyKit();
      const result = await kit.createWallet('Pocketlet', email, {
        authenticatorSelection: {
          residentKey: 'preferred',
          userVerification: 'required',
        },
      });

      const deployRes = await fetch('/api/wallet/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          response: result.rawResponse,
          keyIdBase64: result.keyIdBase64,
          contractId: result.contractId,
          signedTx: result.signedTx,
        }),
      });

      const deployData = (await deployRes.json()) as {
        error?: string;
        contractId?: string;
        stellarAddress?: string;
      };
      if (!deployRes.ok) {
        setError(deployData.error ?? 'Wallet deployment failed');
        setCreating(false);
        return;
      }

      router.push('/pin/setup');
    } catch (err) {
      logPasskeyKitError(err);
      setError(formatPasskeyKitError(err));
      setCreating(false);
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

        <h1 className="mb-2 text-2xl font-bold text-slate-900">Create your Pocketlet</h1>
        <p className="mb-6 text-sm text-slate-500">
          Sign up with your email and register a passkey. No password needed.
        </p>

        {error && <div className="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}

        {step === 'email' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              requestCode();
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
              {loading ? 'Sending…' : 'Send verification code'}
            </button>
          </form>
        )}

        {step === 'code' && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Enter the verification code sent to <strong>{email}</strong>.
            </p>
            <p className="text-xs text-amber-700">
              Testnet mode: the code is also shown below for easy testing.
            </p>
            <div className="rounded-lg bg-slate-100 p-3 text-center font-mono text-lg tracking-widest text-slate-900">
              {code}
            </div>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-center font-mono text-lg tracking-widest text-slate-900 focus:border-pocketlet-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-pocketlet-500"
              placeholder="000000"
            />
            <button
              onClick={verifyCode}
              disabled={loading}
              className="w-full rounded-xl bg-pocketlet-600 py-3 text-sm font-bold text-white hover:bg-pocketlet-700 disabled:opacity-50"
            >
              {loading ? 'Verifying…' : 'Verify email'}
            </button>
          </div>
        )}

        {step === 'passkey' && (
          <div className="space-y-4">
            {!creating ? (
              <>
                <p className="text-sm text-slate-600">
                  Your email is verified. Register a passkey to create your wallet.
                </p>
                <button
                  onClick={registerPasskeyAndDeploy}
                  disabled={loading}
                  className="w-full rounded-xl bg-pocketlet-600 py-3 text-sm font-bold text-white hover:bg-pocketlet-700 disabled:opacity-50"
                >
                  {loading ? 'Creating…' : 'Create passkey and wallet'}
                </button>
              </>
            ) : (
              <div className="flex flex-col items-center gap-3 py-4">
                <Loader2 className="h-6 w-6 animate-spin text-pocketlet-600" />
                <div className="text-center">
                  <p className="text-sm font-bold text-slate-900">Creating your passkey</p>
                  <p className="text-xs text-slate-500">
                    You may be prompted to use your device biometric or security key.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
