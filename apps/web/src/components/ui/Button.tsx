'use client';

import React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
  children?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'primary',
      size = 'md',
      isLoading = false,
      leftIcon,
      rightIcon,
      fullWidth = false,
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    const baseStyles =
      'relative inline-flex items-center justify-center font-bold select-none transition-all duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-pocketlet-500 rounded-2xl';

    const variantStyles: Record<ButtonVariant, string> = {
      primary:
        'bg-pocketlet-600 hover:bg-pocketlet-700 text-white shadow-lg shadow-pocketlet-100 active:bg-pocketlet-800',
      secondary: 'bg-pocketlet-100 text-pocketlet-700 hover:bg-pocketlet-200 active:bg-pocketlet-300',
      ghost: 'bg-transparent text-slate-600 hover:bg-slate-100 active:bg-slate-200',
      outline:
        'bg-white text-slate-800 border border-slate-200 hover:bg-slate-50 active:bg-slate-100 shadow-sm',
      destructive:
        'bg-rose-50 text-rose-600 hover:bg-rose-100 active:bg-rose-200 border border-rose-200/80',
    };

    const sizeStyles: Record<ButtonSize, string> = {
      sm: 'h-9 px-3.5 text-xs font-bold gap-1.5 rounded-xl',
      md: 'h-12 px-5 text-sm font-bold gap-2 rounded-2xl',
      lg: 'h-14 px-6 text-base font-bold gap-2.5 rounded-2xl min-h-[48px]',
      icon: 'h-11 w-11 p-0 rounded-2xl flex items-center justify-center',
    };

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={cn(
          baseStyles,
          variantStyles[variant],
          sizeStyles[size],
          fullWidth ? 'w-full' : '',
          className
        )}
        {...props}
      >
        {isLoading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin text-current" />
            <span className="opacity-90">{children || 'Processing...'}</span>
          </>
        ) : (
          <>
            {leftIcon && <span className="flex shrink-0 items-center">{leftIcon}</span>}
            {children && <span>{children}</span>}
            {rightIcon && <span className="flex shrink-0 items-center">{rightIcon}</span>}
          </>
        )}
      </button>
    );
  }
);

Button.displayName = 'Button';
