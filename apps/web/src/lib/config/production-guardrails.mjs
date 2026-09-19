/* global process */

/**
 * The single production guardrail, shared by build time and runtime.
 *
 * This is plain ESM JavaScript, not TypeScript, because `next.config.mjs` is
 * loaded by Node's ESM loader before any transpilation happens — Next 14 has
 * no `next.config.ts` support. `next.config.mjs` imports it by relative path
 * with the extension (Node ESM requires both); `src/lib/auth/config.ts`
 * imports it through the `@/` alias, which webpack and vitest resolve and
 * `allowJs` type-checks.
 *
 * For the same reason the public-network passphrase is a literal here rather
 * than `Networks.PUBLIC` from `@stellar/stellar-sdk`: importing the SDK would
 * make every `next build` pay for it at config-load time.
 *
 * Both entry points previously kept their own copy of these checks and drifted
 * apart — build time enforced CLAIM_SECRET_ENCRYPTION_KEY, runtime enforced
 * FEE_PAYER_SECRET_KEY, and neither enforced both (issue #57).
 */

const PUBLIC_NETWORK_PASSPHRASE =
  'Public Global Stellar Network ; September 2015';
const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

/** Placeholder values shipped in .env.example — never valid in production. */
const DEFAULT_SECRETS = [
  'change-me-in-production',
  'dev-secret-change-in-production',
];

/**
 * True when the app is pointed at the Stellar public network.
 *
 * An unset passphrase means testnet. An empty string is treated as unset
 * rather than as "not public", so a blank value cannot silently switch the
 * guardrails off.
 */
export function isProductionNetwork() {
  const passphrase =
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE?.trim() ||
    TESTNET_PASSPHRASE;
  return passphrase === PUBLIC_NETWORK_PASSPHRASE;
}

/**
 * Callers pass the value rather than the name so that every environment read
 * in this file is spelled out in full. `src/lib/env-parity.test.ts` finds
 * variables with a regex and cannot see dynamic subscript access, so reading
 * by computed name would blind the .env.example parity check.
 */
function requireSecret(name, raw, remediation) {
  const value = raw?.trim();
  if (!value) {
    throw new Error(`${name} is required in production. ${remediation}`);
  }
  if (DEFAULT_SECRETS.includes(value)) {
    throw new Error(
      `${name} cannot use the default/dev value in production. ` +
        'Generate a new random secret and update it via a secrets manager.'
    );
  }
  return value;
}

/**
 * Throw unless every public-network requirement is met.
 *
 * No-op on testnet. Called at module scope by both `next.config.mjs` and
 * `src/lib/auth/config.ts`, so a misconfigured mainnet deploy fails at build
 * AND at boot rather than at first use.
 */
export function validateProductionConfig() {
  if (!isProductionNetwork()) {
    return;
  }

  const sessionSecret = requireSecret(
    'SESSION_SECRET',
    process.env.SESSION_SECRET,
    'Set a strong, random secret (at least 32 bytes) via a secrets manager.'
  );
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

  requireSecret(
    'FEE_PAYER_SECRET_KEY',
    process.env.FEE_PAYER_SECRET_KEY,
    'Set the fee payer account secret via a secrets manager.'
  );

  requireSecret(
    'CLAIM_SECRET_ENCRYPTION_KEY',
    process.env.CLAIM_SECRET_ENCRYPTION_KEY,
    'Generate a strong 32-byte hex secret and store it in a secrets manager.'
  );
}
