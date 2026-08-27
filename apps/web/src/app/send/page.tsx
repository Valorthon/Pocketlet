'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { BASE_FEE } from '@stellar/stellar-sdk';
import type { AssembledTransaction } from '@stellar/stellar-sdk/contract';
import type { PasskeyKit } from 'passkey-kit';
import { CheckCircle2 } from 'lucide-react';
import PinModal from '@/components/PinModal';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { cn } from '@/lib/utils';
import { createPasskeyKit, prepareTokenTransferTx } from '@/lib/wallet/passkey-kit';
import { getUsdcContractId, getXlmContractId } from '@/lib/wallet/assets';
import { amountToBaseUnits, baseUnitsToDisplay } from '@/lib/wallet/amount';
import { validateRecipientFormat } from '@/lib/wallet/recipient-format';
import {
  hasUsableDeviceKey,
  getDeviceSigner,
} from '@/lib/wallet/device-key';

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

interface WalletInfo {
  walletContractId: string;
  primaryPasskeyKeyId: string;
}

interface Balances {
  xlm: string;
  usdc: string;
}

function getTokenContractId(asset: 'USDC' | 'XLM'): string {
  return asset === 'USDC' ? getUsdcContractId() : getXlmContractId();
}

function formatFee(stroops: number): string {
  const xlm = stroops / 10_000_000;
  return xlm.toLocaleString(undefined, { maximumFractionDigits: 7 });
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
  const [fee, setFee] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [walletInfo, setWalletInfo] = useState<WalletInfo | null>(null);
  const [walletInfoLoading, setWalletInfoLoading] = useState(false);
  const [balances, setBalances] = useState<Balances | null>(null);
  const [balancesLoading, setBalancesLoading] = useState(false);

  const preparedKitRef = useRef<PasskeyKit | null>(null);
  const preparedTxRef = useRef<AssembledTransaction<null> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setWalletInfoLoading(true);
    async function fetchWalletInfo() {
      try {
        const res = await fetch('/api/wallet/session-key/info');
        if (!res.ok) {
          throw new Error('Failed to load wallet info');
        }
        const data = (await res.json()) as WalletInfo;
        if (!cancelled) {
          setWalletInfo(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load wallet info');
        }
      } finally {
        if (!cancelled) {
          setWalletInfoLoading(false);
        }
      }
    }
    void fetchWalletInfo();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setBalancesLoading(true);

    async function fetchBalances() {
      try {
        const res = await fetch('/api/wallet/balance');
        if (!res.ok) {
          if (!cancelled) setBalances(null);
          return;
        }
        const body = (await res.json()) as Balances;
        if (!cancelled) setBalances({ xlm: body.xlm, usdc: body.usdc });
      } catch {
        if (!cancelled) setBalances(null);
      } finally {
        if (!cancelled) setBalancesLoading(false);
      }
    }

    void fetchBalances();

    return () => {
      cancelled = true;
    };
  }, []);

  const validateForm = (): string | null => {
    if (!form.recipient.trim()) {
      return 'Recipient is required';
    }
    const recipientError = validateRecipientFormat(form.recipient);
    if (recipientError) {
      return recipientError;
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

    if (!balances) {
      setError('Balance not loaded. Please try again.');
      return;
    }

    const availableBalance = form.asset === 'USDC' ? balances.usdc : balances.xlm;
    if (amountToBaseUnits(form.amount) > BigInt(availableBalance)) {
      setError(`Insufficient ${form.asset} balance`);
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

  useEffect(() => {
    if (step !== 'review' || !resolved || !walletInfo) {
      setFee(null);
      preparedKitRef.current = null;
      preparedTxRef.current = null;
      return;
    }

    const recipientAddress = resolved.address;

    const info = walletInfo;
    if (!info) return;

    let cancelled = false;
    setPreparing(true);
    setError(null);

    async function prepare() {
      try {
        const kit = createPasskeyKit();
        await kit.connectWallet({ keyId: info.primaryPasskeyKeyId });

        if (!kit.contractId) {
          throw new Error('Wallet not connected');
        }

        const baseAmount = amountToBaseUnits(form.amount);
        const tx = await prepareTokenTransferTx(
          kit,
          getTokenContractId(form.asset),
          recipientAddress,
          baseAmount
        );

        const simulation = tx.simulation;
        if (!simulation || !('minResourceFee' in simulation)) {
          throw new Error('Simulation data unavailable');
        }

        const minResourceFee = Number(simulation.minResourceFee);
        const totalFeeStroops = minResourceFee + Number(BASE_FEE);

        if (!cancelled) {
          preparedKitRef.current = kit;
          preparedTxRef.current = tx;
          setFee(formatFee(totalFeeStroops));
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to prepare transfer');
        }
      } finally {
        if (!cancelled) {
          setPreparing(false);
        }
      }
    }

    void prepare();

    return () => {
      cancelled = true;
    };
  }, [step, resolved, walletInfo, form.asset, form.amount]);

  const confirmTransfer = () => {
    setPinModalOpen(true);
  };

  const executeTransfer = async (pin: string) => {
    setPinModalOpen(false);
    setStep('confirming');
    setError(null);

    try {
      const kit = preparedKitRef.current;
      const tx = preparedTxRef.current;

      if (!kit || !tx) {
        throw new Error('Transfer not prepared');
      }

      if (!walletInfo) {
        throw new Error('Wallet info not loaded');
      }

      if (!(await hasUsableDeviceKey())) {
        throw new Error('Device key expired. Please log in again.');
      }

      const signer = await getDeviceSigner(pin);
      console.log('Signing transfer with device key:', signer.address);
      await kit.sign(tx, signer);
      const signedXdr = tx.toXDR();
      console.log('Transfer signed; submitting to server...');

      const res = await fetch('/api/wallet/transfer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signedXdr,
          asset: form.asset,
          amount: form.amount,
          recipient: form.recipient.trim(),
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
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-md">
          <div className="mb-6 flex items-center justify-between">
            <Link href="/home" className="text-2xl font-bold text-pocketlet-600">
              ← Pocketlet
            </Link>
          </div>
          <div className="rounded-3xl bg-white p-6 text-center shadow-lg">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <CheckCircle2 className="h-8 w-8" />
            </div>
            <h1 className="mb-2 text-xl font-bold text-slate-900">Transfer sent</h1>
            <p className="mb-4 text-sm text-slate-600">
              {formatAmount()} {form.asset} is on its way.
            </p>
            <div className="mb-4 rounded-lg bg-slate-100 p-3">
              <p className="text-xs text-slate-500">Transaction hash</p>
              <p className="break-all font-mono text-xs text-slate-700">{result.hash}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Link
                href={`/transactions/${result.hash}`}
                className="rounded-xl bg-pocketlet-100 py-2.5 text-center text-sm font-semibold text-pocketlet-700 hover:bg-pocketlet-200"
              >
                View details
              </Link>
              <Link
                href="/home"
                className="rounded-xl bg-pocketlet-600 py-2.5 text-center text-sm font-semibold text-white hover:bg-pocketlet-700"
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
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-md">
        <div className="mb-6 flex items-center justify-between">
          <Link href="/home" className="text-2xl font-bold text-pocketlet-600">
            ← Pocketlet
          </Link>
        </div>

        {error && (
          <div className="mb-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</div>
        )}

        {step === 'form' && (
          <form onSubmit={submitForm} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-bold text-slate-700">Asset</label>
              <div className="grid grid-cols-2 gap-2">
                {(['USDC', 'XLM'] as const).map((asset) => (
                  <button
                    key={asset}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, asset }))}
                    className={cn(
                      'rounded-xl border px-4 py-3 text-sm font-bold transition-colors',
                      form.asset === asset
                        ? 'border-pocketlet-500 bg-pocketlet-50 text-pocketlet-700'
                        : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                    )}
                  >
                    {asset}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold text-slate-700">Amount</label>
              <div className="relative">
                <span className="absolute left-3 top-3 text-lg font-bold text-slate-400">
                  {form.asset === 'USDC' ? '$' : '◎'}
                </span>
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
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-8 pr-16 text-xl font-bold text-slate-900 focus:border-pocketlet-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-pocketlet-500"
                />
                <span className="absolute right-3 top-4 text-xs font-bold text-slate-400">
                  {form.asset}
                </span>
              </div>
              <p className="mt-1 flex justify-between text-[10px] text-slate-400">
                <span>
                  Available:{' '}
                  {balances && !balancesLoading
                    ? `${baseUnitsToDisplay(
                        form.asset === 'USDC' ? balances.usdc : balances.xlm
                      )} ${form.asset}`
                    : 'Loading…'}
                </span>
                <span className="font-bold text-emerald-600">Zero network fee</span>
              </p>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold text-slate-700">Recipient</label>
              <input
                type="text"
                value={form.recipient}
                onChange={(e) => setForm((f) => ({ ...f, recipient: e.target.value.trim() }))}
                placeholder="@username, +639..., or G.../C..."
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 font-mono text-sm text-slate-900 focus:border-pocketlet-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-pocketlet-500"
              />
              <p className="mt-1 text-xs text-slate-500">
                Enter a Pocketlet username, phone number, or Stellar address.
              </p>
            </div>

            <Button
              type="submit"
              fullWidth
              isLoading={resolving || walletInfoLoading || balancesLoading}
            >
              Review
            </Button>
          </form>
        )}

        {step === 'review' && resolved && (
          <div className="space-y-4">
            <Card padded="md" className="space-y-3">
              <div className="flex justify-between">
                <span className="text-sm text-slate-500">Amount</span>
                <span className="font-bold text-slate-900">
                  {formatAmount()} {form.asset}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-slate-500">To</span>
                <span className="max-w-[60%] break-all text-right text-sm text-slate-900">
                  {resolved.type !== 'address' && (
                    <span className="block font-bold">{resolved.display}</span>
                  )}
                  <span className="block font-mono text-xs text-slate-600">{resolved.address}</span>
                </span>
              </div>
              <div className="flex justify-between border-t border-slate-100 pt-3">
                <span className="text-sm text-slate-500">Network fee</span>
                <span className="font-bold text-slate-900">
                  {fee !== null ? `~${fee} XLM` : preparing ? 'Estimating...' : '—'}
                </span>
              </div>
            </Card>

            <div className="grid grid-cols-2 gap-3">
              <Button variant="secondary" onClick={() => setStep('form')}>
                Back
              </Button>
              <Button onClick={confirmTransfer} disabled={preparing || fee === null}>
                Confirm
              </Button>
            </div>
          </div>
        )}

        {step === 'confirming' && (
          <div className="rounded-2xl bg-white p-8 text-center shadow-lg">
            <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-pocketlet-200 border-t-pocketlet-600" />
            <p className="text-slate-600">Submitting to Stellar testnet...</p>
          </div>
        )}
      </div>

      <PinModal
        isOpen={pinModalOpen}
        title="Confirm transfer"
        subtitle="Enter your 6-digit PIN to authorize."
        onConfirm={executeTransfer}
        onCancel={() => {
          setPinModalOpen(false);
          setStep('review');
        }}
      />
    </main>
  );
}
