'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Shield } from 'lucide-react';
import { createPasskeyKit, SignerStore, Ed25519Signer } from '@/lib/wallet/passkey-kit';
import {
  generateRecoveryPhrase,
  deriveRecoveryKeypair,
} from '@/lib/wallet/recovery';
import { loadDeviceKey } from '@/lib/wallet/device-key';
import {
  checkPasskeySupport,
  formatPasskeyKitError,
  logPasskeyKitError,
} from '@/lib/auth/passkey-errors';
import { getUsdcContractId, getXlmContractId } from '@/lib/wallet/assets';

const ONBOARDING_PHRASE_KEY = 'pocketlet:onboarding:recoveryPhrase';

export default function RecoverySetupPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<'idle' | 'scanning' | 'finishing' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Auto-start when page loads if support is OK
    const supportError = checkPasskeySupport();
    if (supportError) {
      setError(supportError);
      setPhase('error');
    }
  }, []);

  const handleSecureWallet = async () => {
    setPhase('scanning');
    setError(null);

    try {
      // 1. Generate recovery phrase immediately and stash it
      const phrase = generateRecoveryPhrase();
      window.sessionStorage.setItem(ONBOARDING_PHRASE_KEY, phrase);

      // 2. Derive recovery keypair from phrase
      const recoveryKp = deriveRecoveryKeypair(phrase);
      const recoveryPublicKey = recoveryKp.publicKey();
      const recoverySigner = Ed25519Signer.fromSecret(recoveryKp.secret());

      // 3. Fetch wallet info
      const infoRes = await fetch('/api/wallet/session-key/info');
      if (!infoRes.ok) {
        throw new Error('Failed to load wallet info');
      }
      const info = (await infoRes.json()) as {
        walletContractId: string;
        primaryPasskeyKeyId: string;
      };

      // 4. Connect passkey kit (no scan yet)
      const kit = createPasskeyKit();
      await kit.connectWallet({ keyId: info.primaryPasskeyKeyId });

      // 5. Build and sign recovery add_signer tx with PASSKEY (scan #2)
      const recoveryTx = await kit.addEd25519(
        recoveryPublicKey,
        undefined,
        SignerStore.Persistent
      );
      await kit.sign(recoveryTx);
      const recoveryXdr = recoveryTx.toXDR();

      // 6. Build and sign device-key add_signer tx with RECOVERY SIGNER (no scan)
      const deviceKey = await loadDeviceKey();
      if (!deviceKey) {
        throw new Error('Device key not found. Please restart onboarding.');
      }

      const limits = new Map([
        [getUsdcContractId(), undefined],
        [getXlmContractId(), undefined],
      ]);
      const expirationSeconds = Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60;

      const deviceTx = await kit.addEd25519(
        deviceKey.publicKey,
        limits,
        SignerStore.Temporary,
        expirationSeconds
      );
      await kit.sign(deviceTx, recoverySigner);
      const deviceXdr = deviceTx.toXDR();

      // 7. Fire both to server and redirect immediately (non-blocking)
      setPhase('finishing');

      fetch('/api/wallet/setup-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recoveryXdr,
          deviceXdr,
          recoveryPublicKey,
        }),
        keepalive: true,
      }).catch((err) => {
        console.error('Setup batch failed in background:', err);
      });

      // 8. Proceed immediately — don't wait for server
      router.push('/recovery-phrase');
    } catch (err) {
      logPasskeyKitError(err);
      setError(formatPasskeyKitError(err));
      setPhase('error');
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md rounded-3xl border border-slate-100 bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-pocketlet-500 text-white">
            <Shield className="h-5 w-5" />
          </div>
          <span className="text-lg font-bold tracking-tight text-slate-900">Pocketlet</span>
        </div>

        <h1 className="mb-2 text-2xl font-bold text-slate-900">Secure your wallet</h1>
        <p className="mb-6 text-sm text-slate-500">
          Add a recovery key so you can restore access if you lose your passkey.
        </p>

        {error && (
          <div className="mb-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</div>
        )}

        {phase === 'idle' && (
          <div className="space-y-4">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              Your wallet is ready. One more step: authenticate to add your recovery key.
            </div>
            <button
              onClick={handleSecureWallet}
              className="w-full rounded-xl bg-pocketlet-600 py-3 text-sm font-bold text-white hover:bg-pocketlet-700"
            >
              Secure my wallet
            </button>
          </div>
        )}

        {phase === 'scanning' && (
          <div className="flex flex-col items-center gap-3 py-4">
            <Loader2 className="h-6 w-6 animate-spin text-pocketlet-600" />
            <div className="text-center">
              <p className="text-sm font-bold text-slate-900">Securing your wallet</p>
              <p className="text-xs text-slate-500">
                Please authenticate with your passkey to add the recovery key.
              </p>
            </div>
          </div>
        )}

        {phase === 'finishing' && (
          <div className="flex flex-col items-center gap-3 py-4">
            <Loader2 className="h-6 w-6 animate-spin text-pocketlet-600" />
            <div className="text-center">
              <p className="text-sm font-bold text-slate-900">Finishing setup</p>
              <p className="text-xs text-slate-500">Almost there…</p>
            </div>
          </div>
        )}

        {phase === 'error' && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Something went wrong while securing your wallet. You can retry now or finish setup
              later from your profile.
            </p>
            <button
              onClick={handleSecureWallet}
              className="w-full rounded-xl bg-pocketlet-600 py-3 text-sm font-bold text-white hover:bg-pocketlet-700"
            >
              Retry
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
