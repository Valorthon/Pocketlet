import {
  pgTable,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  bigint,
  primaryKey,
  uuid,
} from 'drizzle-orm/pg-core';

// Referential integrity: userDevices.email and claimLinks.senderEmail
// reference users.email; notifications.claimLinkId references claimLinks.id.
// Delete behaviour differs on purpose — a device signer or a notification is
// meaningless without its parent and cascades, but a claim link records an
// escrow deposit that may still hold funds on-chain, so it restricts and a
// user with outstanding links cannot be deleted out from under it.
// claimLinks.recipientEmail is deliberately NOT a reference: the whole point
// of a claim link is that the recipient has no account yet (issue #62).

export type Credential = {
  id: string;
  publicKey: string;
  counter: number;
  transports?: string[];
};

// Accounts. One row per user, holding identity, wallet, PIN and recovery
// state together. The comments below mark concerns, but note the column order
// interleaves them — recovery flow state resumes after the PIN columns.
export const users = pgTable('users', {
  // Identity
  email: text('email').primaryKey(),
  emailVerified: boolean('email_verified').notNull().default(false),
  verificationCode: text('verification_code'),
  // pendingChallenge serves the Ed25519 device/seedphrase flows and WebAuthn
  // login. Passkey *registration* uses its own pair of columns so that
  // enrolling a backup passkey during an active login cannot clobber the
  // login's challenge, and so registration challenges can expire (issue #56).
  pendingChallenge: text('pending_challenge'),
  passkeyChallenge: text('passkey_challenge'),
  passkeyChallengeExpiresAt: timestamp('passkey_challenge_expires_at', {
    withTimezone: true,
  }),
  // Primary passkey (WebAuthn credential)
  credential: jsonb('credential').$type<Credential>(),
  // Wallet. stellarAddress is always set equal to walletContractId
  // (api/wallet/deploy/route.ts) — a leftover from the classic-account era.
  // Still load-bearing: resolveRecipient reads stellarAddress while transfers
  // use walletContractId, so neither can be dropped alone.
  walletContractId: text('wallet_contract_id'),
  stellarAddress: text('stellar_address'),
  primaryPasskeyKeyId: text('primary_passkey_key_id'),
  // Recovery phrase (BIP39; only the derived public key is stored)
  recoveryPublicKey: text('recovery_public_key'),
  recoveryPhraseConfirmed: boolean('recovery_phrase_confirmed').default(false),
  // Backup passkey
  hasBackupPasskey: boolean('has_backup_passkey').default(false),
  backupCredential: jsonb('backup_credential').$type<Credential>(),
  // PIN (bcrypt hash)
  pinHash: text('pin_hash'),
  pinResetCode: text('pin_reset_code'),
  // Recovery flow state. After 3 failed attempts recoveryLockedUntil is set
  // an hour ahead; clear it manually to unlock in testing.
  recoveryInitiatedAt: timestamp('recovery_initiated_at', {
    withTimezone: true,
  }),
  recoveryInitiationHistory: jsonb('recovery_initiation_history').$type<
    string[]
  >(),
  recoveryCode: text('recovery_code'),
  recoveryCodeExpiresAt: timestamp('recovery_code_expires_at', {
    withTimezone: true,
  }),
  recoveryVerifiedAt: timestamp('recovery_verified_at', {
    withTimezone: true,
  }),
  recoveryAttempts: integer('recovery_attempts'),
  recoveryLockedUntil: timestamp('recovery_locked_until', {
    withTimezone: true,
  }),
  // Timestamps
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
  // Public handles, used for recipient resolution
  username: text('username').unique(),
  phone: text('phone').unique(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

// Short-lived Ed25519 device signers, so routine sends need only a PIN rather
// than a biometric prompt. Registration is idempotent per devicePublicKey, and
// expiresAt is enforced at login.
export const userDevices = pgTable('user_devices', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email')
    .notNull()
    .references(() => users.email, { onDelete: 'cascade' }),
  devicePublicKey: text('device_public_key').notNull().unique(),
  deviceName: text('device_name'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
});

export type UserDevice = typeof userDevices.$inferSelect;
export type NewUserDevice = typeof userDevices.$inferInsert;

export const claimLinks = pgTable('claim_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  senderEmail: text('sender_email')
    .notNull()
    .references(() => users.email, { onDelete: 'restrict' }),
  recipientPhone: text('recipient_phone'),
  recipientEmail: text('recipient_email'),
  tokenContractId: text('token_contract_id').notNull(),
  // text, not numeric: amounts are i128 base units on the contract side and
  // must survive the round trip without float drift.
  amount: text('amount').notNull(),
  claimHash: text('claim_hash').notNull().unique(),
  secretCiphertext: text('secret_ciphertext').notNull(),
  // NOTE: a timestamp here, but the escrow contract takes expiry as a LEDGER
  // SEQUENCE. Converted in api/wallet/claim-links/create/route.ts.
  expiry: timestamp('expiry', { withTimezone: true }).notNull(),
  status: text('status').notNull().default('pending'),
  txHash: text('tx_hash'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
});

export type ClaimLink = typeof claimLinks.$inferSelect;
export type NewClaimLink = typeof claimLinks.$inferInsert;

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  claimLinkId: uuid('claim_link_id')
    .notNull()
    .references(() => claimLinks.id, { onDelete: 'cascade' }),
  channel: text('channel').notNull(),
  recipient: text('recipient').notNull(),
  status: text('status').notNull().default('queued'),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

export const metrics = pgTable(
  'metrics',
  {
    key: text('key').notNull(),
    period: text('period').notNull().default('total'),
    value: bigint('value', { mode: 'number' }).notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.key, table.period] })]
);

export type Metric = typeof metrics.$inferSelect;
export type NewMetric = typeof metrics.$inferInsert;
