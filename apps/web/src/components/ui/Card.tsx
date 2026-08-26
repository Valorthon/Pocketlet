'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export type CardVariant = 'default' | 'flat' | 'elevated' | 'glass' | 'interactive';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  interactive?: boolean;
  padded?: boolean | 'sm' | 'md' | 'lg' | 'none';
  children?: React.ReactNode;
}

const paddingStyles: Record<string, string> = {
  none: '',
  sm: 'p-3.5',
  md: 'p-5',
  lg: 'p-6',
};

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant = 'default', interactive = false, padded = 'md', children, ...props }, ref) => {
    const variantStyles: Record<CardVariant, string> = {
      default: 'bg-white border border-slate-100 shadow-sm rounded-2xl',
      flat: 'bg-white border border-slate-200 rounded-2xl',
      elevated:
        'bg-white border border-slate-100 shadow-[0_12px_28px_-8px_rgba(15,23,42,0.08)] rounded-3xl',
      glass: 'bg-white/90 backdrop-blur-md border border-white/80 shadow-sm rounded-2xl',
      interactive:
        'bg-white border border-slate-100 shadow-sm hover:border-pocketlet-200 hover:shadow-md active:scale-[0.99] transition-all duration-150 cursor-pointer rounded-2xl',
    };

    const padClass =
      typeof padded === 'boolean'
        ? padded
          ? paddingStyles.md
          : ''
        : paddingStyles[padded] || paddingStyles.md;

    return (
      <div
        ref={ref}
        className={cn(
          'transition-all duration-150 overflow-hidden relative',
          variantStyles[variant],
          interactive && variant !== 'interactive' && 'cursor-pointer hover:border-pocketlet-200 active:scale-[0.99]',
          padClass,
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = 'Card';

export const CardHeader = ({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col space-y-1 pb-3', className)} {...props}>
    {children}
  </div>
);

export const CardTitle = ({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) => (
  <h3 className={cn('font-bold text-slate-900 leading-tight tracking-tight text-base', className)} {...props}>
    {children}
  </h3>
);

export const CardDescription = ({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) => (
  <p className={cn('text-xs text-slate-400 font-medium leading-relaxed', className)} {...props}>
    {children}
  </p>
);

export const CardContent = ({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('text-sm text-slate-700', className)} {...props}>
    {children}
  </div>
);

export const CardFooter = ({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex items-center pt-3 mt-3 border-t border-slate-100 text-xs text-slate-400', className)} {...props}>
    {children}
  </div>
);
