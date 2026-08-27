'use client';

import { startAuthentication } from '@simplewebauthn/browser';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Wallet, KeyRound, Fingerprint } from 'lucide-react';
import { PinKeypad } from '@/components/ui/PinKeypad';
import {
  checkPasskeySupport,
  formatPasskeyKitError,
  logPasskeyKitError,
} from '@/lib/auth/passkey-errors';
import {
  hasUsableDeviceKey,
  loadDeviceKey,
  signDeviceChallenge,
  ensureDeviceKey,
} from '@/lib/wallet/device-key';
import { createPasskeyKit } from '@/lib/wallet/passkey-kit';

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<'check' | 'pin' | 'email' | 'method' | 'passkey' | 'setup'>(
    'check'
  );
  const [email, setEmail] = useState('');
  const [storedEmail, setStoredEmail] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    hasUsableDeviceKey().then((has) => {
      if (cancelled) return;
      if (has) {
        loadDeviceKey().then((device) => {
          if (device?.email) {
            setStoredEmail(device.email);
          }
          setStep('pin');
        });
      } else {
        setStep('email');
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const loginWithPin = async (pin: string) => {
    setLoading(true);
    setError(null);
    try {
      const device = await loadDeviceKey();
      if (!device) {
        setError('Device key not found. Please log in with your passkey or recovery phrase.');
        setStep('email');
        return;
      }

      const challengeRes = await fetch('/api/auth/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: device.email }),
      });
      const challengeData = (await challengeRes.json()) as { error?: string; challenge?: string };
      if (!challengeRes.ok) {
        setError(challengeData.error ?? 'Failed to start login');
        return;
      }

      const signature = await signDeviceChallenge(pin, challengeData.challenge ?? '');

      const loginRes = await fetch('/api/auth/device-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: device.email,
          challenge: challengeData.challenge,
          signature,
          publicKey: device.publicKey,
        }),
      });
      const loginData = (await loginRes.json()) as { error?: string };
      if (!loginRes.ok) {
        setError(loginData.error ?? 'Login failed');
        return;
      }
      router.push('/home');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const loginWithPasskey = async () => {
    setLoading(true);
    setError(null);
    try {
      const supportError = checkPasskeySupport();
      if (supportError) {
        setError(supportError);
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
      const data = (await verifyRes.json()) as { error?: string };
      if (!verifyRes.ok) {
        setError(data.error ?? 'Login failed');
        return;
      }
      setStep('setup');
    } catch (err) {
      logPasskeyKitError(err);
      setError(formatPasskeyKitError(err));
    } finally {
      setLoading(false);
    }
  };

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
      await kit.connectWallet({ keyId: info.primaryPasskeyKeyId });
      await ensureDeviceKey(kit, pin, email);

      router.push('/home');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Device setup failed');
    } finally {
      setLoading(false);
    }
  };

  if (step === 'check') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6">
        <div className="text-slate-600">Checking device...</div>
      </main>
    );
  }

  if (step === 'pin') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-sm rounded-3xl border border-slate-100 bg-white p-8 shadow-sm">
          <div className="mb-6 flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-pocketlet-500 text-white">
              <Wallet className="h-5 w-5" />
            </div>
            <span className="text-lg font-bold tracking-tight text-slate-900">Pocketlet</span>
          </div>

          <h1 className="mb-2 text-2xl font-bold text-slate-900">Welcome back</h1>
          <p className="mb-6 text-sm text-slate-500">
            {storedEmail ? `Unlock for ${storedEmail}` : 'Enter your PIN to unlock.'}
          </p>

          {error && (
            <div className="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</div>
          )}

          <PinKeypad
            title=""
            subtitle="Enter your 6-digit PIN"
            disabled={loading}
            error={error}
            onComplete={loginWithPin}
          />

          <button
            onClick={() => {
              setStep('email');
              setError(null);
            }}
            className="mt-6 w-full text-center text-sm font-semibold text-pocketlet-600 hover:underline"
          >
            Log in with a different method
          </button>
        </div>
      </main>
    );
  }

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

  if (step === 'method') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md rounded-3xl border border-slate-100 bg-white p-8 shadow-sm">
          <div className="mb-6 flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-pocketlet-500 text-white">
              <Wallet className="h-5 w-5" />
            </div>
            <span className="text-lg font-bold tracking-tight text-slate-900">Pocketlet</span>
          </div>

          <h1 className="mb-2 text-2xl font-bold text-slate-900">Choose a method</h1>
          <p className="mb-6 text-sm text-slate-500">
            This is a new device or your local key has expired. Authenticate to set up quick
            unlock.
          </p>

          {error && (
            <div className="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</div>
          )}

          <div className="space-y-3">
            <button
              onClick={() => {
                setStep('passkey');
                setError(null);
              }}
              disabled={loading}
              className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left hover:bg-slate-50 disabled:opacity-50"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                <Fingerprint className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900">Passkey</p>
                <p className="text-xs text-slate-500">Use your device biometric or security key</p>
              </div>
            </button>

            <a
              href={`/login/seedphrase?email=${encodeURIComponent(email)}`}
              className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left hover:bg-slate-50"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-pocketlet-50 text-pocketlet-600">
                <KeyRound className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-bold text-slate-900">Recovery phrase</p>
                <p className="text-xs text-slate-500">Enter your 12-word recovery phrase</p>
              </div>
            </a>
          </div>

          <button
            onClick={() => {
              setStep('email');
              setError(null);
            }}
            className="mt-6 w-full text-center text-sm font-semibold text-pocketlet-600 hover:underline"
          >
            Use a different email
          </button>
        </div>
      </main>
    );
  }

  if (step === 'passkey') {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md rounded-3xl border border-slate-100 bg-white p-8 shadow-sm">
          <div className="mb-6 flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-pocketlet-500 text-white">
              <Wallet className="h-5 w-5" />
            </div>
            <span className="text-lg font-bold tracking-tight text-slate-900">Pocketlet</span>
          </div>

          <h1 className="mb-2 text-2xl font-bold text-slate-900">Log in with passkey</h1>
          <p className="mb-6 text-sm text-slate-500">
            Authenticate with the passkey registered for <strong>{email}</strong>.
          </p>

          {error && (
            <div className="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</div>
          )}

          <button
            onClick={loginWithPasskey}
            disabled={loading}
            className="w-full rounded-xl bg-pocketlet-600 py-3 text-sm font-bold text-white hover:bg-pocketlet-700 disabled:opacity-50"
          >
            {loading ? 'Authenticating...' : 'Use passkey'}
          </button>

          <button
            onClick={() => {
              setStep('method');
              setError(null);
            }}
            className="mt-4 w-full text-center text-sm font-semibold text-pocketlet-600 hover:underline"
          >
            Back
          </button>
        </div>
      </main>
    );
  }

  // step === 'email'
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
        <p className="mb-6 text-sm text-slate-500">Enter your email to continue.</p>

        {error && (
          <div className="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            if (!email.trim()) {
              setError('Email is required');
              return;
            }
            setStep('method');
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
            Continue
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
