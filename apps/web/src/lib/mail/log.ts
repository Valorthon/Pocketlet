import type { Mailer, MailMessage, MailResult } from './mailer';
import { describeError } from './mailer';

/**
 * The default mailer: writes the message to stdout and reports success.
 *
 * This is what testnet development and the test suite run on, so the claim
 * link flow works end to end with no API key and no network egress. It is
 * deliberately NOT good enough for the public network — see the
 * `RESEND_API_KEY` / `MAIL_FROM` check in `production-guardrails.mjs`.
 */
export const logMailer: Mailer = {
  name: 'log',

  async send(message: MailMessage): Promise<MailResult> {
    try {
      console.log(
        `[MAIL:log] to=${message.to} subject=${JSON.stringify(message.subject)}\n` +
          message.text
      );
      return { ok: true, provider: 'log' };
    } catch (err) {
      // console.log realistically cannot throw, but the never-throws contract
      // is the whole point of this interface — no implementation gets to be
      // the exception.
      return { ok: false, provider: 'log', error: describeError(err) };
    }
  },
};
