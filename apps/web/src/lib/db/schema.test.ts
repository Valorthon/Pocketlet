import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, schema } from './index';
import { resetDatabase } from './test-setup';
import { createUser } from '@/lib/auth/store';

const EMAIL = 'alice@example.com';

/**
 * Assert a Postgres foreign_key_violation (SQLSTATE 23503).
 *
 * Drizzle wraps driver errors, so the message is only "Failed query: ..." —
 * the SQLSTATE is on the cause. Matching the code rather than prose also
 * keeps the test from passing on some unrelated failure.
 */
async function expectForeignKeyViolation(run: () => Promise<unknown>) {
  let caught: unknown;
  try {
    await run();
  } catch (err) {
    caught = err;
  }
  expect(caught, 'expected the query to be rejected').toBeDefined();
  const cause = (caught as { cause?: { code?: string } }).cause;
  expect(cause?.code).toBe('23503');
}

async function seedUser(email = EMAIL) {
  await createUser(email, '000000');
  return email;
}

async function seedDevice(email: string, key = 'device-key-1') {
  const [row] = await db
    .insert(schema.userDevices)
    .values({
      email,
      devicePublicKey: key,
      expiresAt: new Date(Date.now() + 86_400_000),
    })
    .returning();
  return row;
}

async function seedClaimLink(senderEmail: string, claimHash = 'hash-1') {
  const [row] = await db
    .insert(schema.claimLinks)
    .values({
      senderEmail,
      tokenContractId: 'CTOKEN',
      amount: '1000000',
      claimHash,
      secretCiphertext: 'ciphertext',
      expiry: new Date(Date.now() + 86_400_000),
    })
    .returning();
  return row;
}

async function seedNotification(claimLinkId: string) {
  const [row] = await db
    .insert(schema.notifications)
    .values({ claimLinkId, channel: 'email', recipient: 'bob@example.com' })
    .returning();
  return row;
}

describe('referential integrity', () => {
  describe('user_devices.email -> users.email', () => {
    it('rejects a device for a user that does not exist', async () => {
      await expectForeignKeyViolation(() => seedDevice('ghost@example.com'));
    });

    it('cascades: deleting a user removes their devices', async () => {
      const email = await seedUser();
      await seedDevice(email);

      await db.delete(schema.users).where(eq(schema.users.email, email));

      const devices = await db.select().from(schema.userDevices);
      expect(devices).toHaveLength(0);
    });
  });

  describe('claim_links.sender_email -> users.email', () => {
    it('rejects a claim link from a sender that does not exist', async () => {
      await expectForeignKeyViolation(() =>
        seedClaimLink('ghost@example.com')
      );
    });

    // Restrict, not cascade: a claim link records an escrow deposit that may
    // still hold funds on-chain, so it must not vanish with the sender.
    it('restricts: a user with claim links cannot be deleted', async () => {
      const email = await seedUser();
      await seedClaimLink(email);

      await expectForeignKeyViolation(() =>
        db.delete(schema.users).where(eq(schema.users.email, email))
      );

      const users = await db.select().from(schema.users);
      expect(users).toHaveLength(1);
    });

    it('allows a claim link to an unregistered recipient', async () => {
      const email = await seedUser();
      const [link] = await db
        .insert(schema.claimLinks)
        .values({
          senderEmail: email,
          recipientEmail: 'nobody@example.com',
          tokenContractId: 'CTOKEN',
          amount: '1000000',
          claimHash: 'hash-unregistered',
          secretCiphertext: 'ciphertext',
          expiry: new Date(Date.now() + 86_400_000),
        })
        .returning();
      expect(link.recipientEmail).toBe('nobody@example.com');
    });
  });

  describe('notifications.claim_link_id -> claim_links.id', () => {
    it('rejects a notification for a claim link that does not exist', async () => {
      await expectForeignKeyViolation(() =>
        seedNotification('00000000-0000-0000-0000-000000000000')
      );
    });

    it('cascades: deleting a claim link removes its notifications', async () => {
      const email = await seedUser();
      const link = await seedClaimLink(email);
      await seedNotification(link.id);

      await db
        .delete(schema.claimLinks)
        .where(eq(schema.claimLinks.id, link.id));

      const notifications = await db.select().from(schema.notifications);
      expect(notifications).toHaveLength(0);
    });
  });
});

describe('resetDatabase', () => {
  it('clears every table, not just users and metrics', async () => {
    const email = await seedUser();
    await seedDevice(email);
    const link = await seedClaimLink(email);
    await seedNotification(link.id);
    await db.insert(schema.metrics).values({ key: 'test.key', value: 1 });

    await resetDatabase();

    expect(await db.select().from(schema.users)).toHaveLength(0);
    expect(await db.select().from(schema.userDevices)).toHaveLength(0);
    expect(await db.select().from(schema.claimLinks)).toHaveLength(0);
    expect(await db.select().from(schema.notifications)).toHaveLength(0);
    expect(await db.select().from(schema.metrics)).toHaveLength(0);
  });

  it('succeeds despite the restrict constraint on claim_links', async () => {
    const email = await seedUser();
    await seedClaimLink(email);
    await expect(resetDatabase()).resolves.not.toThrow();
  });
});
