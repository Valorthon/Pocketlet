import { describe, it, expect } from 'vitest';
import { cn, formatCurrency, truncateAddress } from './utils';

describe('cn', () => {
  it('joins class names and drops falsy values', () => {
    expect(cn('a', 'c')).toBe('a c');
    expect(cn('a', null, undefined, 'b')).toBe('a b');
  });

  it('merges conflicting tailwind utilities', () => {
    expect(cn('p-4', 'p-6')).toBe('p-6');
    expect(cn('text-slate-900', 'text-red-600')).toBe('text-red-600');
  });
});

describe('formatCurrency', () => {
  it('formats USDC/USD as USD currency', () => {
    expect(formatCurrency(2450.8, 'USDC')).toBe('$2,450.80');
    expect(formatCurrency('42.1', 'USD')).toBe('$42.10');
  });

  it('formats XLM with the XLM suffix', () => {
    expect(formatCurrency(14.5, 'XLM')).toBe('14.50 XLM');
  });

  it('returns a fallback for NaN', () => {
    expect(formatCurrency('not-a-number', 'USDC')).toBe('$0.00');
  });
});

describe('truncateAddress', () => {
  it('shortens long addresses', () => {
    const address = 'GATVJDFPIPADU74ALX4344HEQQZ2LGMNWABPXBOWYMVXM37KMTTUALTU';
    const result = truncateAddress(address, 4);
    expect(result).toBe('GATVJD...ALTU');
    expect(result.endsWith('...ALTU')).toBe(true);
  });

  it('returns empty string for empty input', () => {
    expect(truncateAddress('')).toBe('');
  });

  it('returns short addresses unchanged', () => {
    expect(truncateAddress('abc', 4)).toBe('abc');
  });
});
