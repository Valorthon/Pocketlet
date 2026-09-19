import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

// Loaded before ./vitest.setup.ts, which imports ./src/lib/db — that module
// constructs the pg Pool at import time, so DATABASE_URL has to be in
// process.env before it is evaluated. ES module imports run before any
// statement body, so calling dotenv inside vitest.setup.ts is always too late.
//
// dotenv does not override variables that are already set, so an exported
// DATABASE_URL (or CI's job-level env) still wins over .env.local.
config({ path: fileURLToPath(new URL('.env.local', import.meta.url)) });
