import { config } from 'dotenv';
import { beforeEach } from 'vitest';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db } from './src/lib/db';
import { resetDatabase } from './src/lib/db/test-setup';

config({ path: '.env.local' });

// Apply migrations once before all tests.
await migrate(db, { migrationsFolder: './drizzle' });

beforeEach(async () => {
  await resetDatabase();
});
