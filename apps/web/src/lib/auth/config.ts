import { Networks } from '@stellar/stellar-sdk';

const DEV_SESSION_SECRETS = [
  'change-me-in-production',
  'dev-secret-change-in-production',
];

function isProductionNetwork(): boolean {
  return (
    (process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ?? Networks.TESTNET) ===
    Networks.PUBLIC
  );
}

export function validateProductionConfig(): void {
  if (!isProductionNetwork()) {
    return;
  }

  const sessionSecret = process.env.SESSION_SECRET?.trim();
  if (!sessionSecret) {
    throw new Error(
      'SESSION_SECRET is required in production. ' +
        'Set a strong, random secret (at least 32 bytes) via a secrets manager.'
    );
  }

  if (DEV_SESSION_SECRETS.includes(sessionSecret)) {
    throw new Error(
      'SESSION_SECRET cannot use the default/dev value in production. ' +
        'Generate a new random secret and update it via a secrets manager.'
    );
  }

  if (sessionSecret.length < 32) {
    throw new Error(
      'SESSION_SECRET must be at least 32 characters long in production. ' +
        'Generate a longer random secret via a secrets manager.'
    );
  }

  const origin = process.env.WEBAUTHN_ORIGIN?.trim();
  if (!origin || !origin.startsWith('https://')) {
    throw new Error(
      'WEBAUTHN_ORIGIN must be a valid HTTPS URL in production. ' +
        'Plain HTTP origins are insecure and WebAuthn will fail on non-localhost origins.'
    );
  }

  const rpId = process.env.WEBAUTHN_RP_ID?.trim();
  if (!rpId || rpId === 'localhost') {
    throw new Error(
      'WEBAUTHN_RP_ID must be a real domain in production. ' +
        'localhost is not allowed because passkeys are origin-bound.'
    );
  }

  const feePayerSecret = process.env.FEE_PAYER_SECRET_KEY?.trim();
  if (!feePayerSecret) {
    throw new Error(
      'FEE_PAYER_SECRET_KEY is required in production. ' +
        'Set the fee payer account secret via a secrets manager.'
    );
  }
}

export const RP_NAME = process.env.WEBAUTHN_RP_NAME ?? 'Pocketlet';
export const RP_ID = process.env.WEBAUTHN_RP_ID ?? 'localhost';
export const ORIGIN = process.env.WEBAUTHN_ORIGIN ?? 'http://localhost:3000';

export const SESSION_COOKIE_NAME = 'pocketlet_session';
export const SESSION_SECRET =
  process.env.SESSION_SECRET ?? 'dev-secret-change-in-production';
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

validateProductionConfig();
