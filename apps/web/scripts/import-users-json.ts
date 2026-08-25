import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db, schema } from '../src/lib/db';

const dataDir = process.env.POCKETLET_DATA_DIR ?? join(process.cwd(), '.data');
const usersFile = join(dataDir, 'users.json');

interface OldCredential {
  id: string;
  publicKey: string;
  counter: number;
  transports?: string[];
}

interface OldUser {
  email: string;
  emailVerified: boolean;
  verificationCode?: string;
  pendingChallenge?: string;
  credential?: OldCredential;
  walletContractId?: string;
  stellarAddress?: string;
  primaryPasskeyKeyId?: string;
  recoveryPublicKey?: string;
  recoveryPhraseConfirmed?: boolean;
  hasBackupPasskey?: boolean;
  backupCredential?: OldCredential;
  pinHash?: string;
  pinResetCode?: string;
  recoveryInitiatedAt?: string;
  recoveryInitiationHistory?: string[];
  recoveryCode?: string;
  recoveryCodeExpiresAt?: string;
  recoveryVerifiedAt?: string;
  recoveryAttempts?: number;
  recoveryLockedUntil?: string;
  createdAt: string;
  updatedAt?: string;
  username?: string;
  phone?: string;
}

async function importUsers(): Promise<void> {
  let raw: string;
  try {
    raw = readFileSync(usersFile, 'utf-8');
  } catch {
    console.log('No users.json found at', usersFile);
    return;
  }

  const oldUsers = JSON.parse(raw) as Record<string, OldUser>;
  const users = Object.values(oldUsers);

  if (users.length === 0) {
    console.log('No users to import.');
    return;
  }

  console.log(`Importing ${users.length} users...`);

  for (const u of users) {
    await db
      .insert(schema.users)
      .values({
        email: u.email,
        emailVerified: u.emailVerified,
        verificationCode: u.verificationCode ?? null,
        pendingChallenge: u.pendingChallenge ?? null,
        credential: u.credential ?? null,
        walletContractId: u.walletContractId ?? null,
        stellarAddress: u.stellarAddress ?? null,
        primaryPasskeyKeyId: u.primaryPasskeyKeyId ?? null,
        recoveryPublicKey: u.recoveryPublicKey ?? null,
        recoveryPhraseConfirmed: u.recoveryPhraseConfirmed ?? false,
        hasBackupPasskey: u.hasBackupPasskey ?? false,
        backupCredential: u.backupCredential ?? null,
        pinHash: u.pinHash ?? null,
        pinResetCode: u.pinResetCode ?? null,
        recoveryInitiatedAt: u.recoveryInitiatedAt ? new Date(u.recoveryInitiatedAt) : null,
        recoveryInitiationHistory: u.recoveryInitiationHistory ?? null,
        recoveryCode: u.recoveryCode ?? null,
        recoveryCodeExpiresAt: u.recoveryCodeExpiresAt ? new Date(u.recoveryCodeExpiresAt) : null,
        recoveryVerifiedAt: u.recoveryVerifiedAt ? new Date(u.recoveryVerifiedAt) : null,
        recoveryAttempts: u.recoveryAttempts ?? null,
        recoveryLockedUntil: u.recoveryLockedUntil ? new Date(u.recoveryLockedUntil) : null,
        createdAt: new Date(u.createdAt),
        updatedAt: u.updatedAt ? new Date(u.updatedAt) : null,
        username: u.username ?? null,
        phone: u.phone ?? null,
      })
      .onConflictDoNothing({ target: schema.users.email });
  }

  console.log('Import complete.');
}

importUsers()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Import failed:', err);
    process.exit(1);
  });
