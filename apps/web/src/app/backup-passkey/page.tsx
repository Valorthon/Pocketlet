'use client';

import { useEffect, useState } from 'react';
import { createPasskeyKit, SignerStore } from '@/lib/wallet/passkey-kit';

const ONBOARDING_KEY_ID_KEY = 'pocketlet:onboarding:keyIdBase64';
const ONBOARDING_CONTRACT_ID_KEY = 'pocketlet:onboarding:contractId';

export default function BackupPasskeyPage() {
  const [email, setEmail] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [skipped, setSkipped] = useState(false);

  useEffect(() => {
    fetch('/api/auth/pin')
      .then((res) => {
        if (res.status === 401) {
          window.location.href = '/login';
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
    window.location.href = '/pin/setup';
  };

  const registerBackupPasskey = async () => {
    setLoading(true);
    setError(null);

    try {
      if (!window.PublicKeyCredential) {
        setError('Passkeys are not supported on this device or browser.');
        return;
      }

      const keyIdBase64 = window.sessionStorage.getItem(ONBOARDING_KEY_ID_KEY);
      if (!keyIdBase64) {
        setError('Onboarding session expired. Please start over.');
        return;
      }

      const kit = createPasskeyKit();
      await kit.connectWallet({ keyId: keyIdBase64 });

      const backup = await kit.createKey('Pocketlet Backup', email || 'Pocketlet user');
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
        body: JSON.stringify({ keyIdBase64: backup.keyId }),
      });

      const recordData = (await recordRes.json()) as { error?: string };
      if (!recordRes.ok) {
        setError(recordData.error ?? 'Failed to save backup passkey record');
        return;
      }

      redirectToPinSetup();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Backup passkey registration failed');
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
    <main className="flex min-h-screen flex-col items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-lg">
        <h1 className="mb-2 text-2xl font-bold text-pocketlet-600">Add a backup passkey</h1>
        <p className="mb-6 text-sm text-gray-500">
          Register a second passkey on another device (or a different profile on this device) so
          you can still access your wallet if your primary passkey is lost.
        </p>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}

        {!skipped ? (
          <>
            <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
              <strong>Strongly recommended.</strong> Without a backup, you will need your recovery
              phrase to regain access if you lose your primary passkey.
            </div>

            <button
              onClick={registerBackupPasskey}
              disabled={loading}
              className="w-full rounded-lg bg-pocketlet-600 py-2.5 font-semibold text-white hover:bg-pocketlet-700 disabled:opacity-50"
            >
              {loading ? 'Registering...' : 'Register backup passkey'}
            </button>

            <button
              onClick={() => setSkipped(true)}
              disabled={loading}
              className="mt-3 w-full rounded-lg bg-white py-2.5 font-semibold text-gray-700 ring-1 ring-gray-300 hover:bg-gray-50 disabled:opacity-50"
            >
              Skip for now
            </button>
          </>
        ) : (
          <>
            <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              Skipping a backup means you are relying entirely on your recovery phrase. If you lose
              both your primary passkey and your recovery phrase, your wallet cannot be recovered.
            </div>

            <button
              onClick={() => setSkipped(false)}
              disabled={loading}
              className="w-full rounded-lg bg-pocketlet-600 py-2.5 font-semibold text-white hover:bg-pocketlet-700 disabled:opacity-50"
            >
              Go back and add a backup
            </button>

            <button
              onClick={skipBackup}
              disabled={loading}
              className="mt-3 w-full rounded-lg bg-white py-2.5 font-semibold text-red-700 ring-1 ring-red-200 hover:bg-red-50 disabled:opacity-50"
            >
              {loading ? 'Continuing...' : 'I understand, skip backup'}
            </button>
          </>
        )}
      </div>
    </main>
  );
}
