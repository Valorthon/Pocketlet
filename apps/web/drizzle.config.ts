import { defineConfig } from 'drizzle-kit';
import { config } from 'dotenv';

// drizzle-kit does not load .env.local the way `next dev` does, so without
// this DATABASE_URL would silently fall back to the localhost default. The
// path is relative because drizzle-kit is always run from apps/web (via
// `pnpm --filter web db:*`) and it rewrites import.meta when it bundles this
// file. dotenv does not override an already-exported DATABASE_URL.
config({ path: '.env.local' });

export default defineConfig({
  schema: './src/lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      'postgres://pocketlet:pocketlet@localhost:5432/pocketlet',
  },
});
