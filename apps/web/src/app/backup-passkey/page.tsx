'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { createPasskeyKit, SignerStore } from '@/lib/wallet/passkey-kit';
import {
  checkPasskeySupport,
  formatPasskeyKitError,
  logPasskeyKitError,
} from '@/lib/auth/passkey-errors';

interface WalletInfo {
  walletContractId: string;
  primaryPasskeyKeyId: string;
}

export default function BackupPasskeyPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [walletInfo, setWalletInfo] = useState<WalletInfo | null>(null);
  const [fetchingInfo, setFetchingInfo] = useState(true);

  useEffect(() => {
    const loadWalletInfo = async () => {
      try {
        const res = await fetch('/api/wallet/session-key/info');
        if (!res.ok) {
          if (res.status === 401) {
            router.push('/login');
            return;
          }
          setError('Failed to load wallet information');
          return;
        }
        const data = (await res.json()) as WalletInfo;
        setWalletInfo(data);
      } catch {
        setError('Failed to load wallet information');
      } finally {
        setFetchingInfo(false);
      }
    };

    loadWalletInfo();
  }, [router]);

  const registerBackupPasskey = async () => {
    if (!walletInfo) return;

    setLoading(true);
    setError(null);

    try {
      const supportError = checkPasskeySupport();
      if (supportError) {
        setError(supportError);
        return;
      }

      const kit = createPasskeyKit();
      await kit.connectWallet({ keyId: walletInfo.primaryPasskeyKeyId });

      const backup = await kit.createKey('Pocketlet Backup', 'Pocketlet user', {
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

      router.push('/home');
    } catch (err) {
      logPasskeyKitError(err);
      setError(formatPasskeyKitError(err));
    } finally {
      setLoading(false);
    }
  };

  if (fetchingInfo) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md rounded-3xl border border-slate-100 bg-white p-8 shadow-sm">
          <div className="flex flex-col items-center gap-3 py-4">
            <Loader2 className="h-6 w-6 animate-spin text-pocketlet-600" />
            <p className="text-sm text-slate-600">Loading wallet information…</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md rounded-3xl border border-slate-100 bg-white p-8 shadow-sm">
        <button
          onClick={() => router.push('/profile')}
          className="mb-4 flex items-center gap-1 text-sm font-semibold text-pocketlet-600 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to profile
        </button>

        <h1 className="mb-2 text-2xl font-bold text-slate-900">Add a backup passkey</h1>
        <p className="mb-6 text-sm text-slate-500">
          Register a second passkey on another device (or a different profile on this device) so
          you can still access your wallet if your primary passkey is lost.
        </p>

        {error && <div className="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</div>}

        <div className="mb-6 rounded-lg border border-pocketlet-200 bg-pocketlet-50 p-3 text-sm text-pocketlet-800">
          <strong>Strongly recommended.</strong> Without a backup, you will need your recovery
          phrase to regain access if you lose your primary passkey.
        </div>

        <button
          onClick={registerBackupPasskey}
          disabled={loading || !walletInfo}
          className="w-full rounded-xl bg-pocketlet-600 py-3 text-sm font-bold text-white hover:bg-pocketlet-700 disabled:opacity-50"
        >
          {loading ? 'Registering…' : 'Register backup passkey'}
        </button>
      </div>
    </main>
  );
}
