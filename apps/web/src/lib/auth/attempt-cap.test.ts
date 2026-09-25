import { describe, it, expect } from 'vitest';
import {
  createUser,
  getUserByEmail,
  setEmailVerified,
  setPin,
  setPinResetCode,
  setRecoveryInitiated,
  verifyEmailVerificationCode,
  verifyPinResetCode,
  verifyRecoveryCode,
  RECOVERY_MAX_ATTEMPTS,
} from './store';
import { VERIFICATION_CODE_MAX_ATTEMPTS } from './verification-code';

/**
 * The attempt caps hold when the guesses arrive **at the same time**.
 *
 * This is the test whose absence let the bug through. All three verifiers
 * counted wrong guesses with a read-modify-write — read the count from an
 * earlier `getUserByEmail`, add one in JavaScript, write the sum back — and
 * nothing serialised the three steps. Twenty guesses issued in parallel all
 * read the same stale count, all wrote the same number, the cap was never
 * reached, and the code survived: `POST /api/auth/verify-email` had no rate
 * limit at all, so an attacker could pipeline the whole 10^6 space through it
 * for the code's fifteen-minute lifetime. Sequentially the same twenty guesses
 * destroyed the code on the fifth, which is why the sequential tests elsewhere
 * were all green.
 *
 * An atomic increment — `set x = coalesce(x, 0) + 1 ... returning x`, deciding
 * the cap on the returned value — is NOT the fix, and was tried first: the
 * counter came out right but 10 of 20 parallel guesses were still answered
 * `invalid`, because the comparison happens in JavaScript (constant-time
 * cannot be spelled as SQL `=`), so every request that read the row before the
 * cap landed still had its guess checked against a live code. The cap of five
 * silently became "however many requests you can have in flight".
 *
 * The fix is therefore the whole read/compare/write inside one transaction
 * behind `SELECT … FOR UPDATE` (`verifyOneTimeCode`, `verifyRecoveryCode`).
 * The row lock is load-bearing — do not "simplify" it back to a bare atomic
 * increment. That form is only sufficient for `recordRecoveryAttemptOn`, which
 * does no comparison. Each block below asserts the same thing twice over:
 * parallel and sequential agree.
 *
 * A concurrency test cannot prove the absence of a race, only catch a large
 * one. `GUESSES` is deliberately several times the cap so that a
 * read-modify-write cannot pass by luck; with the old code these fail on every
 * run.
 */

const EMAIL = 'alice@example.com';
const GUESSES = 20;
const WRONG = '000000';

/** `count` distinct six-digit codes, none of them the one being guessed at. */
function wrongCodes(count: number): string[] {
  return Array.from({ length: count }, (_, i) => String(100000 + i));
}

describe('signup code attempt cap under concurrency', () => {
  it('destroys the code even when every wrong guess arrives at once', async () => {
    await createUser(EMAIL, '123456');

    const results = await Promise.all(
      wrongCodes(GUESSES).map((code) => verifyEmailVerificationCode(EMAIL, code))
    );

    expect(results.every((r) => !r.ok)).toBe(true);

    const user = await getUserByEmail(EMAIL);
    expect(user?.verificationCode).toBeUndefined();
    expect(user?.verificationCodeExpiresAt).toBeUndefined();
    expect(user?.verificationCodeAttempts).toBeUndefined();

    // The real code no longer works either: that is what "the cap held" means.
    expect(await verifyEmailVerificationCode(EMAIL, '123456')).toEqual({
      ok: false,
      reason: 'no-code',
    });
  });

  it('never hands out more than the budget of "invalid" answers', async () => {
    await createUser(EMAIL, '123456');

    const results = await Promise.all(
      wrongCodes(GUESSES).map((code) => verifyEmailVerificationCode(EMAIL, code))
    );

    // The row lock serialises the twenty, so the answers are exactly the
    // sequential ones: four "invalid, try again", one "out of attempts", and
    // then the code is gone for the rest. A read-modify-write answers all
    // twenty 'invalid', which is the whole bug in one assertion.
    const reasons = results.map((r) => (r.ok ? 'ok' : r.reason));
    expect(reasons.filter((r) => r === 'invalid')).toHaveLength(
      VERIFICATION_CODE_MAX_ATTEMPTS - 1
    );
    expect(reasons.filter((r) => r === 'too-many-attempts')).toHaveLength(1);
    expect(reasons.filter((r) => r === 'no-code')).toHaveLength(
      GUESSES - VERIFICATION_CODE_MAX_ATTEMPTS
    );
  });

  it('agrees with the sequential path', async () => {
    await createUser(EMAIL, '123456');

    for (let i = 1; i < VERIFICATION_CODE_MAX_ATTEMPTS; i += 1) {
      expect(await verifyEmailVerificationCode(EMAIL, WRONG)).toEqual({
        ok: false,
        reason: 'invalid',
      });
    }
    expect(await verifyEmailVerificationCode(EMAIL, WRONG)).toEqual({
      ok: false,
      reason: 'too-many-attempts',
    });
    expect((await getUserByEmail(EMAIL))?.verificationCode).toBeUndefined();
  });
});

