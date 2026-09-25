import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME } from './config';
import { verifySessionToken } from './session';
import { getUserByEmail, type User } from './store';

/**
 * The session preamble every authenticated wallet route repeats.
 *
 * Read the cookie, verify the JWT, load the user, check the user is in a state
 * that allows the operation. It was copy-pasted into a dozen route handlers,
 * which is how the fee-payer routes ended up with no single place to hang a
 * rate limit (issue #36).
 *
 * This is deliberately *not* `src/middleware.ts`. Next 15 middleware runs on
 * the Edge runtime by default, where `pg` and `drizzle-orm` cannot run, and it
 * runs before the handler, so it cannot know whether a request will actually
 * reach `submitSignedTransaction`. Rate limiting is therefore an explicit call
 * inside each handler (see `src/lib/rate-limit.ts`), and this file only removes
 * the duplication that made that hard to see.
 *
 * The 404 messages differ per route on purpose — 'Wallet not deployed' vs
 * 'Wallet not found' vs 'User not found or email not verified' — so each caller
 * passes its own rather than inheriting one.
 */

/** A user known to have a deployed wallet, so `walletContractId` is not optional. */
export type WalletUser = User & { walletContractId: string };

export type Guard<T> =
  | { ok: true; value: T }
  | { ok: false; response: NextResponse };

function unauthorized(): { ok: false; response: NextResponse } {
  return {
    ok: false,
    response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
  };
}

function notFound(message: string): { ok: false; response: NextResponse } {
  return {
    ok: false,
    response: NextResponse.json({ error: message }, { status: 404 }),
  };
}

/**
 * Verify the session cookie and return the caller's email.
 *
 * No database read: for routes that only need to know *someone* is logged in.
 */
export async function requireSessionEmail(): Promise<Guard<string>> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return unauthorized();
  }

  const session = await verifySessionToken(token);
  if (!session) {
    return unauthorized();
  }

  return { ok: true, value: session.email };
}

/**
 * Verify the session and load the caller, requiring a deployed wallet.
 *
 * @param notFoundMessage body for the 404 when the user or wallet is missing.
 */
export async function requireWalletUser(
  notFoundMessage = 'Wallet not deployed'
): Promise<Guard<WalletUser>> {
  const session = await requireSessionEmail();
  if (!session.ok) {
    return session;
  }

  const user = await getUserByEmail(session.value);
  if (!user || !user.walletContractId) {
    return notFound(notFoundMessage);
  }

  return { ok: true, value: { ...user, walletContractId: user.walletContractId } };
}

/**
 * Verify the session and load the caller, requiring a verified email but not a
 * wallet — the state `api/wallet/deploy` runs in, before a wallet exists.
 */
export async function requireVerifiedUser(
  notFoundMessage = 'User not found or email not verified'
): Promise<Guard<User>> {
  const session = await requireSessionEmail();
  if (!session.ok) {
    return session;
  }

  const user = await getUserByEmail(session.value);
  if (!user || !user.emailVerified) {
    return notFound(notFoundMessage);
  }

  return { ok: true, value: user };
}
