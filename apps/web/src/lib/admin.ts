import { constantTimeEquals } from './constant-time';

/** Placeholder values shipped in .env.example — never valid tokens. */
const DEFAULT_ADMIN_TOKENS = [
  'change-me-in-production',
  'dev-secret-change-in-production',
];

export type AdminAuthResult =
  | { ok: true }
  | { ok: false; reason: 'unconfigured' | 'invalid' };

export function verifyAdminToken(authHeader: string | null): AdminAuthResult {
  const expected = process.env.ADMIN_SECRET_TOKEN?.trim();
  if (!expected || DEFAULT_ADMIN_TOKENS.includes(expected)) {
    return { ok: false, reason: 'unconfigured' };
  }

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { ok: false, reason: 'invalid' };
  }

  const token = authHeader.slice('Bearer '.length).trim();
  // Constant-time, via the single shared implementation in
  // src/lib/constant-time.ts — never `===`.
  return constantTimeEquals(token, expected)
    ? { ok: true }
    : { ok: false, reason: 'invalid' };
}
