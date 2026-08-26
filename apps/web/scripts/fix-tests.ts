import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const storeFunctions = [
  'createUser',
  'getUserByEmail',
  'getUserByUsername',
  'getUserByPhone',
  'setProfile',
  'setEmailVerified',
  'setPendingChallenge',
  'setCredential',
  'setWallet',
  'setRecoveryPublicKey',
  'markRecoveryPhraseConfirmed',
  'setBackupPasskey',
  'updateCredentialCounter',
  'updateBackupCredentialCounter',
  'setPin',
  'verifyPinForUser',
  'hasPin',
  'setPinResetCode',
  'verifyPinResetCode',
  'clearPinResetCode',
  'setRecoveryInitiated',
  'verifyRecoveryCode',
  'isRecoveryLocked',
  'clearRecoveryState',
];

function fixTestFile(content: string): string {
  // Remove temp dir setup boilerplate
  let result = content;

  // Remove mkdtempSync, rmSync, tmpdir, join imports if only used for temp dirs
  result = result.replace(
    /import\s*\{\s*mkdtempSync,\s*rmSync\s*\}\s*from\s*['"]node:fs['"];\n/g,
    ''
  );
  result = result.replace(
    /import\s*\{\s*tmpdir\s*\}\s*from\s*['"]node:os['"];\n/g,
    ''
  );
  result = result.replace(
    /import\s*\{\s*join\s*\}\s*from\s*['"]node:path['"];\n/g,
    ''
  );

  // Remove dataDir variable declaration
  result = result.replace(/let\s+dataDir:\s*string;\n/g, '');

  // Remove beforeEach temp dir setup
  result = result.replace(
    /beforeEach\(\(\)\s*=>\s*\{\s*dataDir\s*=\s*mkdtempSync\(join\(tmpdir\(\),\s*['"][^'"]+['"]\)\);\s*process\.env\.POCKETLET_DATA_DIR\s*=\s*dataDir;\s*\}\);\n/g,
    ''
  );

  // Remove afterEach temp dir cleanup
  result = result.replace(
    /afterEach\(\(\)\s*=>\s*\{\s*rmSync\(dataDir,\s*\{\s*recursive:\s*true,\s*force:\s*true\s*\}\);\s*delete\s*process\.env\.POCKETLET_DATA_DIR;\s*\}\);\n/g,
    ''
  );

  // Add await before store function calls (but not inside route handler imports or in already-awaited calls)
  for (const fn of storeFunctions) {
    // Match the function call that is not already awaited and not part of a string or comment
    // This is a simple regex and may need manual review
    const regex = new RegExp(
      `(?<!await\\s)(?<!\\.)\\b${fn}\\(`,
      'g'
    );
    result = result.replace(regex, `await ${fn}(`);
  }

  // Fix double awaits
  result = result.replace(/await\s+await\s+/g, 'await ');

  return result;
}

function findTestFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...findTestFiles(fullPath));
    } else if (entry.endsWith('.test.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

const srcDir = join(process.cwd(), 'src');
const testFiles = findTestFiles(srcDir);

for (const file of testFiles) {
  const content = readFileSync(file, 'utf-8');
  if (!content.includes('@/lib/auth/store')) {
    continue;
  }
  const fixed = fixTestFile(content);
  if (fixed !== content) {
    writeFileSync(file, fixed);
    console.log('Fixed:', file);
  }
}
