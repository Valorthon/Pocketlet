import { describe, it, expect, vi, afterEach } from 'vitest';

const originalEnv = {
  NEXT_PUBLIC_PASSKEY_RP_ID: process.env.NEXT_PUBLIC_PASSKEY_RP_ID,
  WEBAUTHN_RP_ID: process.env.WEBAUTHN_RP_ID,
};

async function importPasskeyKit() {
  vi.resetModules();
  const mod = await import('@/lib/wallet/passkey-kit');
  return mod;
}

describe('passkey-kit RP_ID', () => {
  afterEach(() => {
    process.env.NEXT_PUBLIC_PASSKEY_RP_ID = originalEnv.NEXT_PUBLIC_PASSKEY_RP_ID;
    process.env.WEBAUTHN_RP_ID = originalEnv.WEBAUTHN_RP_ID;
  });

  it('falls back to WEBAUTHN_RP_ID when NEXT_PUBLIC_PASSKEY_RP_ID is empty', async () => {
    process.env.NEXT_PUBLIC_PASSKEY_RP_ID = '';
    process.env.WEBAUTHN_RP_ID = 'localhost';
    const mod = await importPasskeyKit();
    expect(mod.RP_ID).toBe('localhost');
  });

  it('falls back to undefined when both env vars are empty', async () => {
    process.env.NEXT_PUBLIC_PASSKEY_RP_ID = '';
    delete process.env.WEBAUTHN_RP_ID;
    const mod = await importPasskeyKit();
    expect(mod.RP_ID).toBeUndefined();
  });

  it('prefers NEXT_PUBLIC_PASSKEY_RP_ID when set', async () => {
    process.env.NEXT_PUBLIC_PASSKEY_RP_ID = 'wallet.example.com';
    process.env.WEBAUTHN_RP_ID = 'localhost';
    const mod = await importPasskeyKit();
    expect(mod.RP_ID).toBe('wallet.example.com');
  });
});