describe('PIN reset code attempt cap under concurrency', () => {
  async function seed(): Promise<void> {
    await createUser(EMAIL, '000000');
    await setEmailVerified(EMAIL);
    await setPin(EMAIL, '111111');
    await setPinResetCode(EMAIL, '123456');
  }

  it('destroys the code even when every wrong guess arrives at once', async () => {
    await seed();

    const results = await Promise.all(
      wrongCodes(GUESSES).map((code) => verifyPinResetCode(EMAIL, code))
    );

    expect(results.every((r) => !r.ok)).toBe(true);
    const reasons = results.map((r) => (r.ok ? 'ok' : r.reason));
    expect(reasons.filter((r) => r === 'invalid')).toHaveLength(
      VERIFICATION_CODE_MAX_ATTEMPTS - 1
    );
    expect(reasons.filter((r) => r === 'too-many-attempts')).toHaveLength(1);

    const user = await getUserByEmail(EMAIL);
    expect(user?.pinResetCode).toBeUndefined();
    expect(user?.pinResetCodeExpiresAt).toBeUndefined();
    expect(user?.pinResetCodeAttempts).toBeUndefined();

    expect(await verifyPinResetCode(EMAIL, '123456')).toEqual({
      ok: false,
      reason: 'no-code',
    });
  });

  it('agrees with the sequential path', async () => {
    await seed();

    for (let i = 1; i < VERIFICATION_CODE_MAX_ATTEMPTS; i += 1) {
      expect(await verifyPinResetCode(EMAIL, WRONG)).toEqual({
        ok: false,
        reason: 'invalid',
      });
    }
    expect(await verifyPinResetCode(EMAIL, WRONG)).toEqual({
      ok: false,
      reason: 'too-many-attempts',
    });
    expect((await getUserByEmail(EMAIL))?.pinResetCode).toBeUndefined();
  });
});

/**
 * Recovery is stricter — three guesses, then an hour-long lockout instead of a
 * destroyed code — and it was the function the other two were modelled on, so
 * it carried the same flaw. Parallel guessing bypassed both the cap and the
 * lockout.
 */
describe('recovery code attempt cap under concurrency', () => {
  async function seed(): Promise<void> {
    await createUser(EMAIL, '000000');
    await setEmailVerified(EMAIL);
    await setRecoveryInitiated(
      EMAIL,
      '123456',
      new Date(Date.now() + 60_000).toISOString()
    );
  }

  it('locks the account even when every wrong guess arrives at once', async () => {
    await seed();

    const results = await Promise.allSettled(
      wrongCodes(GUESSES).map((code) => verifyRecoveryCode(EMAIL, code))
    );
    expect(results.every((r) => r.status === 'rejected')).toBe(true);

    const user = await getUserByEmail(EMAIL);
    // Exactly three attempts were ever evaluated: the seventeen behind them
    // found the account locked and were refused before they counted. With the
    // read-modify-write, `recoveryAttempts` stuck at 1 and
    // `recoveryLockedUntil` was never set at all.
    expect(user?.recoveryAttempts).toBe(RECOVERY_MAX_ATTEMPTS);
    expect(user?.recoveryLockedUntil).toBeDefined();
    const messages = results.map((r) =>
      r.status === 'rejected' ? String(r.reason) : 'resolved'
    );
    expect(
      messages.filter((m) => m.includes('Invalid recovery code'))
    ).toHaveLength(RECOVERY_MAX_ATTEMPTS);
    expect(
      messages.filter((m) => m.includes('Recovery is locked'))
    ).toHaveLength(GUESSES - RECOVERY_MAX_ATTEMPTS);
    expect(new Date(user?.recoveryLockedUntil ?? 0).getTime()).toBeGreaterThan(
      Date.now()
    );

    // The correct code is refused while the lockout stands.
    await expect(verifyRecoveryCode(EMAIL, '123456')).rejects.toThrow(
      'Recovery is locked'
    );
  });

  it('agrees with the sequential path', async () => {
    await seed();

    for (let i = 1; i < RECOVERY_MAX_ATTEMPTS; i += 1) {
      await expect(verifyRecoveryCode(EMAIL, WRONG)).rejects.toThrow(
        'Invalid recovery code'
      );
      expect((await getUserByEmail(EMAIL))?.recoveryLockedUntil).toBeUndefined();
    }

    await expect(verifyRecoveryCode(EMAIL, WRONG)).rejects.toThrow(
      'Invalid recovery code'
    );
    expect((await getUserByEmail(EMAIL))?.recoveryLockedUntil).toBeDefined();
    await expect(verifyRecoveryCode(EMAIL, '123456')).rejects.toThrow(
      'Recovery is locked'
    );
  });
});
