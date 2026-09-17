import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

/**
 * Keeps `.env.example` honest.
 *
 * `.env.example` is the single source of truth for configuration — there is no
 * separate env reference doc to fall out of sync. That only holds if the
 * template actually lists every variable the code reads, so this test asserts
 * both directions: nothing read without being documented, nothing documented
 * that is no longer read.
 *
 * If this fails, fix `.env.example` rather than the test.
 */

// Injected by Next.js at runtime; never set by a human, so not in the template.
const PROVIDED_BY_RUNTIME = new Set(['NEXT_RUNTIME', 'NODE_ENV']);

const WEB_ROOT = join(__dirname, '..', '..');

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, found);
    } else if (
      ['.ts', '.tsx', '.mjs'].includes(extname(entry)) &&
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.test.tsx')
    ) {
      found.push(full);
    }
  }
  return found;
}

function varsReadByCode(): Set<string> {
  const files = [
    ...sourceFiles(join(WEB_ROOT, 'src')),
    join(WEB_ROOT, 'next.config.mjs'),
    join(WEB_ROOT, 'drizzle.config.ts'),
  ];
  const names = new Set<string>();
  for (const file of files) {
    const matches = readFileSync(file, 'utf8').matchAll(
      /process\.env\.([A-Z][A-Z0-9_]*)/g
    );
    for (const m of matches) {
      if (!PROVIDED_BY_RUNTIME.has(m[1])) names.add(m[1]);
    }
  }
  return names;
}

function varsInExample(): Set<string> {
  const text = readFileSync(join(WEB_ROOT, '.env.example'), 'utf8');
  const names = new Set<string>();
  for (const line of text.split('\n')) {
    // Skip commented-out examples such as "# DATABASE_URL=postgres://..."
    const m = /^([A-Z][A-Z0-9_]*)=/.exec(line);
    if (m) names.add(m[1]);
  }
  return names;
}

describe('.env.example parity', () => {
  it('documents every environment variable the code reads', () => {
    const undocumented = [...varsReadByCode()]
      .filter((name) => !varsInExample().has(name))
      .sort();

    expect(
      undocumented,
      `Read by the code but missing from apps/web/.env.example: ${undocumented.join(', ')}`
    ).toEqual([]);
  });

  it('does not document variables the code no longer reads', () => {
    const read = varsReadByCode();
    const stale = [...varsInExample()].filter((name) => !read.has(name)).sort();

    expect(
      stale,
      `Listed in apps/web/.env.example but never read: ${stale.join(', ')}`
    ).toEqual([]);
  });
});
