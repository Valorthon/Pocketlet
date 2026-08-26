'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function PinResetPage() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<'request' | 'reset'>('request');

  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => res.json())
      .then((data: { user?: { email: string } }) => {
        if (!data.user) {
          router.push('/login');
        }
      });
  }, []);

  const requestCode = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/pin/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request' }),
      });
      const data = (await res.json()) as { error?: string; code?: string };
      if (!res.ok) {
        setError(data.error ?? 'Failed to send reset code');
        return;
      }
      if (data.code) {
        setCode(data.code);
        setShowCode(true);
      }
      setStep('reset');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send reset code');
    } finally {
      setLoading(false);
    }
  };

  const resetPin = async () => {
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
      const res = await fetch('/api/auth/pin/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset', code, pin }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? 'Failed to reset PIN');
        return;
      }
      router.push('/home');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset PIN');
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    'w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-center font-mono text-lg tracking-widest text-slate-900 focus:border-pocketlet-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-pocketlet-500';
  const primaryButtonClass =
    'w-full rounded-xl bg-pocketlet-600 py-3 text-sm font-bold text-white hover:bg-pocketlet-700 disabled:opacity-50';

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md rounded-3xl border border-slate-100 bg-white p-8 shadow-sm">
        <h1 className="mb-2 text-2xl font-bold text-slate-900">Reset your PIN</h1>
        <p className="mb-6 text-sm text-slate-500">Verify your email, then choose a new 6-digit PIN.</p>

        {error && <div className="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}

        {step === 'request' && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              A verification code will be sent to your registered email.
            </p>
            <button onClick={requestCode} disabled={loading} className={primaryButtonClass}>
              {loading ? 'Sending...' : 'Send reset code'}
            </button>
          </div>
        )}

        {step === 'reset' && (
          <div className="space-y-4">
            {showCode && (
              <div className="rounded-lg bg-slate-100 p-3 text-center font-mono text-lg tracking-widest text-slate-900">
                {code}
              </div>
            )}
            <p className="text-xs text-amber-700">
              Testnet mode: the code is shown above for easy testing.
            </p>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className={inputClass}
              placeholder="000000"
            />
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className={inputClass}
              placeholder="New PIN"
            />
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              className={inputClass}
              placeholder="Confirm new PIN"
            />
            <button
              onClick={resetPin}
              disabled={loading || code.length !== 6 || pin.length !== 6 || confirmPin.length !== 6}
              className={primaryButtonClass}
            >
              {loading ? 'Resetting...' : 'Reset PIN'}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
