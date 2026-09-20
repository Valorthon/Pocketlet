import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE_NAME } from '@/lib/auth/config';
import { verifySessionToken } from '@/lib/auth/session';
import {
  RECOVERY_COOKIE_NAME,
  verifyRecoveryToken,
} from '@/lib/auth/recovery-token';
import { getUserByEmail, setPasskeyChallenge } from '@/lib/auth/store';

/**
 * Issue a server-generated challenge for a passkey registration ceremony.
 *
 * The client hands this to passkey-kit, which puts it in the WebAuthn
 * credential-creation options; `api/wallet/deploy`, `api/wallet/backup-passkey`
 * and `api/wallet/recovery/submit` then require the signed response to carry
 * it back. Without this the ceremony's challenge was generated in the browser,
 * so a captured registration response could be replayed (issue #56).
 *
 * Accepts either a session cookie or a recovery cookie: account recovery
 * enrols a new passkey precisely when the user has no session.
 */
async function resolveEmail(): Promise<string | null> {
  const cookieStore = await cookies();

  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (sessionToken) {
    const session = await verifySessionToken(sessionToken);
    if (session) {
      return session.email;
    }
  }

  const recoveryToken = cookieStore.get(RECOVERY_COOKIE_NAME)?.value;
  if (recoveryToken) {
    const payload = await verifyRecoveryToken(recoveryToken);
    if (payload) {
      return payload.email;
    }
  }

  return null;
}

export async function POST(): Promise<NextResponse> {
  const email = await resolveEmail();
  if (!email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await getUserByEmail(email);
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // base64url, because that is how WebAuthn encodes the challenge in
  // clientDataJSON and therefore what @simplewebauthn compares against.
  const challenge = randomBytes(32).toString('base64url');
  await setPasskeyChallenge(user.email, challenge);

  return NextResponse.json({ challenge });
}
