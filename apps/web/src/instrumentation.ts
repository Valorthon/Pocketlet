import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db } from '@/lib/db';

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }

  const migrationsFolder = path.join(process.cwd(), 'drizzle');

  try {
    await migrate(db, { migrationsFolder });
    console.log(`[migrate] applied migrations from ${migrationsFolder}`);
  } catch (err) {
    console.error('[migrate] failed to apply migrations', err);
    throw err;
  }
}
