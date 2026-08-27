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

export type Credential = {
  id: string;
  publicKey: string;
  counter: number;
  transports?: string[];
};

export const users = pgTable('users', {
  email: text('email').primaryKey(),
  emailVerified: boolean('email_verified').notNull().default(false),
  verificationCode: text('verification_code'),
  pendingChallenge: text('pending_challenge'),
  credential: jsonb('credential').$type<Credential>(),
  walletContractId: text('wallet_contract_id'),
  stellarAddress: text('stellar_address'),
  primaryPasskeyKeyId: text('primary_passkey_key_id'),
  recoveryPublicKey: text('recovery_public_key'),
  recoveryPhraseConfirmed: boolean('recovery_phrase_confirmed').default(false),
  hasBackupPasskey: boolean('has_backup_passkey').default(false),
  backupCredential: jsonb('backup_credential').$type<Credential>(),
  pinHash: text('pin_hash'),
  pinResetCode: text('pin_reset_code'),
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
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
  username: text('username').unique(),
  phone: text('phone').unique(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export const userDevices = pgTable('user_devices', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  devicePublicKey: text('device_public_key').notNull().unique(),
  deviceName: text('device_name'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
});

export type UserDevice = typeof userDevices.$inferSelect;
export type NewUserDevice = typeof userDevices.$inferInsert;

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
