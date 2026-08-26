'use client';

import React, { useEffect, useState } from 'react';
import { Delete, Fingerprint, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface PinKeypadProps {
  pinLength?: number;
  onComplete: (pin: string) => void;
  onChange?: (pin: string) => void;
  onBiometricClick?: () => void;
  hasBiometrics?: boolean;
  biometricLabel?: string;
  error?: string | null;
  disabled?: boolean;
  title?: string;
  subtitle?: string;
}

const KEYPAD_DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

export const PinKeypad: React.FC<PinKeypadProps> = ({
  pinLength = 6,
  onComplete,
  onChange,
  onBiometricClick,
  hasBiometrics = false,
  biometricLabel = 'Passkey',
  error,
  disabled = false,
  title = 'Enter Security PIN',
  subtitle = 'Authorize transaction on Stellar network',
}) => {
  const [pin, setPin] = useState<string>('');
  const [isShaking, setIsShaking] = useState(false);

  useEffect(() => {
    if (error) {
      setIsShaking(true);
      const timer = setTimeout(() => {
        setIsShaking(false);
        setPin('');
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [error]);

  const handleDigit = (digit: string) => {
    if (disabled || pin.length >= pinLength) return;
    const newPin = pin + digit;
    setPin(newPin);
    onChange?.(newPin);

    if (newPin.length === pinLength) {
      setTimeout(() => {
        onComplete(newPin);
      }, 100);
    }
  };

  const handleDelete = () => {
    if (disabled || pin.length === 0) return;
    const newPin = pin.slice(0, -1);
    setPin(newPin);
    onChange?.(newPin);
  };

  return (
    <div className="mx-auto flex w-full max-w-xs select-none flex-col items-center">
      {title && (
        <div className="mb-5 text-center">
          <h4 className="text-base font-bold tracking-tight text-slate-900">{title}</h4>
          {subtitle && <p className="mt-0.5 text-xs font-medium text-slate-400">{subtitle}</p>}
        </div>
      )}

      <div className={cn('mb-6 flex h-6 items-center justify-center gap-3', isShaking && 'animate-shake')}>
        {Array.from({ length: pinLength }).map((_, i) => {
          const isFilled = i < pin.length;
          return (
            <div
              key={i}
              className={cn(
                'h-3.5 w-3.5 rounded-full transition-all duration-200',
                isFilled ? 'scale-110 bg-slate-900 shadow-sm' : 'scale-100 bg-slate-200'
              )}
            />
          );
        })}
      </div>

      {error && <p className="mb-3 animate-shake text-center text-xs font-bold text-rose-500">{error}</p>}

      <div className="grid w-full grid-cols-3 gap-2.5">
        {KEYPAD_DIGITS.map((num) => (
          <button
            key={num}
            type="button"
            disabled={disabled}
            onClick={() => handleDigit(num)}
            className="flex h-14 w-full items-center justify-center rounded-2xl border border-slate-100 bg-slate-50 text-lg font-bold text-slate-800 transition-all duration-100 hover:border-pocketlet-100 hover:bg-pocketlet-50 active:scale-90 active:bg-pocketlet-100 disabled:opacity-40"
          >
            {num}
          </button>
        ))}

        {hasBiometrics ? (
          <button
            type="button"
            disabled={disabled}
            onClick={onBiometricClick}
            className="flex h-14 w-full flex-col items-center justify-center rounded-2xl border border-pocketlet-100 bg-pocketlet-50 text-pocketlet-600 transition-all duration-100 hover:bg-pocketlet-100 active:scale-90 disabled:opacity-40"
            title="Authenticate with Passkey"
          >
            <Fingerprint className="h-5 w-5" />
            <span className="mt-0.5 text-[8px] font-bold uppercase tracking-wider">{biometricLabel}</span>
          </button>
        ) : (
          <div className="h-14" />
        )}

        <button
          type="button"
          disabled={disabled}
          onClick={() => handleDigit('0')}
          className="flex h-14 w-full items-center justify-center rounded-2xl border border-slate-100 bg-slate-50 text-lg font-bold text-slate-800 transition-all duration-100 hover:border-pocketlet-100 hover:bg-pocketlet-50 active:scale-90 active:bg-pocketlet-100 disabled:opacity-40"
        >
          0
        </button>

        <button
          type="button"
          disabled={disabled || pin.length === 0}
          onClick={handleDelete}
          className="flex h-14 w-full flex-col items-center justify-center rounded-2xl border border-slate-100 bg-slate-50 text-slate-500 transition-all duration-100 hover:bg-slate-100 active:scale-90 disabled:opacity-30"
          title="Delete"
        >
          <Delete className="h-5 w-5" />
        </button>
      </div>

      <div className="mt-4 flex items-center justify-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
        <ShieldCheck className="h-3.5 w-3.5 text-pocketlet-600" />
        <span>PIN protected</span>
      </div>
    </div>
  );
};
