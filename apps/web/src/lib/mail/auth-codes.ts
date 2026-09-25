import { getMailer, describeError } from './mailer';
import type { MailMessage, MailResult } from './mailer';
import { VERIFICATION_CODE_EXPIRY_MS } from '@/lib/auth/verification-code';

/**
 * The one-time-code emails: signup verification, PIN reset, passkey recovery.
 *
 * These are the *only* place those codes leave the server since issue #18 —
 * the three routes used to return them in the JSON response, which made the
 * "verification" step verify nothing. Nothing else may print or return a code:
 * a dev-only reveal endpoint is the same leak wearing a hat.
 *
 * Like `buildClaimLinkEmail`, the copy is plain text with nothing to click.
 * A code email is the highest-value phishing template in the app, so teaching
 * users to click links in one would be actively harmful — and a code typed
 * back into the tab the user already has open needs no link.
 *
 * Delivery goes through the `Mailer` seam (`getMailer()`), so a testnet deploy
 * with no `RESEND_API_KEY` prints the message to stdout via `logMailer` and
 * the flows work end to end with no provider. `send` never throws; callers get
 * a `MailResult` and decide what to do with a failure.
 */

export type AuthCodePurpose = 'signup' | 'pin-reset' | 'recovery';

const EXPIRY_MINUTES = Math.round(VERIFICATION_CODE_EXPIRY_MS / 60_000);

interface Copy {
  subject: string;
  lead: string;
  next: string;
}

const COPY: Record<AuthCodePurpose, Copy> = {
  signup: {
    subject: 'Your Pocketlet verification code',
    lead: 'Use this code to verify your email address and finish creating your Pocketlet account.',
    next: 'Enter it in the tab where you started signing up.',
  },
  'pin-reset': {
    subject: 'Your Pocketlet PIN reset code',
    lead: 'Someone asked to reset the PIN on your Pocketlet account.',
    next: 'Enter it in the tab where you asked to reset your PIN.',
  },
  recovery: {
    subject: 'Your Pocketlet recovery code',
    lead: 'Someone started account recovery for your Pocketlet account.',
    next: 'Enter it in the tab where you started recovery.',
  },
};

/** The message for one code. Exported so the tests can assert on the copy. */
export function buildAuthCodeEmail(
  recipient: string,
  code: string,
  purpose: AuthCodePurpose
): MailMessage {
  const copy = COPY[purpose];
  return {
    to: recipient,
    subject: copy.subject,
    text: [
      copy.lead,
      '',
      `  ${code}`,
      '',
      `This code expires in ${EXPIRY_MINUTES} minutes. ${copy.next}`,
      '',
      'There is nothing to click in this email, and Pocketlet will never ask',
      'you for this code by email, chat or phone.',
      '',
      'If you did not ask for this, ignore this email — the code is useless on',
      'its own and expires by itself.',
      '',
      '— Pocketlet',
    ].join('\n'),
  };
}

/**
 * Email one code. Never throws.
 *
 * The `Mailer` contract already says `send` does not throw, but "the contract
 * said so" is not a guarantee — the same second belt `src/lib/notifications.ts`
 * wears. Every caller here has already written the code to the user row, so an
 * exception escaping would turn a committed write into an opaque 500; the
 * routes need a value they can branch on instead.
 */
export async function sendAuthCodeEmail(
  recipient: string,
  code: string,
  purpose: AuthCodePurpose
): Promise<MailResult> {
  const mailer = getMailer();
  try {
    return await mailer.send(buildAuthCodeEmail(recipient, code, purpose));
  } catch (err) {
    return { ok: false, provider: mailer.name, error: describeError(err) };
  }
}
