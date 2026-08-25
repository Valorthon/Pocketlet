'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, Check, Download } from 'lucide-react';
import { splitRecoveryPhrase } from '@/lib/wallet/recovery';

const ONBOARDING_PHRASE_KEY = 'pocketlet:onboarding:recoveryPhrase';

interface ConfirmationPrompt {
  index: number;
  word: string;
  input: string;
}

export default function RecoveryPhrasePage() {
  const router = useRouter();
  const [phrase, setPhrase] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [prompts, setPrompts] = useState<ConfirmationPrompt[]>([]);

  useEffect(() => {
    const stored = window.sessionStorage.getItem(ONBOARDING_PHRASE_KEY);
    if (!stored) {
      setError('No recovery phrase found. Please restart onboarding.');
      return;
    }
    setPhrase(stored);
  }, []);

  const words = useMemo(() => (phrase ? splitRecoveryPhrase(phrase) : []), [phrase]);

  const copyPhrase = () => {
    if (!phrase) return;
    navigator.clipboard.writeText(phrase);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const downloadPhrase = () => {
    if (!phrase) return;
    const blob = new Blob(
      [
        'Pocketlet Recovery Phrase\n',
        '=========================\n\n',
        phrase,
        '\n\nWrite this down and store it somewhere safe. ' +
          'Anyone with this phrase can access your wallet.',
      ],
      { type: 'text/plain' }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pocketlet-recovery-phrase.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const startConfirmation = () => {
    if (!phrase) return;
    // Pick 3 random distinct indices using a CSPRNG.
    const indices = new Set<number>();
    const randomBytes = new Uint32Array(12);
    window.crypto.getRandomValues(randomBytes);
    let byteIndex = 0;
    while (indices.size < 3 && byteIndex < randomBytes.length) {
      indices.add(randomBytes[byteIndex] % words.length);
      byteIndex += 1;
    }
    const sorted = Array.from(indices).sort((a, b) => a - b);
    setPrompts(
      sorted.map((index) => ({
        index,
        word: words[index] ?? '',
        input: '',
      }))
    );
    setSaved(true);
  };

  const updatePromptInput = (promptIndex: number, value: string) => {
    setPrompts((prev) =>
      prev.map((p, i) => (i === promptIndex ? { ...p, input: value.trim().toLowerCase() } : p))
    );
  };

  const confirmPhrase = async () => {
    setLoading(true);
    setError(null);

    try {
      const allCorrect = prompts.every((p) => p.input === p.word.toLowerCase());
      if (!allCorrect) {
        setError('One or more words do not match. Please check your recovery phrase.');
        return;
      }

      const res = await fetch('/api/wallet/recovery/confirm', { method: 'POST' });
      const data = (await res.json()) as { error?: string; confirmed?: boolean };
      if (!res.ok) {
        setError(data.error ?? 'Failed to confirm recovery phrase');
        return;
      }

      window.sessionStorage.removeItem(ONBOARDING_PHRASE_KEY);
      router.push('/backup-passkey');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Confirmation failed');
    } finally {
      setLoading(false);
    }
  };

  if (error && !phrase) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-lg text-center">
          <h1 className="mb-2 text-xl font-semibold text-red-600">Recovery phrase unavailable</h1>
          <p className="mb-6 text-sm text-gray-600">{error}</p>
          <a
            href="/signup"
            className="inline-block rounded-lg bg-pocketlet-600 px-4 py-2 font-semibold text-white hover:bg-pocketlet-700"
          >
            Start over
          </a>
        </div>
      </main>
    );
  }

  if (!phrase) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <div className="text-gray-600">Loading recovery phrase...</div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-lg">
        <h1 className="mb-2 text-2xl font-bold text-pocketlet-600">Save your recovery phrase</h1>
        <p className="mb-6 text-sm text-gray-500">
          This 12-word phrase is the only way to recover your wallet if you lose your passkey.
          Pocketlet does not store it.
        </p>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}

        {!saved ? (
          <>
            <div className="mb-4 grid grid-cols-2 gap-2 rounded-xl bg-gray-50 p-4 sm:grid-cols-3">
              {words.map((word, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm shadow-sm"
                >
                  <span className="text-xs text-gray-400">{index + 1}.</span>
                  <span className="font-mono font-medium">{word}</span>
                </div>
              ))}
            </div>

            <div className="mb-6 flex gap-3">
              <button
                onClick={copyPhrase}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-gray-100 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-200"
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button
                onClick={downloadPhrase}
                className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-gray-100 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-200"
              >
                <Download size={16} />
                Download
              </button>
            </div>

            <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Write these words down in order and store them somewhere safe. You will not be able
              to view them again.
            </div>

            <button
              onClick={startConfirmation}
              className="w-full rounded-lg bg-pocketlet-600 py-2.5 font-semibold text-white hover:bg-pocketlet-700"
            >
              I&apos;ve saved it
            </button>
          </>
        ) : (
          <>
            <p className="mb-4 text-sm text-gray-600">
              Confirm you saved your phrase by typing the requested words.
            </p>
            <div className="mb-6 space-y-4">
              {prompts.map((prompt, promptIndex) => (
                <div key={prompt.index}>
                  <label
                    className="block text-sm font-medium text-gray-700"
                    htmlFor={`word-${prompt.index}`}
                  >
                    Word #{prompt.index + 1}
                  </label>
                  <input
                    id={`word-${prompt.index}`}
                    type="text"
                    value={prompt.input}
                    onChange={(e) => updatePromptInput(promptIndex, e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-pocketlet-500 focus:outline-none focus:ring-2 focus:ring-pocketlet-100"
                    placeholder={`Word ${prompt.index + 1}`}
                    autoComplete="off"
                  />
                </div>
              ))}
            </div>

            <button
              onClick={confirmPhrase}
              disabled={loading || prompts.some((p) => !p.input)}
              className="w-full rounded-lg bg-pocketlet-600 py-2.5 font-semibold text-white hover:bg-pocketlet-700 disabled:opacity-50"
            >
              {loading ? 'Confirming...' : 'Confirm and continue'}
            </button>
          </>
        )}
      </div>
    </main>
  );
}
