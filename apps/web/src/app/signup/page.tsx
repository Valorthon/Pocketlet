'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Wallet, Loader2 } from 'lucide-react';
import { createPasskeyKit, SignerStore } from '@/lib/wallet/passkey-kit';
import {
  generateRecoveryPhrase,
  getRecoveryPublicKey,
  splitRecoveryPhrase,
} from '@/lib/wallet/recovery';
import {
  checkPasskeySupport,
  formatPasskeyKitError,
  logPasskeyKitError,
} from '@/lib/auth/passkey-errors';

const ONBOARDING_PHRASE_KEY = 'pocketlet:onboarding:recoveryPhrase';
const ONBOARDING_KEY_ID_KEY = 'pocketlet:onboarding:keyIdBase64';
const ONBOARDING_CONTRACT_ID_KEY = 'pocketlet:onboarding:contractId';

type PasskeyPhase = 'idle' | 'creating' | 'recovery_ready' | 'securing' | 'recovery_error';

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code' | 'passkey'>('email');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [passkeyPhase, setPasskeyPhase] = useState<PasskeyPhase>('idle');
  const [deployResult, setDeployResult] = useState<{
    contractId: string;
    keyIdBase64: string;
  } | null>(null);
  const [recoveryPhrase, setRecoveryPhrase] = useState<string | null>(null);

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

  const runRecoverySignerRegistration = async (
    kit: ReturnType<typeof createPasskeyKit>,
    phrase: string,
    keyIdBase64: string,
    contractId: string
  ) => {
    const recoveryPublicKey = getRecoveryPublicKey(phrase);

    await kit.connectWallet({ keyId: keyIdBase64 });

    const addSignerTx = await kit.addEd25519(
      recoveryPublicKey,
      undefined,
      SignerStore.Persistent
    );
    await kit.sign(addSignerTx);
    const signedXdr = addSignerTx.toXDR();

    const submitRes = await fetch('/api/wallet/recovery-signer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signedXdr, recoveryPublicKey }),
    });

    const submitData = (await submitRes.json()) as { error?: string; hash?: string };
    if (!submitRes.ok) {
      throw new Error(submitData.error ?? 'Failed to register recovery signer');
    }

    window.sessionStorage.setItem(ONBOARDING_PHRASE_KEY, phrase);
    window.sessionStorage.setItem(ONBOARDING_KEY_ID_KEY, keyIdBase64);
    window.sessionStorage.setItem(ONBOARDING_CONTRACT_ID_KEY, contractId);

    const stored = window.sessionStorage.getItem(ONBOARDING_PHRASE_KEY);
    const storedWords = stored ? splitRecoveryPhrase(stored) : [];
    if (storedWords.length !== 12) {
      throw new Error('Failed to save recovery phrase. Please try again.');
    }

    router.push('/recovery-phrase');
  };

  const registerPasskeyAndDeploy = async () => {
    setLoading(true);
    setError(null);
    setPasskeyPhase('creating');

    try {
      const supportError = checkPasskeySupport();
      if (supportError) {
        setError(supportError);
        setPasskeyPhase('idle');
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
        setPasskeyPhase('idle');
        return;
      }

      setDeployResult({
        contractId: result.contractId,
        keyIdBase64: result.keyIdBase64,
      });
      setPasskeyPhase('recovery_ready');
    } catch (err) {
      logPasskeyKitError(err);
      setError(formatPasskeyKitError(err));
      setPasskeyPhase('idle');
    } finally {
      setLoading(false);
    }
  };

  const handleSetupRecovery = async () => {
    if (!deployResult) return;

    setLoading(true);
    setError(null);
    setPasskeyPhase('securing');

    const phrase = recoveryPhrase ?? generateRecoveryPhrase();
    if (!recoveryPhrase) {
      setRecoveryPhrase(phrase);
    }

    try {
      const kit = createPasskeyKit();
      await runRecoverySignerRegistration(
        kit,
        phrase,
        deployResult.keyIdBase64,
        deployResult.contractId
      );
    } catch (err) {
      logPasskeyKitError(err);
      setError(formatPasskeyKitError(err));
      setPasskeyPhase('recovery_error');
    } finally {
      setLoading(false);
    }
  };

  const handleRetryRecoverySigner = async () => {
    if (!deployResult) return;

    setLoading(true);
    setError(null);
    setPasskeyPhase('securing');

    try {
      const kit = createPasskeyKit();
      await runRecoverySignerRegistration(
        kit,
        recoveryPhrase!,
        deployResult.keyIdBase64,
        deployResult.contractId
      );
    } catch (err) {
      logPasskeyKitError(err);
      setError(formatPasskeyKitError(err));
      setPasskeyPhase('recovery_error');
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
            {passkeyPhase === 'idle' && (
              <>
                <p className="text-sm text-slate-600">
                  Your email is verified. Register a passkey to create and secure your wallet.
                </p>
                <button
                  onClick={registerPasskeyAndDeploy}
                  disabled={loading}
                  className="w-full rounded-xl bg-pocketlet-600 py-3 text-sm font-bold text-white hover:bg-pocketlet-700 disabled:opacity-50"
                >
                  {loading ? 'Creating…' : 'Create passkey and wallet'}
                </button>
              </>
            )}

            {passkeyPhase === 'creating' && (
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

            {passkeyPhase === 'recovery_ready' && (
              <>
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                  Your wallet is ready. Next, set up account recovery so you can restore access if
                  you lose your passkey.
                </div>
                <button
                  onClick={handleSetupRecovery}
                  disabled={loading}
                  className="w-full rounded-xl bg-pocketlet-600 py-3 text-sm font-bold text-white hover:bg-pocketlet-700 disabled:opacity-50"
                >
                  {loading ? 'Securing…' : 'Generate seed phrase for account recovery'}
                </button>
              </>
            )}

            {passkeyPhase === 'securing' && (
              <div className="flex flex-col items-center gap-3 py-4">
                <Loader2 className="h-6 w-6 animate-spin text-pocketlet-600" />
                <div className="text-center">
                  <p className="text-sm font-bold text-slate-900">Securing your wallet</p>
                  <p className="text-xs text-slate-500">
                    Please authenticate to save your recovery key.
                  </p>
                </div>
              </div>
            )}

            {passkeyPhase === 'recovery_error' && (
              <>
                <p className="text-sm text-slate-600">
                  Something went wrong while securing your wallet. You can retry now or finish
                  setup later from your profile.
                </p>
                <button
                  onClick={handleRetryRecoverySigner}
                  disabled={loading}
                  className="w-full rounded-xl bg-pocketlet-600 py-3 text-sm font-bold text-white hover:bg-pocketlet-700 disabled:opacity-50"
                >
                  {loading ? 'Retrying…' : 'Retry securing wallet'}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
