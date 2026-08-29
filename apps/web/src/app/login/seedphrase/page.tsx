'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Wallet, KeyRound } from 'lucide-react';
import { PinKeypad } from '@/components/ui/PinKeypad';
import { deriveRecoveryKeypair, isValidRecoveryPhrase } from '@/lib/wallet/recovery';
import { ensureDeviceKey } from '@/lib/wallet/device-key';
import { connectPasskeyKitByContractId, createPasskeyKit, Ed25519Signer } from '@/lib/wallet/passkey-kit';

export default function SeedphraseLoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const email = searchParams.get('email') ?? '';

  const [step, setStep] = useState<'phrase' | 'setup'>('phrase');
  const [phrase, setPhrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!email) {
      router.push('/login');
    }
  }, [email, router]);

  const loginWithSeedphrase = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const trimmed = phrase.trim();
      if (!isValidRecoveryPhrase(trimmed)) {
        setError('Invalid recovery phrase. Please enter all 12 words in order.');
        return;
      }

      const kp = deriveRecoveryKeypair(trimmed);
      const publicKey = kp.publicKey();

      const challengeRes = await fetch('/api/auth/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const challengeData = (await challengeRes.json()) as {
        error?: string;
        challenge?: string;
      };
      if (!challengeRes.ok) {
        setError(challengeData.error ?? 'Failed to start login');
        return;
      }

      const challenge = Buffer.from(challengeData.challenge ?? '', 'base64');
      const signature = kp.sign(challenge);

      const loginRes = await fetch('/api/auth/login-seedphrase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          challenge: challengeData.challenge,
          signature: signature.toString('base64'),
          publicKey,
        }),
      });
      const loginData = (await loginRes.json()) as { error?: string };
      if (!loginRes.ok) {
        setError(loginData.error ?? 'Login failed');
        return;
      }

      setStep('setup');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }, [email, phrase]);

  const setupDeviceKey = async (pin: string) => {
    setLoading(true);
    setError(null);
    try {
      const pinRes = await fetch('/api/auth/pin/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      const pinData = (await pinRes.json()) as { error?: string };
      if (!pinRes.ok) {
        setError(pinData.error ?? 'Incorrect PIN');
        return;
      }

      const infoRes = await fetch('/api/wallet/session-key/info');
      if (!infoRes.ok) {
        setError('Failed to load wallet info');
        return;
      }
      const info = (await infoRes.json()) as {
        walletContractId: string;
        primaryPasskeyKeyId: string;
      };

      const kit = createPasskeyKit();
      connectPasskeyKitByContractId(kit, info.walletContractId);

      const recoveryKp = deriveRecoveryKeypair(phrase.trim());
      const recoverySigner = Ed25519Signer.fromSecret(recoveryKp.secret());
      await ensureDeviceKey(kit, pin, email, recoverySigner);

      router.push('/home');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Device setup failed');
    } finally {
      setLoading(false);
    }
  };

  if (step === 'setup') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-sm rounded-3xl border border-slate-100 bg-white p-8 shadow-sm">
          <div className="mb-6 flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-pocketlet-500 text-white">
              <Wallet className="h-5 w-5" />
            </div>
            <span className="text-lg font-bold tracking-tight text-slate-900">Pocketlet</span>
          </div>

          <h1 className="mb-2 text-2xl font-bold text-slate-900">Set up this device</h1>
          <p className="mb-6 text-sm text-slate-500">
            Enter your PIN to register this device for quick unlock.
          </p>

          {error && (
            <div className="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</div>
          )}

          <PinKeypad
            title=""
            subtitle="Enter your 6-digit PIN"
            disabled={loading}
            error={error}
            onComplete={setupDeviceKey}
          />
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md rounded-3xl border border-slate-100 bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-pocketlet-500 text-white">
            <Wallet className="h-5 w-5" />
          </div>
          <span className="text-lg font-bold tracking-tight text-slate-900">Pocketlet</span>
        </div>

        <h1 className="mb-2 text-2xl font-bold text-slate-900">Log in with recovery phrase</h1>
        <p className="mb-6 text-sm text-slate-500">
          Enter the 12-word recovery phrase for <strong>{email}</strong>.
        </p>

        {error && (
          <div className="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</div>
        )}

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-700" htmlFor="phrase">
              Recovery phrase
            </label>
            <textarea
              id="phrase"
              rows={3}
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder="word1 word2 word3 ..."
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-900 focus:border-pocketlet-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-pocketlet-500"
            />
          </div>

          <button
            onClick={loginWithSeedphrase}
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-pocketlet-600 py-3 text-sm font-bold text-white hover:bg-pocketlet-700 disabled:opacity-50"
          >
            <KeyRound className="h-4 w-4" />
            {loading ? 'Verifying...' : 'Log in'}
          </button>
        </div>

        <button
          onClick={() => router.push('/login')}
          className="mt-6 w-full text-center text-sm font-semibold text-pocketlet-600 hover:underline"
        >
          Back to login
        </button>
      </div>
    </main>
  );
}
