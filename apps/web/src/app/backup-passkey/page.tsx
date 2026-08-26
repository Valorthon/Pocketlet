'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createPasskeyKit, SignerStore } from '@/lib/wallet/passkey-kit';
import {
  checkPasskeySupport,
  formatPasskeyKitError,
  logPasskeyKitError,
} from '@/lib/auth/passkey-errors';

const ONBOARDING_KEY_ID_KEY = 'pocketlet:onboarding:keyIdBase64';
const ONBOARDING_CONTRACT_ID_KEY = 'pocketlet:onboarding:contractId';

export default function BackupPasskeyPage() {
  const router = useRouter();
  const [email, setEmail] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [skipped, setSkipped] = useState(false);

  useEffect(() => {
    fetch('/api/auth/pin')
      .then((res) => {
        if (res.status === 401) {
          router.push('/login');
          return null;
        }
        return res.json();
      })
      .then((data: { email?: string } | null) => {
        if (data?.email) {
          setEmail(data.email);
        }
      })
      .catch(() => setEmail(''));
  }, []);

  const clearOnboardingState = () => {
    window.sessionStorage.removeItem(ONBOARDING_KEY_ID_KEY);
    window.sessionStorage.removeItem(ONBOARDING_CONTRACT_ID_KEY);
  };

  const redirectToPinSetup = () => {
    clearOnboardingState();
    router.push('/pin/setup');
  };

  const registerBackupPasskey = async () => {
    setLoading(true);
    setError(null);

    try {
      const supportError = checkPasskeySupport();
      if (supportError) {
        setError(supportError);
        return;
      }

      const keyIdBase64 = window.sessionStorage.getItem(ONBOARDING_KEY_ID_KEY);
      if (!keyIdBase64) {
        setError('Onboarding session expired. Please start over.');
        return;
      }

      const kit = createPasskeyKit();
      await kit.connectWallet({ keyId: keyIdBase64 });

      const backup = await kit.createKey('Pocketlet Backup', email || 'Pocketlet user', {
        authenticatorSelection: {
          residentKey: 'preferred',
          userVerification: 'required',
        },
      });
      const addBackupTx = await kit.addSecp256r1(
        backup.keyId,
        backup.publicKey,
        undefined,
        SignerStore.Persistent
      );
      await kit.sign(addBackupTx);
      const signedXdr = addBackupTx.toXDR();

      const submitRes = await fetch('/api/wallet/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signedXdr }),
      });

      const submitData = (await submitRes.json()) as { error?: string; hash?: string };
      if (!submitRes.ok) {
        setError(submitData.error ?? 'Failed to register backup passkey');
        return;
      }

      const recordRes = await fetch('/api/wallet/backup-passkey', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyIdBase64: backup.keyId,
          response: backup.rawResponse,
        }),
      });

      const recordData = (await recordRes.json()) as { error?: string };
      if (!recordRes.ok) {
        setError(recordData.error ?? 'Failed to save backup passkey record');
        return;
      }

      redirectToPinSetup();
    } catch (err) {
      logPasskeyKitError(err);
      setError(formatPasskeyKitError(err));
    } finally {
      setLoading(false);
    }
  };

  const skipBackup = async () => {
    setLoading(true);
    try {
      redirectToPinSetup();
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md rounded-3xl border border-slate-100 bg-white p-8 shadow-sm">
        <h1 className="mb-2 text-2xl font-bold text-slate-900">Add a backup passkey</h1>
        <p className="mb-6 text-sm text-slate-500">
          Register a second passkey on another device (or a different profile on this device) so
          you can still access your wallet if your primary passkey is lost.
        </p>

        {error && <div className="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}

        {!skipped ? (
          <>
            <div className="mb-6 rounded-lg border border-pocketlet-200 bg-pocketlet-50 p-3 text-sm text-pocketlet-800">
              <strong>Strongly recommended.</strong> Without a backup, you will need your recovery
              phrase to regain access if you lose your primary passkey.
            </div>

            <button
              onClick={registerBackupPasskey}
              disabled={loading}
              className="w-full rounded-xl bg-pocketlet-600 py-3 text-sm font-bold text-white hover:bg-pocketlet-700 disabled:opacity-50"
            >
              {loading ? 'Registering...' : 'Register backup passkey'}
            </button>

            <button
              onClick={() => setSkipped(true)}
              disabled={loading}
              className="mt-3 w-full rounded-xl bg-white py-3 text-sm font-bold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-50"
            >
              Skip for now
            </button>
          </>
        ) : (
          <>
            <div className="mb-6 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
              Skipping a backup means you are relying entirely on your recovery phrase. If you lose
              both your primary passkey and your recovery phrase, your wallet cannot be recovered.
            </div>

            <button
              onClick={() => setSkipped(false)}
              disabled={loading}
              className="w-full rounded-xl bg-pocketlet-600 py-3 text-sm font-bold text-white hover:bg-pocketlet-700 disabled:opacity-50"
            >
              Go back and add a backup
            </button>

            <button
              onClick={skipBackup}
              disabled={loading}
              className="mt-3 w-full rounded-xl bg-white py-3 text-sm font-bold text-rose-700 ring-1 ring-rose-200 hover:bg-rose-50 disabled:opacity-50"
            >
              {loading ? 'Continuing...' : 'I understand, skip backup'}
            </button>
          </>
        )}
      </div>
    </main>
  );
}
