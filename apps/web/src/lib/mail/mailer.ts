/**
 * The mail seam.
 *
 * Claim-link notifications are the first thing in this app that has to leave
 * the process, so the interface matters more than the vendor: `Mailer` is what
 * the rest of the code depends on, and swapping Resend for SES or SendGrid is
 * one new file plus one line in `getMailer()`.
 *
 * The one hard rule is that `send` **never throws and never rejects**. A
 * failed notification must not be able to turn a completed on-chain escrow
 * deposit into an HTTP 500 (issue #120), so every implementation reports
 * failure as a value and callers branch on `ok` instead of catching.
 */

import { logMailer } from './log';
import { resendMailer } from './resend';

export interface MailMessage {
  /** A single recipient address. Claim-link mail is always one-to-one. */
  to: string;
  subject: string;
  /** Plain text. There is no HTML part: nothing here is clickable on purpose. */
  text: string;
}

export type MailResult =
  | { ok: true; provider: string; id?: string }
  | { ok: false; provider: string; error: string };

export interface Mailer {
  /** Provider name, recorded on the notification row. Never a secret. */
  readonly name: string;
  send(message: MailMessage): Promise<MailResult>;
}

/** Turn anything thrown into a short, log-safe string. */
export function describeError(err: unknown): string {
  if (err instanceof Error) {
    return err.message || err.name;
  }
  if (typeof err === 'string' && err) {
    return err;
  }
  return 'Unknown error';
}

/**
 * Pick the mailer from the environment.
 *
 * `RESEND_API_KEY` set means Resend, otherwise the log mailer. Deliberately
 * not a `MAIL_PROVIDER` enum: one variable that is either present or absent
 * cannot be set to a value that disagrees with the credentials beside it.
 */
export function getMailer(): Mailer {
  return process.env.RESEND_API_KEY?.trim() ? resendMailer : logMailer;
}
