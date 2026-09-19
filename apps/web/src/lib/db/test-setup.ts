import { sql } from 'drizzle-orm';
import { db } from './index';

/**
 * Clear every table between tests.
 *
 * One TRUNCATE rather than a sequence of DELETEs: it is order-independent,
 * so it cannot trip the foreign keys (claim_links.sender_email restricts
 * deletes), and it is markedly faster. CASCADE is required because TRUNCATE
 * refuses to touch a table that is referenced by another, even when the
 * referencing table is in the same statement.
 *
 * Previously this cleared only `users` and `metrics`, so `user_devices`,
 * `claim_links` and `notifications` leaked between tests (issue #62).
 */
export async function resetDatabase(): Promise<void> {
  await db.execute(
    sql`TRUNCATE TABLE "notifications", "claim_links", "user_devices", "users", "metrics" RESTART IDENTITY CASCADE`
  );
}
