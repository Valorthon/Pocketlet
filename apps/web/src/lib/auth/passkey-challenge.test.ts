import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  createUser,
  setPasskeyChallenge,
  takePasskeyChallenge,
  setPendingChallenge,
  clearPendingChallenge,
  getUserByEmail,
  PASSKEY_CHALLENGE_TTL_MS,
} from './store';

const EMAIL = 'alice@example.com';

async function seedUser(email = EMAIL) {
  await createUser(email, '000000');
  return email;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('takePasskeyChallenge', () => {
  it('returns null when none was issued', async () => {
    const email = await seedUser();
    expect(await takePasskeyChallenge(email)).toBeNull();
  });

  it('returns the issued challenge', async () => {
    const email = await seedUser();
    await setPasskeyChallenge(email, 'nonce-1');
    expect(await takePasskeyChallenge(email)).toBe('nonce-1');
  });

  // The property the whole fix rests on: a challenge works exactly once, so a
  // captured registration response cannot be replayed (issue #56).
  it('is single-use', async () => {
    const email = await seedUser();
    await setPasskeyChallenge(email, 'nonce-1');

    expect(await takePasskeyChallenge(email)).toBe('nonce-1');
    expect(await takePasskeyChallenge(email)).toBeNull();
  });

  it('clears the stored challenge as it reads it', async () => {
    const email = await seedUser();
    await setPasskeyChallenge(email, 'nonce-1');
    await takePasskeyChallenge(email);

    const user = await getUserByEmail(email);
    expect(user?.passkeyChallenge).toBeUndefined();
    expect(user?.passkeyChallengeExpiresAt).toBeUndefined();
  });

  it('refuses an expired challenge', async () => {
    const email = await seedUser();
    await setPasskeyChallenge(email, 'nonce-1');

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + PASSKEY_CHALLENGE_TTL_MS + 1000);

    expect(await takePasskeyChallenge(email)).toBeNull();
  });

  it('accepts a challenge that has not quite expired', async () => {
    const email = await seedUser();
    await setPasskeyChallenge(email, 'nonce-1');

    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + PASSKEY_CHALLENGE_TTL_MS - 1000);

    expect(await takePasskeyChallenge(email)).toBe('nonce-1');
  });

  it('only the winner of a race gets the challenge', async () => {
    const email = await seedUser();
    await setPasskeyChallenge(email, 'nonce-1');

    const results = await Promise.all([
      takePasskeyChallenge(email),
      takePasskeyChallenge(email),
      takePasskeyChallenge(email),
    ]);

    expect(results.filter((r) => r === 'nonce-1')).toHaveLength(1);
    expect(results.filter((r) => r === null)).toHaveLength(2);
  });

  it('issuing again replaces the previous challenge', async () => {
    const email = await seedUser();
    await setPasskeyChallenge(email, 'nonce-1');
    await setPasskeyChallenge(email, 'nonce-2');

    expect(await takePasskeyChallenge(email)).toBe('nonce-2');
  });

  it('is scoped to one user', async () => {
    const alice = await seedUser('alice@example.com');
    const bob = await seedUser('bob@example.com');
    await setPasskeyChallenge(alice, 'alice-nonce');

    expect(await takePasskeyChallenge(bob)).toBeNull();
    expect(await takePasskeyChallenge(alice)).toBe('alice-nonce');
  });

  // Registration and login keep separate challenges, so enrolling a backup
  // passkey mid-session cannot clobber an in-flight login.
  it('does not touch the login challenge', async () => {
    const email = await seedUser();
    await setPendingChallenge(email, 'login-nonce');
    await setPasskeyChallenge(email, 'registration-nonce');

    expect(await takePasskeyChallenge(email)).toBe('registration-nonce');

    const user = await getUserByEmail(email);
    expect(user?.pendingChallenge).toBe('login-nonce');
  });
});

describe('clearPendingChallenge', () => {
  it('drops the login challenge so an assertion cannot be replayed', async () => {
    const email = await seedUser();
    await setPendingChallenge(email, 'login-nonce');

    await clearPendingChallenge(email);

    const user = await getUserByEmail(email);
    expect(user?.pendingChallenge).toBeUndefined();
  });

  it('leaves a registration challenge alone', async () => {
    const email = await seedUser();
    await setPasskeyChallenge(email, 'registration-nonce');

    await clearPendingChallenge(email);

    expect(await takePasskeyChallenge(email)).toBe('registration-nonce');
  });
});
