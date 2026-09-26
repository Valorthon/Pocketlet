'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Wallet, Loader2 } from 'lucide-react';
import {
  createPasskeyKit,
  fetchPasskeyChallenge,
} from '@/lib/wallet/passkey-kit';
import {
  checkPasskeySupport,
  formatPasskeyKitError,
  logPasskeyKitError,
} from '@/lib/auth/passkey-errors';

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code' | 'passkey'>('email');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  const requestCode = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/email-challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = (await res.json()) as { error?: string; message?: string };
      if (!res.ok) {
        setError(data.error ?? 'Failed to send code');
        return;
      }
      // The code is in the email and nowhere else (issue #18) — there is
      // nothing here to prefill the input with.
      setCode('');
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
    setCreating(true);

    try {
      const supportError = checkPasskeySupport();
      if (supportError) {
        setError(supportError);
        setCreating(false);
        return;
      }

      // The server issues the WebAuthn challenge and requires it back in the
      // registration response, so it has to be fetched before the ceremony.
      const challenge = await fetchPasskeyChallenge();
      const kit = createPasskeyKit(challenge);
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
        hash?: string;
      };
      if (!deployRes.ok) {
        setError(deployData.error ?? 'Wallet deployment failed');
        setCreating(false);
        return;
      }

      // passkey-kit 0.19 leaves the kit disconnected after `createWallet` until
      // the wallet's birth is recorded. `confirmWalletCreation` re-reads the
      // submission from the network, checks the deployed code against
      // `acceptedBirthWasmHashes`, and writes the verified birth record
      // (contract id, birth WASM hash, creation tx and ledger) into the kit's
      // IndexedDB store. Every later `connectWallet({ keyId })` resolves its
      // candidate from that record, so without this call login on this device
      // fails with WALLET_NOT_FOUND.
      //
      // It runs HERE, in the browser, rather than server-side, for two reasons:
      // the record it writes lives in the browser's IndexedDB, which the server
      // cannot reach; and it needs the `CreateWalletResult` the ceremony
      // produced, which never leaves the client in full. The route already
      // returns the submission hash, so nothing about `api/wallet/deploy`
      // changes — in particular its rate-limit charge still lands before
      // `takePasskeyChallenge` (issue #36), untouched.
      if (!deployData.hash) {
        // The route short-circuits with no hash when the user already has a
        // wallet, which means this ceremony's passkey was never submitted as a
        // signer. There is nothing to confirm and nothing to connect to.
        setError(
          'This account already has a wallet. Sign in with its passkey instead.'
        );
        setCreating(false);
        return;
      }
      // A failure here means the wallet IS deployed but this device has no
      // birth record, so it is reported rather than swallowed. NOTE FOR A
      // HUMAN: retrying the button re-runs `createWallet`, and the deploy route
      // then short-circuits on the branch above — there is no in-app way out of
      // that state yet. Needs testnet verification and, if it is reachable, its
      // own issue.
      await kit.confirmWalletCreation(result, deployData.hash);

      router.push('/pin/setup');
    } catch (err) {
      logPasskeyKitError(err);
      setError(formatPasskeyKitError(err));
      setCreating(false);
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
              Enter the 6-digit verification code sent to <strong>{email}</strong>.
            </p>
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
            {!creating ? (
              <>
                <p className="text-sm text-slate-600">
                  Your email is verified. Register a passkey to create your wallet.
                </p>
                <button
                  onClick={registerPasskeyAndDeploy}
                  disabled={loading}
                  className="w-full rounded-xl bg-pocketlet-600 py-3 text-sm font-bold text-white hover:bg-pocketlet-700 disabled:opacity-50"
                >
                  {loading ? 'Creating…' : 'Create passkey and wallet'}
                </button>
              </>
            ) : (
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
          </div>
        )}
      </div>
    </main>
  );
}
