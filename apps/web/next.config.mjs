/* global process */

const PRODUCTION_DEFAULT_SECRETS = [
  'change-me-in-production',
  'dev-secret-change-in-production',
];

const PUBLIC_NETWORK_PASSPHRASE = 'Public Global Stellar Network ; September 2015';

function isProductionNetwork() {
  const passphrase =
    process.env.NEXT_PUBLIC_STELLAR_NETWORK_PASSPHRASE ??
    'Test SDF Network ; September 2015';
  return passphrase === PUBLIC_NETWORK_PASSPHRASE;
}

function validateProductionConfig() {
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

  if (PRODUCTION_DEFAULT_SECRETS.includes(sessionSecret)) {
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
}

validateProductionConfig();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  experimental: {
    instrumentationHook: true,
    serverComponentsExternalPackages: [
      '@simplewebauthn/server',
      'pg',
      'drizzle-orm',
    ],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals.push(({ request }, callback) => {
        if (request && /^(pg|drizzle-orm)(\/|$)/.test(request)) {
          return callback(null, `commonjs ${request}`);
        }
        return callback();
      });
    }
    return config;
  },
};

export default nextConfig;
