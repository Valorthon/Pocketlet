import { randomInt } from 'node:crypto';

/**
 * The one-time codes emailed for signup verification and PIN reset.
 *
 * Before issue #18 these codes were handed back in the API response, so their
 * quality did not matter much: the caller already had them. Removing them from
 * the response makes the code the *only* secret protecting email verification
 * and PIN reset, which is why issue #121 had to ship alongside it. A six-digit
 * code is a 10^6 space, so all three properties below are load-bearing:
 *
 * 1. **A CSPRNG.** `Math.random()` is not one. Both routes used to roll their
 *    own `Math.floor(100000 + Math.random() * 900000)` — two copies of the same
 *    mistake. `randomInt` from `node:crypto` is the only generator here.
 * 2. **An expiry.** A code that never expires turns 10^6 into a budget an
 *    attacker can spend at leisure.
 * 3. **An attempt cap**, enforced in `src/lib/auth/store.ts`, so the budget
 *    cannot be spent at all.
 *
 * Comparison is constant-time via `src/lib/constant-time.ts`; see the store.
 */

/**
 * How long an issued code stays usable.
 *
 * 15 minutes, the same as `RECOVERY_CODE_EXPIRY_MS` — long enough for mail to
 * arrive and be read on another device, short enough that an intercepted code
 * is worthless by the time anyone acts on it.
 */
export const VERIFICATION_CODE_EXPIRY_MS = 15 * 60 * 1000;

/**
 * Wrong guesses allowed per issued code, after which the code is destroyed.
 *
 * Five rather than the recovery flow's three. Recovery re-keys the wallet and
 * is the highest-stakes flow in the app, so it stays stricter; email
 * verification and PIN reset are a tier below, and five still bounds an
 * attacker to 5/10^6 per issued code — and issuing codes is itself rate
 * limited per email and per IP (`src/lib/rate-limit.ts`).
 *
 * Exceeding the cap clears the code rather than setting a lockout timestamp
 * the way recovery does. The remedy is then "ask for another code", which is
 * rate limited, instead of "wait an hour" — and a lockout would hand anyone
 * who knows a victim's address a way to freeze that victim's signup or PIN
 * reset for an hour by guessing wrong on purpose.
 */
export const VERIFICATION_CODE_MAX_ATTEMPTS = 5;

/** A six-digit code from the CSPRNG. The only generator for these codes. */
export function generateVerificationCode(): string {
  return randomInt(100000, 1000000).toString();
}

/** When a code issued now stops being accepted. */
export function createVerificationCodeExpiry(now: number = Date.now()): Date {
  return new Date(now + VERIFICATION_CODE_EXPIRY_MS);
}

/** True once `expiresAt` has passed. Expiry is inclusive of the boundary. */
export function isVerificationCodeExpired(
  expiresAt: Date | string,
  now: number = Date.now()
): boolean {
  return new Date(expiresAt).getTime() <= now;
}
