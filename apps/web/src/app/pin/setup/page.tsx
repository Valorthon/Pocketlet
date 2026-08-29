'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Keypair } from '@stellar/stellar-sdk';
import {
  generateDeviceKeypair,
  encryptDeviceKey,
  saveDeviceKey,
} from '@/lib/wallet/device-key';

export default function PinSetupPage() {
  const router = useRouter();
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasPin, setHasPin] = useState<boolean | null>(null);
  const [email, setEmail] = useState<string>('');

  useEffect(() => {
    fetch('/api/auth/pin')
      .then((res) => {
        if (res.status === 401) {
          router.push('/login');
          return null;
        }
        return res.json();
      })
      .then((data: { hasPin?: boolean; email?: string } | null) => {
        if (data?.hasPin) {
          router.push('/home');
        } else {
          setHasPin(false);
          if (data?.email) {
            setEmail(data.email);
          }
        }
      })
      .catch(() => setHasPin(false));
  }, [router]);

  const submit = async () => {
    setError(null);
    if (pin.length !== 6 || !/^\d{6}$/.test(pin)) {
      setError('PIN must be 6 digits');
      return;
    }
    if (pin !== confirmPin) {
      setError('PINs do not match');
      return;
    }

    setLoading(true);
    try {
      // 1. Save PIN on server
      const res = await fetch('/api/auth/pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Failed to set PIN');
        return;
      }

      // 2. Generate and encrypt device key locally
      const { publicKey, secret } = await generateDeviceKeypair();
      const encrypted = await encryptDeviceKey(secret, pin, email);
      await saveDeviceKey(encrypted);

      // 3. Register device on server via challenge-response
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
        setError(challengeData.error ?? 'Failed to get challenge');
        return;
      }

      const kp = Keypair.fromSecret(secret);
      const signature = kp
        .sign(Buffer.from(challengeData.challenge!, 'base64'))
        .toString('base64');

      const registerRes = await fetch('/api/auth/register-device', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          publicKey,
          challenge: challengeData.challenge,
          signature,
        }),
      });
      const registerData = (await registerRes.json()) as { error?: string };
      if (!registerRes.ok) {
        setError(registerData.error ?? 'Failed to register device');
        return;
      }

      router.push('/recovery/setup');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set PIN');
    } finally {
      setLoading(false);
    }
  };

  if (hasPin === null) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="text-slate-600">Loading...</div>
      </main>
    );
  }

  const inputClass =
    'w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-center font-mono text-lg tracking-widest text-slate-900 focus:border-pocketlet-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-pocketlet-500';

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md rounded-3xl border border-slate-100 bg-white p-8 shadow-sm">
        <h1 className="mb-2 text-2xl font-bold text-slate-900">Create your PIN</h1>
        <p className="mb-6 text-sm text-slate-500">
          Choose a 6-digit PIN to unlock this device and confirm payments.
        </p>

        {error && (
          <div className="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</div>
        )}

        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-700" htmlFor="pin">
              PIN
            </label>
            <input
              id="pin"
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className={inputClass}
              placeholder="000000"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-700" htmlFor="confirm">
              Confirm PIN
            </label>
            <input
              id="confirm"
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className={inputClass}
              placeholder="000000"
            />
          </div>

          <button
            onClick={submit}
            disabled={loading || pin.length !== 6 || confirmPin.length !== 6}
            className="w-full rounded-xl bg-pocketlet-600 py-3 text-sm font-bold text-white hover:bg-pocketlet-700 disabled:opacity-50"
          >
            {loading ? 'Saving…' : 'Set PIN'}
          </button>
        </div>
      </div>
    </main>
  );
}
