import { eq } from 'drizzle-orm';
import { db, schema } from '@/lib/db';
import { ORIGIN } from '@/lib/auth/config';
import { getMailer, describeError } from '@/lib/mail/mailer';
import type { MailMessage, MailResult } from '@/lib/mail/mailer';

/**
 * Claim-link notifications.
 *
 * Two things here are load-bearing.
 *
 * 1. `deliverClaimLinkNotification` **never throws**. Its caller has already
 *    put an escrow deposit on chain by the time it runs, so a mail provider
 *    timing out must not make the request look like a failure and invite the
 *    user to deposit a second time (issue #120). Every failure is written to
 *    the notification row and returned; nothing propagates.
 * 2. The email tells the recipient to sign up with *this exact address*, and
 *    contains no link to click and no claim secret. There is no claim page:
 *    `api/wallet/claim-links/pending` matches pending links against the
 *    logged-in user's email or phone, so the address IS the claim credential.
 *    Anything link-shaped in this copy would be a lie.
 */

export type NotificationChannel = 'email' | 'sms';

/**
 * `queued` on insert; then exactly one of the rest.
 *
 * `unsupported` is the honest answer for SMS: `claim_links.recipient_phone` is
 * real and `pending` matches on it, so the record has to exist, but there is
 * no SMS provider and shipping one means Twilio plus 10DLC/A2P registration.
 * Recording it as `sent` would be a lie and as `failed` would imply a retry
 * would help.
 */
export type NotificationStatus = 'queued' | 'sent' | 'failed' | 'unsupported';

export interface ClaimLinkNotificationInput {
  claimLinkId: string;
  channel: NotificationChannel;
  /** Normalized email address or E.164 phone number. */
  recipient: string;
  /** Display amount, e.g. "25.5" — not base units. */
  amount: string;
  asset: string;
}

export interface NotificationOutcome {
  status: NotificationStatus;
  error?: string;
}

/** `notifications.error` is text, but there is no reason to store an essay. */
const MAX_ERROR_CHARS = 500;

function truncate(message: string): string {
  return message.length > MAX_ERROR_CHARS
    ? `${message.slice(0, MAX_ERROR_CHARS - 1)}…`
    : message;
}

/**
 * The claim-link email.
 *
 * Exported for the tests, which assert on the copy — specifically that it
 * never acquires a "click here" and never carries the claim secret.
 */
export function buildClaimLinkEmail(
  recipient: string,
  amount: string,
  asset: string
): MailMessage {
  return {
    to: recipient,
    subject: `You have ${amount} ${asset} waiting on Pocketlet`,
    text: [
      `Someone sent you ${amount} ${asset} on Pocketlet.`,
      '',
      'There is nothing to click in this email. The money is held for this',
      `exact email address — ${recipient} — so to pick it up:`,
      '',
      `  1. Go to ${ORIGIN}`,
      `  2. Sign up using this exact email address (${recipient}).`,
      '  3. The payment is already waiting on your home screen.',
      '',
      'Signing up with a different address will not find it.',
      '',
      'If you were not expecting this, you can ignore this email — the sender',
      'gets the money back automatically when the claim expires.',
      '',
      '— Pocketlet',
    ].join('\n'),
  };
}

/** Call the mailer, treating a thrown error as a failed result. */
async function sendGuarded(message: MailMessage): Promise<MailResult> {
  const mailer = getMailer();
  try {
    return await mailer.send(message);
  } catch (err) {
    // A `Mailer` that throws is a broken `Mailer`, but "the contract said so"
    // is not a guarantee. This is the second belt.
    return { ok: false, provider: mailer.name, error: describeError(err) };
  }
}

async function deliver(
  input: ClaimLinkNotificationInput
): Promise<NotificationOutcome> {
  const [row] = await db
    .insert(schema.notifications)
    .values({
      claimLinkId: input.claimLinkId,
      channel: input.channel,
      recipient: input.recipient,
      status: 'queued',
    })
    .returning();

  if (input.channel === 'sms') {
    await db
      .update(schema.notifications)
      .set({
        status: 'unsupported',
        error: 'No SMS provider is configured (see docs/production-readiness.md)',
      })
      .where(eq(schema.notifications.id, row.id));
    console.warn(
      `[NOTIFICATION] sms to=${input.recipient} not sent: no SMS provider configured`
    );
    return { status: 'unsupported' };
  }

  const attemptedAt = new Date();
  const result = await sendGuarded(
    buildClaimLinkEmail(input.recipient, input.amount, input.asset)
  );

  if (result.ok) {
    await db
      .update(schema.notifications)
      .set({
        status: 'sent',
        sentAt: attemptedAt,
        attempts: 1,
        lastAttemptAt: attemptedAt,
        error: null,
      })
      .where(eq(schema.notifications.id, row.id));
    return { status: 'sent' };
  }

  const error = truncate(`${result.provider}: ${result.error}`);
  await db
    .update(schema.notifications)
    .set({
      status: 'failed',
      attempts: 1,
      lastAttemptAt: attemptedAt,
      error,
    })
    .where(eq(schema.notifications.id, row.id));
  console.error(
    `[NOTIFICATION] email to=${input.recipient} failed: ${error}`
  );
  return { status: 'failed', error };
}

/**
 * Record and deliver the notification for a freshly created claim link.
 *
 * Never throws — not for a provider error, not for a database error, not for
 * anything unexpected. The caller has already moved funds on chain; see the
 * comment at the top of this file.
 */
export async function deliverClaimLinkNotification(
  input: ClaimLinkNotificationInput
): Promise<NotificationOutcome> {
  try {
    return await deliver(input);
  } catch (err) {
    const error = truncate(describeError(err));
    console.error(`[NOTIFICATION] could not be recorded or delivered: ${error}`);
    return { status: 'failed', error };
  }
}
