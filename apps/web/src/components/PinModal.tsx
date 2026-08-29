'use client';

import { useState } from 'react';
import { PinKeypad } from '@/components/ui/PinKeypad';

interface PinModalProps {
  isOpen: boolean;
  title?: string;
  subtitle?: string;
  onConfirm: (pin: string) => void;
  onCancel: () => void;
}

export default function PinModal({
  isOpen,
  title = 'Confirm with PIN',
  subtitle = 'Enter your 6-digit PIN to continue.',
  onConfirm,
  onCancel,
}: PinModalProps) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!isOpen) {
    return null;
  }

  const submit = async (pin: string) => {
    setError(null);
    setLoading(true);
    try {
      onConfirm(pin);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PIN verification failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 backdrop-blur-xs sm:items-center sm:p-4">
      <div className="w-full max-w-sm rounded-t-3xl bg-white p-6 shadow-2xl sm:rounded-3xl">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-bold tracking-tight text-slate-900">{title}</h2>
          <button
            onClick={onCancel}
            disabled={loading}
            className="rounded-lg px-2 py-1 text-xs font-bold text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>

        <PinKeypad
          title=""
          subtitle={subtitle}
          disabled={loading}
          error={error}
          onComplete={submit}
        />
      </div>
    </div>
  );
}
