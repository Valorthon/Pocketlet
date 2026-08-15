'use client';

import { useState } from 'react';
import Link from 'next/link';
import PinModal from '@/components/PinModal';
import { createPasskeyKit, createTokenClient } from '@/lib/wallet/passkey-kit';
import { getUsdcContractId, getXlmContractId } from '@/lib/wallet/assets';
import { amountToBaseUnits } from '@/lib/wallet/amount';

interface TransferForm {
  asset: 'USDC' | 'XLM';
  amount: string;
  recipient: string;
}

interface TransferResult {
  hash: string;
}

interface ResolvedRecipient {
  type: 'address' | 'username' | 'phone';
  address: string;
  display: string;
}

function getTokenContractId(asset: 'USDC' | 'XLM'): string {
  return asset === 'USDC' ? getUsdcContractId() : getXlmContractId();
}

export default function SendPage() {
  const [form, setForm] = useState<TransferForm>({
    asset: 'USDC',
    amount: '',
    recipient: '',
  });
  const [step, setStep] = useState<'form' | 'review' | 'confirming' | 'success'>('form');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TransferResult | null>(null);
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [resolved, setResolved] = useState<ResolvedRecipient | null>(null);
  const [resolving, setResolving] = useState(false);

  const validateForm = (): string | null => {
    if (!form.recipient.trim()) {
      return 'Recipient is required';
    }
    if (!form.amount || Number.isNaN(Number(form.amount)) || Number(form.amount) <= 0) {
      return 'Enter a valid amount greater than zero';
    }
    const parts = form.amount.split('.');
    if (parts[1] && parts[1].length > 7) {
      return 'Amount cannot have more than 7 decimal places';
    }
    return null;
  };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setResolving(true);
    try {
      const res = await fetch('/api/wallet/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: form.recipient.trim() }),
      });

      const body = (await res.json()) as { error?: string } & Partial<ResolvedRecipient>;
      if (!res.ok) {
        setError(body.error ?? 'Recipient not found');
        setResolving(false);
        return;
      }

      setResolved(body as ResolvedRecipient);
      setStep('review');
    } catch {
      setError('Failed to resolve recipient');
    } finally {
      setResolving(false);
    }
  };

  const confirmTransfer = () => {
    setPinModalOpen(true);
  };

  const executeTransfer = async (pin: string) => {
    setPinModalOpen(false);
    setStep('confirming');
    setError(null);

    try {
      if (!resolved) {
        throw new Error('Recipient not resolved');
      }

      const kit = createPasskeyKit();
      await kit.connectWallet();

      if (!kit.contractId) {
        throw new Error('Wallet not connected');
      }

      const tokenContractId = getTokenContractId(form.asset);
      const tokenClient = createTokenClient(tokenContractId, kit.contractId);

      const baseAmount = amountToBaseUnits(form.amount);
      const tx = await tokenClient.transfer({
        from: kit.contractId,
        to: resolved.address,
        amount: baseAmount,
      });

      await kit.sign(tx);
      const signedXdr = tx.toXDR();

      const res = await fetch('/api/wallet/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signedXdr,
          asset: form.asset,
          amount: form.amount,
          recipient: form.recipient.trim(),
          pin,
        }),
      });

      const body = (await res.json()) as { error?: string; hash?: string };
      if (!res.ok) {
        setError(body.error ?? 'Transfer failed');
        setStep('review');
        return;
      }

      setResult({ hash: body.hash ?? '' });
      setStep('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transfer failed');
      setStep('review');
    }
  };

  const formatAmount = () => {
    const num = Number(form.amount);
    if (Number.isNaN(num)) return form.amount;
    return num.toLocaleString(undefined, { maximumFractionDigits: 7 });
  };

  if (step === 'success' && result) {
    return (
      <main className="min-h-screen bg-gray-50 p-6">
        <div className="mx-auto max-w-md">
          <div className="mb-6 flex items-center justify-between">
            <Link href="/home" className="text-2xl font-bold text-pocketlet-600">
              ← Pocketlet
            </Link>
          </div>
          <div className="rounded-2xl bg-white p-6 shadow-lg text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-3xl text-green-600">
              ✓
            </div>
            <h1 className="mb-2 text-xl font-semibold text-gray-900">Transfer sent</h1>
            <p className="mb-4 text-sm text-gray-600">
              {formatAmount()} {form.asset} is on its way.
            </p>
            <div className="mb-4 rounded-lg bg-gray-100 p-3">
              <p className="text-xs text-gray-500">Transaction hash</p>
              <p className="break-all text-xs font-mono text-gray-700">{result.hash}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Link
                href={`/transactions/${result.hash}`}
                className="rounded-lg bg-pocketlet-100 py-2.5 text-center font-semibold text-pocketlet-700 hover:bg-pocketlet-200"
              >
                View details
              </Link>
              <Link
                href="/home"
                className="rounded-lg bg-pocketlet-600 py-2.5 text-center font-semibold text-white hover:bg-pocketlet-700"
              >
                Done
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-md">
        <div className="mb-6 flex items-center justify-between">
          <Link href="/home" className="text-2xl font-bold text-pocketlet-600">
            ← Pocketlet
          </Link>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-lg">
          <h1 className="mb-4 text-xl font-semibold text-gray-900">Send</h1>

          {error && (
            <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
          )}

          {step === 'form' && (
            <form onSubmit={submitForm} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Asset
                </label>
                <select
                  value={form.asset}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, asset: e.target.value as 'USDC' | 'XLM' }))
                  }
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 focus:border-pocketlet-500 focus:outline-none focus:ring-2 focus:ring-pocketlet-100"
                >
                  <option value="USDC">USDC</option>
                  <option value="XLM">XLM</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Amount
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={form.amount}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      amount: e.target.value.replace(/[^0-9.]/g, ''),
                    }))
                  }
                  placeholder="0.00"
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 focus:border-pocketlet-500 focus:outline-none focus:ring-2 focus:ring-pocketlet-100"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">
                  Recipient
                </label>
                <input
                  type="text"
                  value={form.recipient}
                  onChange={(e) => setForm((f) => ({ ...f, recipient: e.target.value.trim() }))}
                  placeholder="@username, +639..., or G.../C..."
                  className="w-full rounded-lg border border-gray-300 px-4 py-3 font-mono text-sm focus:border-pocketlet-500 focus:outline-none focus:ring-2 focus:ring-pocketlet-100"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Enter a Pocketlet username, phone number, or Stellar address.
                </p>
              </div>

              <button
                type="submit"
                disabled={resolving}
                className="w-full rounded-lg bg-pocketlet-600 py-3 font-semibold text-white hover:bg-pocketlet-700 disabled:opacity-50"
              >
                {resolving ? 'Resolving...' : 'Review'}
              </button>
            </form>
          )}

          {step === 'review' && resolved && (
            <div className="space-y-4">
              <div className="rounded-lg bg-gray-50 p-4">
                <div className="mb-3 flex justify-between">
                  <span className="text-sm text-gray-500">Amount</span>
                  <span className="font-medium text-gray-900">
                    {formatAmount()} {form.asset}
                  </span>
                </div>
                <div className="mb-3 flex justify-between">
                  <span className="text-sm text-gray-500">To</span>
                  <span className="max-w-[60%] break-all text-right text-sm text-gray-900">
                    {resolved.type !== 'address' && (
                      <span className="block font-medium">{resolved.display}</span>
                    )}
                    <span className="block font-mono text-xs text-gray-600">{resolved.address}</span>
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">Network fee</span>
                  <span className="font-medium text-gray-900">~0.001 XLM</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setStep('form')}
                  className="rounded-lg bg-gray-100 py-3 font-semibold text-gray-700 hover:bg-gray-200"
                >
                  Back
                </button>
                <button
                  onClick={confirmTransfer}
                  className="rounded-lg bg-pocketlet-600 py-3 font-semibold text-white hover:bg-pocketlet-700"
                >
                  Confirm
                </button>
              </div>
            </div>
          )}

          {step === 'confirming' && (
            <div className="py-8 text-center">
              <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-pocketlet-200 border-t-pocketlet-600"></div>
              <p className="text-gray-600">Submitting to Stellar testnet...</p>
            </div>
          )}
        </div>
      </div>

      <PinModal
        isOpen={pinModalOpen}
        title="Confirm transfer"
        onConfirm={executeTransfer}
        onCancel={() => {
          setPinModalOpen(false);
          setStep('review');
        }}
      />
    </main>
  );
}
