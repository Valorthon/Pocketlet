// Build-time half of the production guardrails. The runtime half lives in
// src/lib/auth/config.ts; both call the same module so they cannot drift
// apart again (issue #57). Node's ESM loader resolves this before any
// transpilation, hence the explicit .mjs extension and relative path.
import { validateProductionConfig } from './src/lib/config/production-guardrails.mjs';

validateProductionConfig();

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // Next 15 loads src/instrumentation.ts on its own, so the former
  // experimental.instrumentationHook flag is gone. The file still has to run —
  // it is what applies the Drizzle migrations at boot.
  serverExternalPackages: ['@simplewebauthn/server', 'pg', 'drizzle-orm'],
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
