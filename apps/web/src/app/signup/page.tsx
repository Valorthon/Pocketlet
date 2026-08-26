'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Wallet } from 'lucide-react';
import { createPasskeyKit, SignerStore } from '@/lib/wallet/passkey-kit';
import {
  generateRecoveryPhrase,
  getRecoveryPublicKey,
  splitRecoveryPhrase,
} from '@/lib/wallet/recovery';

const ONBOARDING_PHRASE_KEY = 'pocketlet:onboarding:recoveryPhrase';
const ONBOARDING_KEY_ID_KEY = 'pocketlet:onboarding:keyIdBase64';
const ONBOARDING_CONTRACT_ID_KEY = 'pocketlet:onboarding:contractId';

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code' | 'passkey'>('email');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
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
      // Testnet only: the server returns the code for display.
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

  const registerPasskeyAndDeploy = async () => {
    setLoading(true);
    setError(null);

    try {
      if (!window.PublicKeyCredential) {
        setError('Passkeys are not supported on this device or browser.');
        return;
      }

      const kit = createPasskeyKit();
      const result = await kit.createWallet('Pocketlet', email);

      // Generate the recovery phrase client-side. The phrase itself never
      // leaves the browser; only its derived public key is sent to the server.
      const phrase = generateRecoveryPhrase();

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
        return;
      }

      setDeployResult({
        contractId: result.contractId,
        keyIdBase64: result.keyIdBase64,
      });
      setRecoveryPhrase(phrase);

      await registerRecoverySigner(kit, phrase, result.keyIdBase64, result.contractId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Passkey registration failed');
    } finally {
      setLoading(false);
    }
  };

  const registerRecoverySigner = async (
    kit: ReturnType<typeof createPasskeyKit>,
    phrase: string,
    keyIdBase64: string,
    contractId: string
  ) => {
    setLoading(true);
    setError(null);

    try {
      const recoveryPublicKey = getRecoveryPublicKey(phrase);

      // Connect the newly deployed wallet so we can administer signers.
      await kit.connectWallet({ keyId: keyIdBase64 });

      // Register the recovery Ed25519 signer immediately after deploy.
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
        setError(submitData.error ?? 'Failed to register recovery signer');
        return;
      }

      // Stash onboarding state in sessionStorage so the recovery-phrase page
      // can display the phrase once without persisting it on the server.
      window.sessionStorage.setItem(ONBOARDING_PHRASE_KEY, phrase);
      window.sessionStorage.setItem(ONBOARDING_KEY_ID_KEY, keyIdBase64);
      window.sessionStorage.setItem(ONBOARDING_CONTRACT_ID_KEY, contractId);

      // Basic check that the stored phrase is retrievable before navigating.
      const stored = window.sessionStorage.getItem(ONBOARDING_PHRASE_KEY);
      const storedWords = stored ? splitRecoveryPhrase(stored) : [];
      if (storedWords.length !== 12) {
        setError('Failed to save recovery phrase. Please try again.');
        return;
      }

      router.push('/recovery-phrase');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to register recovery signer');
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
              {loading ? 'Sending...' : 'Send verification code'}
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
              {loading ? 'Verifying...' : 'Verify email'}
            </button>
          </div>
        )}

        {step === 'passkey' && (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Your email is verified. Register a passkey to create and secure your wallet.
            </p>
            {!deployResult ? (
              <button
                onClick={registerPasskeyAndDeploy}
                disabled={loading}
                className="w-full rounded-xl bg-pocketlet-600 py-3 text-sm font-bold text-white hover:bg-pocketlet-700 disabled:opacity-50"
              >
                {loading ? 'Registering...' : 'Register passkey and create wallet'}
              </button>
            ) : (
              <button
                onClick={() => {
                  const kit = createPasskeyKit();
                  if (recoveryPhrase) {
                    registerRecoverySigner(
                      kit,
                      recoveryPhrase,
                      deployResult.keyIdBase64,
                      deployResult.contractId
                    );
                  }
                }}
                disabled={loading || !recoveryPhrase}
                className="w-full rounded-xl bg-pocketlet-600 py-3 text-sm font-bold text-white hover:bg-pocketlet-700 disabled:opacity-50"
              >
                {loading ? 'Retrying...' : 'Retry adding recovery signer'}
              </button>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
