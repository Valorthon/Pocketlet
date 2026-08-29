import { db, schema } from '@/lib/db';

export type NotificationChannel = 'email' | 'sms';

/**
 * Queue a notification for an unregistered recipient.
 *
 * In V1 testnet, no transactional email/SMS provider is wired up (see issue
 * #18). The notification is persisted in the database and logged to stdout so
 * testnet demos can verify the flow without external API keys.
 */
export async function queueNotification(
  claimLinkId: string,
  channel: NotificationChannel,
  recipient: string,
  amount: string,
  asset: string
): Promise<void> {
  await db.insert(schema.notifications).values({
    claimLinkId,
    channel,
    recipient,
    status: 'sent',
    sentAt: new Date(),
  });

  console.log(
    `[NOTIFICATION] channel=${channel} to=${recipient} | ` +
      `"You have ${amount} ${asset} waiting on Pocketlet. Open the app to claim it."`
  );
}
