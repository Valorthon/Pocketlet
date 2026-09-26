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
 * `MissingContext` (issue #148).
 *
 * Nothing else can catch a regression here. `kit.sign(tx)` and
 * `kit.sign(tx, signer)` both typecheck and both lint; the difference only
 * shows up against a real wallet, and no test in this repo deploys one or
 * evaluates `__check_auth`. There are also no component tests, so the calling
 * code in `send/page.tsx` is otherwise entirely unexercised.
 *
 * This is the same shape as the `signAdmin` source scan in
 * `passkey-kit.test.ts`, and for the same reason.
 */

const SEND_PAGE = join(__dirname, '../../app/send/page.tsx');

/**
 * The body of a top-level `const <name> = async (...) => {` in a component,
 * up to the next declaration at the same indentation.
 */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`  const ${name} = async (`);
  expect(start, `${name} not found — was it renamed?`).toBeGreaterThan(-1);
  const rest = source.slice(start + 1);
  const end = rest.indexOf('\n  const ');
  return end === -1 ? rest : rest.slice(0, end);
}

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

describe('the device signer stays scoped to the token contracts', () => {
  it('does not grant the device key rights over the escrow contract', () => {
    const deviceKey = readFileSync(join(__dirname, 'device-key.ts'), 'utf8');
    const submitRoute = readFileSync(
      join(__dirname, '../../app/api/wallet/device-key/submit/route.ts'),
      'utf8'
    );

    // Widening these to include the escrow contract is the other way to make
    // #148 "work", and it is the one we rejected: it hands a PIN-protected,
    // 90-day, Temporary signer authority over a third contract, and it would
    // silently do nothing for every user whose signer is already on chain.
    for (const [name, source] of [
      ['device-key.ts', deviceKey],
      ['device-key/submit/route.ts', submitRoute],
    ] as const) {
      expect(source, name).not.toContain('getEscrowContractId');
      expect(source, name).not.toContain('NEXT_PUBLIC_ESCROW_CONTRACT_ID');
    }
  });
});
