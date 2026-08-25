import { describe, it, expect } from 'vitest';
import {
  amountToBaseUnits,
  baseUnitsToDisplay,
  i128ScVal,
  addressScVal,
} from './amount';
import { Address } from '@stellar/stellar-sdk';

describe('amountToBaseUnits', () => {
  it('converts an integer amount', () => {
    expect(amountToBaseUnits('10')).toBe(100_000_000n);
  });

  it('converts a decimal amount', () => {
    expect(amountToBaseUnits('1.5')).toBe(15_000_000n);
  });

  it('pads fractional decimals', () => {
    expect(amountToBaseUnits('0.1')).toBe(1_000_000n);
  });

  it('truncates excess decimals to 7 places', () => {
    expect(amountToBaseUnits('1.123456789')).toBe(11_234_567n);
  });

  it('handles leading-zero integer part', () => {
    expect(amountToBaseUnits('0.0000001')).toBe(1n);
  });
});

describe('baseUnitsToDisplay', () => {
  it('formats an integer string', () => {
    expect(baseUnitsToDisplay('50000000')).toBe('5');
  });

  it('formats a bigint', () => {
    expect(baseUnitsToDisplay(10_000_000n)).toBe('1');
  });

  it('formats a fractional value', () => {
    expect(baseUnitsToDisplay('1000000')).toBe('0.1');
  });

  it('honors a custom decimals argument', () => {
    expect(baseUnitsToDisplay('500', 2)).toBe('5');
  });
});

describe('i128ScVal', () => {
  it('round-trips through i128ToBigInt', () => {
    const value = 123_456_789n;
    const scVal = i128ScVal(value);
    expect(scVal.i128().lo().toBigInt() + (scVal.i128().hi().toBigInt() << 64n)).toBe(value);
  });
});

describe('addressScVal', () => {
  it('encodes a Stellar address', () => {
    const addr = 'GATVJDFPIPADU74ALX4344HEQQZ2LGMNWABPXBOWYMVXM37KMTTUALTU';
    const scVal = addressScVal(addr);
    expect(Address.fromScVal(scVal).toString()).toBe(addr);
  });
});
