import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  validateProductionConfig,
  isProductionNetwork,
} from './production-guardrails.mjs';

const PUBLIC = 'Public Global Stellar Network ; September 2015';
const TESTNET = 'Test SDF Network ; September 2015';

const GUARDED = [
  'NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE',
  'SESSION_SECRET',
  'WEBAUTHN_ORIGIN',
  'WEBAUTHN_RP_ID',
  'FEE_PAYER_SECRET_KEY',
  'CLAIM_SECRET_ENCRYPTION_KEY',
] as const;

const originalEnv = Object.fromEntries(
  GUARDED.map((name) => [name, process.env[name]])
);

/** A configuration that satisfies every rule. */
function setValidProductionEnv(): void {
  process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = PUBLIC;
  process.env.SESSION_SECRET = 'strong-production-secret-32-characters';
  process.env.WEBAUTHN_ORIGIN = 'https://example.com';
  process.env.WEBAUTHN_RP_ID = 'example.com';
  process.env.FEE_PAYER_SECRET_KEY =
    'SBI2ATXEXZNK7L53NN4AWQMVCZB2HVULL3LKM7FYVZWL25IUHJOE65YS';
  process.env.CLAIM_SECRET_ENCRYPTION_KEY =
    '9f2c7a1e5b3d80460fae1c9d7b25380e46af1c9d7b25380e46af1c9d7b25380e';
}

beforeEach(() => {
  for (const name of GUARDED) delete process.env[name];
});

afterAll(() => {
  for (const name of GUARDED) {
    const value = originalEnv[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('isProductionNetwork', () => {
  it('is false when the passphrase is unset', () => {
    expect(isProductionNetwork()).toBe(false);
  });

  it('is false on testnet', () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = TESTNET;
    expect(isProductionNetwork()).toBe(false);
  });

  it('is true on the public network', () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = PUBLIC;
    expect(isProductionNetwork()).toBe(true);
  });

  // Both old copies used `??`, so an empty string fell through as "not public"
  // and silently disabled every guardrail.
  it('treats an empty passphrase as unset rather than as not-public', () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = '';
    expect(isProductionNetwork()).toBe(false);
    expect(() => validateProductionConfig()).not.toThrow();
  });
});

describe('validateProductionConfig', () => {
  it('does nothing on testnet, however broken the config', () => {
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE = TESTNET;
    process.env.SESSION_SECRET = 'change-me-in-production';
    expect(() => validateProductionConfig()).not.toThrow();
  });

  it('accepts a complete production configuration', () => {
    setValidProductionEnv();
    expect(() => validateProductionConfig()).not.toThrow();
  });

  // The point of issue #57: each of these is now enforced by BOTH entry
  // points, where previously the two disagreed about the last two.
  it.each([
    ['SESSION_SECRET', 'SESSION_SECRET is required in production'],
    ['WEBAUTHN_ORIGIN', 'WEBAUTHN_ORIGIN must be a valid HTTPS URL'],
    ['WEBAUTHN_RP_ID', 'WEBAUTHN_RP_ID must be a real domain'],
    ['FEE_PAYER_SECRET_KEY', 'FEE_PAYER_SECRET_KEY is required in production'],
    [
      'CLAIM_SECRET_ENCRYPTION_KEY',
      'CLAIM_SECRET_ENCRYPTION_KEY is required in production',
    ],
  ])('requires %s on the public network', (name, message) => {
    setValidProductionEnv();
    delete process.env[name];
    expect(() => validateProductionConfig()).toThrow(message);
  });

  it.each(['change-me-in-production', 'dev-secret-change-in-production'])(
    'rejects the %s placeholder in any guarded secret',
    (placeholder) => {
      setValidProductionEnv();
      process.env.CLAIM_SECRET_ENCRYPTION_KEY = placeholder;
      expect(() => validateProductionConfig()).toThrow(
        'CLAIM_SECRET_ENCRYPTION_KEY cannot use the default/dev value'
      );
    }
  );

  it('rejects a SESSION_SECRET shorter than 32 characters', () => {
    setValidProductionEnv();
    process.env.SESSION_SECRET = 'short-secret';
    expect(() => validateProductionConfig()).toThrow(
      'must be at least 32 characters'
    );
  });

  it('rejects a plain-HTTP WebAuthn origin', () => {
    setValidProductionEnv();
    process.env.WEBAUTHN_ORIGIN = 'http://example.com';
    expect(() => validateProductionConfig()).toThrow(
      'WEBAUTHN_ORIGIN must be a valid HTTPS URL'
    );
  });

  it('rejects localhost as the RP ID', () => {
    setValidProductionEnv();
    process.env.WEBAUTHN_RP_ID = 'localhost';
    expect(() => validateProductionConfig()).toThrow(
      'WEBAUTHN_RP_ID must be a real domain'
    );
  });

  it('ignores surrounding whitespace when checking presence', () => {
    setValidProductionEnv();
    process.env.FEE_PAYER_SECRET_KEY = '   ';
    expect(() => validateProductionConfig()).toThrow(
      'FEE_PAYER_SECRET_KEY is required in production'
    );
  });
});
