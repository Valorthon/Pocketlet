import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Constant-time equality for short secrets.
 *
 * Extracted from `src/lib/admin.ts` (issue #61) when the email verification
 * and PIN reset codes needed the same treatment (issue #121). There is exactly
 * one implementation of this in the codebase on purpose: a second one is a
 * second chance to get it wrong, and the wrong version — `===` — looks
 * identical at the call site. Every one-time code in the app goes through
 * here, the recovery code included.
 */

/**
 * SHA-256 both sides before comparing. The digests are always 32 bytes, so
 * `timingSafeEqual` cannot throw on a length mismatch, and no length check is
 * needed — such a check would itself leak the secret's length.
 */
function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * True when `a` and `b` are the same string, compared in time that does not
 * depend on how many leading characters happen to match.
 *
 * Both arguments are hashed first, so this is safe for inputs of any length
 * and never reveals the length of either through timing.
 *
 * The parameters are `unknown`, not `string`, because the callers are handlers
 * feeding it a field off a parsed JSON body. A cast such as
 * `body as { code?: string }` is a claim, not a check: `{"code": 654321}`
 * satisfies the compiler and used to reach `createHash().update(value, 'utf8')`,
 * which throws `ERR_INVALID_ARG_TYPE` — an unhandled rejection and a 500 where
 * the answer should have been 401. A security primitive must not be the thing
 * that throws, so anything that is not a string is simply **not equal**: it
 * fails closed, and the caller's own 400 guard stays the place that explains
 * why. Two non-strings are unequal too, so `constantTimeEquals(null, null)` is
 * false and a missing stored secret can never match a missing submitted one.
 */
export function constantTimeEquals(a: unknown, b: unknown): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  return timingSafeEqual(digest(a), digest(b));
}
