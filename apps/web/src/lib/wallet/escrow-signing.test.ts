import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Escrow operations must be signed by the passkey, not the device key.
 *
 * The escrow contract's `deposit` calls `sender.require_auth()` and `refund`
 * calls `deposit.sender.require_auth()`, so each produces an auth context for
 * the **escrow** contract. The device signer is registered with a
 * `SignerLimits` map naming only the two SAC token contracts, and passkey-kit's
 * `__check_auth` requires every requested context to be covered by some
 * permitted signer — so a device-signed deposit is rejected on chain with
 * `MissingContext` (error 110, issue #148).
 *
 * Nothing else can catch a regression here. `kit.sign(tx)` and
 * `kit.sign(tx, signer)` both typecheck and both lint; the difference only
 * shows up against a real wallet, and no test in this repo deploys one or
 * evaluates `__check_auth`. There are also no component tests, so the calling
 * code in `send/page.tsx` is otherwise entirely unexercised.
 *
 * These are therefore source scans, which have an obvious weakness: they match
 * exact strings. Renaming a local, reformatting, or wrapping a handler in
 * `useCallback` will fail them. That is the intended direction of failure —
 * they go red and someone re-reads this file, rather than green on a wallet
 * that no longer works. If one fails after a harmless refactor, update the
 * expected string; do not delete the assertion.
 */

const WALLET_DIR = __dirname;
const SEND_PAGE = join(WALLET_DIR, '../../app/send/page.tsx');
const SUBMIT_ROUTE = join(
  WALLET_DIR,
  '../../app/api/wallet/device-key/submit/route.ts'
);

/**
 * The body of a top-level `const <name> = async (` in a component, up to the
 * next declaration at the same two-space indentation.
 */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`  const ${name} = async (`);
  expect(
    start,
    `${name} not found in send/page.tsx — renamed, reformatted, or wrapped?`
  ).toBeGreaterThan(-1);
  const rest = source.slice(start + 1);
  const end = rest.indexOf('\n  const ');
  expect(
    end,
    `could not find the end of ${name} — is it still at two-space indent?`
  ).toBeGreaterThan(-1);
  return rest.slice(0, end);
}

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

describe('escrow operations are signed with the passkey', () => {
  const source = readFileSync(SEND_PAGE, 'utf8');

  it('creates a claim link without the device signer', () => {
    const body = functionBody(source, 'executeClaimLink');

    // The deposit reaches the escrow contract, which the device signer's
    // limits do not cover. Reintroducing getDeviceSigner here makes every
    // claim-link creation fail on chain while passing CI.
    expect(body).not.toContain('getDeviceSigner');
    expect(body).not.toContain('hasUsableDeviceKey');
    expect(body).toContain('await kit.sign(tx);');
  });

  it('still signs a plain SAC transfer with the device key', () => {
    const body = functionBody(source, 'executeTransfer');

    // The counterpart: a token transfer's only auth context is the SAC
    // `transfer`, which the device signer IS permitted to authorize. Moving
    // this to the passkey would prompt for a biometric on every routine send
    // and throw away the reason the device key exists.
    expect(body).toContain('getDeviceSigner(pin)');
    expect(body).toContain('await kit.sign(tx, signer);');
  });
});

describe('the signed transaction is the one described to the server', () => {
  const source = readFileSync(SEND_PAGE, 'utf8');

  it('does not re-read the ledger after signing', () => {
    const body = functionBody(source, 'executeClaimLink');

    // `expiryLedger` is baked into the signed XDR at prepare time, and
    // `create/route.ts` requires the value in the request body to equal it
    // exactly. Calling getCurrentLedger() again here reads a NEWER ledger --
    // Stellar closes one every ~5s -- so the two disagreed unless the user
    // confirmed within the same ledger, and creating a claim link answered
    // 400 "Expiry ledger does not match request" (issue #149). Every ledger
    // read belongs in the prepare effect; this function only echoes back what
    // was signed.
    expect(body).not.toContain('getCurrentLedger');
    expect(body).toContain('expiryLedgerRef.current');
  });

  it('reads every prepared value before the first await', () => {
    const body = functionBody(source, 'executeClaimLink');

    // The prepare effect nulls all of these when `step` leaves
    // 'claim-link-review'. Anything still read from a ref after the signing
    // ceremony has awaited comes back null -- which is how `claimHash: null`
    // reached the create route and earned a 400 "Missing required fields".
    const firstAwait = body.indexOf('await ');
    expect(firstAwait).toBeGreaterThan(-1);
    const beforeAwait = body.slice(0, firstAwait);

    for (const ref of [
      'preparedKitRef.current',
      'preparedTxRef.current',
      'claimSecretRef.current',
      'claimHashRef.current',
      'expiryLedgerRef.current',
    ]) {
      expect(beforeAwait, `${ref} must be read before the first await`).toContain(ref);
    }
    // ...and none is READ after it. Matching the bare substring would also
    // ban a write such as `preparedTxRef.current = null`, which is a
    // perfectly good double-submit guard once the value is in a local.
    const afterAwait = body.slice(firstAwait);
    expect(afterAwait).not.toMatch(/=\s*\w+Ref\.current/);
    expect(afterAwait).not.toMatch(/\w+Ref\.current\s*[,)]/);
  });
});

describe('the device signer stays scoped to the token contracts', () => {
  // Widening these is the other way to make #148 "work", and the one we
  // rejected: it hands a PIN-protected, 90-day, Temporary signer authority
  // over a third contract, and it silently does nothing for every user whose
  // signer is already on chain, because their limits are fixed until an
  // updateEd25519. Asserting the exact contents catches a third entry however
  // it is spelled — a getter, a hardcoded C-address, or a new helper.

  it('asks for exactly the two token contracts when registering', () => {
    const source = readFileSync(join(WALLET_DIR, 'device-key.ts'), 'utf8');
    const block = /const limits = new Map\(\[([\s\S]*?)\]\);/.exec(source);
    expect(block, 'the device-key limits map moved or was renamed').not.toBeNull();

    expect(collapse(block![1])).toBe(
      '[getUsdcContractId(), undefined], [getXlmContractId(), undefined],'
    );
  });

  it('accepts exactly the two token contracts server-side', () => {
    // This is the assertion that actually holds the line: the route rejects
    // any add_signer naming a contract outside this set, so it constrains
    // every client, not just ours.
    const source = readFileSync(SUBMIT_ROUTE, 'utf8');
    const block = /const allowed = new Set\(\[([\s\S]*?)\]\);/.exec(source);
    expect(block, 'the device-key allowlist moved or was renamed').not.toBeNull();

    expect(collapse(block![1])).toBe(
      'getUsdcContractId(), getXlmContractId()'
    );
  });
});
