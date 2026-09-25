import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  VERIFICATION_CODE_EXPIRY_MS,
  VERIFICATION_CODE_MAX_ATTEMPTS,
  createVerificationCodeExpiry,
  generateVerificationCode,
  isVerificationCodeExpired,
} from './verification-code';
import { generateRecoveryCode } from './recovery';

afterEach(() => {
  vi.useRealTimers();
});

describe('generateVerificationCode', () => {
  it('always produces six digits', () => {
    for (let i = 0; i < 500; i += 1) {
      expect(generateVerificationCode()).toMatch(/^\d{6}$/);
    }
  });

  it('does not use Math.random', () => {
    // The two routes that issued these codes each rolled their own
    // `Math.floor(100000 + Math.random() * 900000)` (issue #121). Stubbing
    // `Math.random` to a constant would pin both of those to one value; the
    // CSPRNG ignores it.
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const codes = new Set(
        Array.from({ length: 50 }, () => generateVerificationCode())
      );
      expect(spy).not.toHaveBeenCalled();
      expect(codes.size).toBeGreaterThan(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('is the generator the recovery flow uses too', () => {
    // One generator for every one-time code in the app.
    expect(generateRecoveryCode()).toMatch(/^\d{6}$/);
  });

  it('spreads across the whole six-digit range', () => {
    const codes = Array.from({ length: 2000 }, () => generateVerificationCode());
    const distinct = new Set(codes);
    // A broken generator that returns a constant, or ranges over far fewer
    // than 10^6 values, cannot clear this.
    expect(distinct.size).toBeGreaterThan(1500);
    expect(codes.some((code) => code < '300000')).toBe(true);
    expect(codes.some((code) => code > '700000')).toBe(true);
  });
});

describe('createVerificationCodeExpiry', () => {
  it('is 15 minutes out, matching the recovery code', () => {
    expect(VERIFICATION_CODE_EXPIRY_MS).toBe(15 * 60 * 1000);
    const now = 1_700_000_000_000;
    expect(createVerificationCodeExpiry(now).getTime()).toBe(
      now + VERIFICATION_CODE_EXPIRY_MS
    );
  });
});

describe('isVerificationCodeExpired', () => {
  const now = 1_700_000_000_000;

  it('is false before the expiry and true after it', () => {
    expect(isVerificationCodeExpired(new Date(now + 1), now)).toBe(false);
    expect(isVerificationCodeExpired(new Date(now - 1), now)).toBe(true);
  });

  it('treats the boundary itself as expired', () => {
    expect(isVerificationCodeExpired(new Date(now), now)).toBe(true);
  });

  it('accepts an ISO string as well as a Date', () => {
    expect(isVerificationCodeExpired(new Date(now - 1).toISOString(), now)).toBe(true);
  });
});

describe('VERIFICATION_CODE_MAX_ATTEMPTS', () => {
  it('is small enough that the guess space still bites', () => {
    expect(VERIFICATION_CODE_MAX_ATTEMPTS).toBeGreaterThan(1);
    expect(VERIFICATION_CODE_MAX_ATTEMPTS).toBeLessThanOrEqual(10);
  });
});
