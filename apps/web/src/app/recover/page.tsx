'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  createPasskeyKit,
  connectPasskeyKitByContractId,
  SignerStore,
  SignerKey,
  Ed25519Signer,
} from '@/lib/wallet/passkey-kit';
import {
  deriveRecoveryKeypair,
  isValidRecoveryPhrase,
} from '@/lib/wallet/recovery';

import type { Keypair } from '@stellar/stellar-sdk';

type RecoveryStep =
  | 'email'
  | 'verify'
  | 'waiting'
  | 'phrase'
  | 'register'
  | 'old-passkey-warning'
  | 'success'
  | 'unrecoverable';

interface RecoveryStatus {
  status: 'pending' | 'ready';
  readyAfter: string;
  waitingPeriodMs: number;
  contractId?: string;
  primaryPasskeyKeyId?: string;
}

export default function RecoverPage() {
  const [step, setStep] = useState<RecoveryStep>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [phrase, setPhrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [readyAfter, setReadyAfter] = useState<string | null>(null);
  const [countdown, setCountdown] = useState('');
  const [status, setStatus] = useState<RecoveryStatus | null>(null);

  const [recoveryKeypair, setRecoveryKeypair] = useState<Keypair | null>(null);

  useEffect(() => {
    if (!readyAfter || step !== 'waiting') {
      return;
    }
    const updateCountdown = () => {
      const remaining = new Date(readyAfter).getTime() - Date.now();
      if (remaining <= 0) {
        setCountdown('Ready now');
        return;
      }
      const hours = Math.floor(remaining / (1000 * 60 * 60));
      const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((remaining % (1000 * 60)) / 1000);
      setCountdown(
        `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
      );
    };
    updateCountdown();
    const id = setInterval(updateCountdown, 1000);
    return () => clearInterval(id);
  }, [readyAfter, step]);

  useEffect(() => {
    if (step !== 'waiting') {
      return;
    }
    const poll = async () => {
      try {
        const res = await fetch('/api/auth/recovery/status');
        if (res.ok) {
          const nextStatus = (await res.json()) as RecoveryStatus;
          setStatus(nextStatus);
          setReadyAfter(nextStatus.readyAfter);
          if (nextStatus.status === 'ready') {
            setStep('phrase');
          }
        } else if (res.status === 401) {
          setError('Recovery session expired. Please start over.');
          setStep('email');
        }
      } catch {
        // Ignore polling errors; user can continue manually.
      }
    };
    poll();
    const id = setInterval(poll, 30000);
    return () => clearInterval(id);
  }, [step]);

  const initiate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/recovery/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const body = (await res.json()) as { error?: string; code?: string };
      if (!res.ok) {
        if (res.status === 404) {
          setStep('unrecoverable');
          return;
        }
        setError(body.error ?? 'Failed to initiate recovery');
        return;
      }
      setCode(body.code ?? '');
      setStep('verify');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initiate recovery');
    } finally {
      setLoading(false);
    }
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/recovery/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });
      const body = (await res.json()) as {
        error?: string;
        verified?: boolean;
        readyAfter?: string;
      };
      if (!res.ok) {
        setError(body.error ?? 'Verification failed');
        return;
      }
      if (body.readyAfter) {
        setReadyAfter(body.readyAfter);
      }
      setStep('waiting');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setLoading(false);
    }
  };

  const deriveKey = () => {
    setError(null);
    const trimmed = phrase.trim();
    if (!isValidRecoveryPhrase(trimmed)) {
      setError('Invalid recovery phrase. Please enter all 12 words in order.');
      return;
    }
    try {
      const keypair = deriveRecoveryKeypair(trimmed);
      setRecoveryKeypair(keypair);
      setStep('register');
    } catch {
      setError('Could not derive recovery key from phrase. Please check it.');
    }
  };

  const registerPasskey = async () => {
    setError(null);
    setWarning(null);
    setLoading(true);

    try {
      if (!window.PublicKeyCredential) {
        setError('Passkeys are not supported on this device or browser.');
        return;
      }
      if (!recoveryKeypair || !status?.contractId) {
        setError('Recovery state is incomplete. Please start over.');
        return;
      }

      const kit = createPasskeyKit();
      connectPasskeyKitByContractId(kit, status.contractId);

      const newPasskey = await kit.createKey('Pocketlet Recovery', email || 'Pocketlet user');

      const addSignerTx = await kit.addSecp256r1(
        newPasskey.keyId,
        newPasskey.publicKey,
        undefined,
        SignerStore.Persistent
      );
      await kit.sign(addSignerTx, new Ed25519Signer(recoveryKeypair));
      const signedXdr = addSignerTx.toXDR();

      const submitRes = await fetch('/api/wallet/recovery/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signedXdr,
          response: newPasskey.rawResponse,
          keyIdBase64: newPasskey.keyId,
        }),
      });

      const submitData = (await submitRes.json()) as {
        error?: string;
        verified?: boolean;
        hash?: string;
      };
      if (!submitRes.ok) {
        setError(submitData.error ?? 'Failed to register new passkey');
        return;
      }

      // Remove the lost primary passkey if we know its key id.
      if (status.primaryPasskeyKeyId && status.primaryPasskeyKeyId !== newPasskey.keyId) {
        await removeOldPrimaryPasskey(status.primaryPasskeyKeyId);
        return;
      }

      setStep('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to register new passkey');
    } finally {
      setLoading(false);
    }
  };

  const removeOldPrimaryPasskey = async (keyId: string) => {
    if (!recoveryKeypair || !status?.contractId) {
      setError('Recovery state is incomplete. Please start over.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const kit = createPasskeyKit();
      connectPasskeyKitByContractId(kit, status.contractId);

      const removeSignerTx = await kit.remove(SignerKey.Secp256r1(keyId));
      await kit.sign(removeSignerTx, new Ed25519Signer(recoveryKeypair));
      const removeSignedXdr = removeSignerTx.toXDR();

      const removeRes = await fetch('/api/wallet/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signedXdr: removeSignedXdr }),
      });

      const removeData = (await removeRes.json()) as { error?: string; hash?: string };
      if (!removeRes.ok) {
        setWarning(
          removeData.error ??
            'New passkey registered, but the old passkey could not be removed.'
        );
        setStep('old-passkey-warning');
        return;
      }

      setStep('success');
    } catch (removeErr) {
      setWarning(
        removeErr instanceof Error
          ? removeErr.message
          : 'New passkey registered, but the old passkey could not be removed.'
      );
      setStep('old-passkey-warning');
    } finally {
      setLoading(false);
    }
  };

  if (step === 'unrecoverable') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-lg text-center">
          <h1 className="mb-2 text-2xl font-bold text-red-600">Account not recoverable</h1>
          <p className="mb-6 text-sm text-gray-600">
            We could not find a recoverable account for that email. If you have lost both your
            passkey and recovery phrase, your account cannot be recovered.
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

  if (step === 'success') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-lg text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-3xl text-green-600">
            ✓
          </div>
          <h1 className="mb-2 text-2xl font-bold text-gray-900">Recovery complete</h1>
          <p className="mb-6 text-sm text-gray-600">
            Your new passkey is registered. You can now log in normally.
          </p>
          {warning && (
            <div className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{warning}</div>
          )}
          <Link
            href="/home"
            className="inline-block rounded-lg bg-pocketlet-600 px-4 py-2 font-semibold text-white hover:bg-pocketlet-700"
          >
            Go home
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-lg">
        <div className="mb-6 flex items-center justify-between">
          <Link href="/login" className="text-2xl font-bold text-pocketlet-600">
            ← Pocketlet
          </Link>
        </div>

        <h1 className="mb-2 text-2xl font-bold text-gray-900">Recover your account</h1>
        <p className="mb-6 text-sm text-gray-500">
          Recover access with your registered email and recovery phrase.
        </p>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}
        {warning && (
          <div className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{warning}</div>
        )}

        {step === 'email' && (
          <form onSubmit={initiate} className="space-y-4">
            <label className="block text-sm font-medium text-gray-700" htmlFor="email">
              Registered email
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
              {loading ? 'Sending code...' : 'Send recovery code'}
            </button>
          </form>
        )}

        {step === 'verify' && (
          <form onSubmit={verify} className="space-y-4">
            <p className="text-sm text-gray-600">
              A recovery code has been sent to{' '}
              <span className="font-medium text-gray-900">{email}</span>. Enter it below to
              continue.
            </p>
            <label className="block text-sm font-medium text-gray-700" htmlFor="code">
              Recovery code
            </label>
            <input
              id="code"
              type="text"
              inputMode="numeric"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-pocketlet-500 focus:outline-none focus:ring-2 focus:ring-pocketlet-100"
              placeholder="123456"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-pocketlet-600 py-2.5 font-semibold text-white hover:bg-pocketlet-700 disabled:opacity-50"
            >
              {loading ? 'Verifying...' : 'Verify code'}
            </button>
          </form>
        )}

        {step === 'waiting' && (
          <div className="space-y-4 text-center">
            <div className="rounded-lg bg-amber-50 p-4">
              <p className="text-sm font-medium text-amber-800">Waiting period</p>
              <p className="mt-1 text-2xl font-bold text-amber-900">{countdown}</p>
            </div>
            <p className="text-sm text-gray-600">
              For your security, you must wait before registering a new passkey. Keep this page
              open; it will update automatically.
            </p>
          </div>
        )}

        {step === 'phrase' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Enter your 12-word recovery phrase. It is only used in this browser to sign the
              recovery transaction.
            </p>
            <textarea
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 font-mono text-sm focus:border-pocketlet-500 focus:outline-none focus:ring-2 focus:ring-pocketlet-100"
              placeholder="word1 word2 word3 ... word12"
            />
            <button
              onClick={deriveKey}
              disabled={loading || !phrase.trim()}
              className="w-full rounded-lg bg-pocketlet-600 py-2.5 font-semibold text-white hover:bg-pocketlet-700 disabled:opacity-50"
            >
              Continue
            </button>
          </div>
        )}

        {step === 'register' && (
          <div className="space-y-4 text-center">
            <p className="text-sm text-gray-600">
              Your waiting period is over. Register a new passkey to complete recovery.
            </p>
            <button
              onClick={registerPasskey}
              disabled={loading}
              className="w-full rounded-lg bg-pocketlet-600 py-2.5 font-semibold text-white hover:bg-pocketlet-700 disabled:opacity-50"
            >
              {loading ? 'Registering...' : 'Register new passkey'}
            </button>
          </div>
        )}

        {step === 'old-passkey-warning' && status?.primaryPasskeyKeyId && (
          <div className="space-y-4 text-center">
            <div className="rounded-lg bg-amber-50 p-4 text-left text-sm text-amber-800">
              <p className="font-medium">Old passkey could not be removed</p>
              <p className="mt-1">
                Your new passkey is registered, but we could not remove the old one from your
                wallet. The old passkey may still work until it is removed.
              </p>
              {warning && <p className="mt-2">{warning}</p>}
            </div>
            <button
              onClick={() => removeOldPrimaryPasskey(status.primaryPasskeyKeyId!)}
              disabled={loading}
              className="w-full rounded-lg bg-pocketlet-600 py-2.5 font-semibold text-white hover:bg-pocketlet-700 disabled:opacity-50"
            >
              {loading ? 'Trying again...' : 'Try removing old passkey again'}
            </button>
            <button
              onClick={() => setStep('success')}
              disabled={loading}
              className="w-full rounded-lg bg-gray-100 py-2.5 font-semibold text-gray-700 hover:bg-gray-200 disabled:opacity-50"
            >
              Continue anyway
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
