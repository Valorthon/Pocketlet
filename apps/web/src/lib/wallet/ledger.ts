/**
 * Ledger/time conversion for the escrow contract.
 *
 * The contract counts in ledger sequences; every screen the user sees counts
 * in wall-clock time. One conversion is therefore unavoidable, and it has to
 * be the SAME conversion on both sides: `api/wallet/claim-links/create`
 * requires the `expiryLedger` in the request body to equal the one baked into
 * the signed transaction exactly, so if the client and the server derive it
 * differently by even one ledger, every claim link fails with 400.
 *
 * That is why this module exists rather than the arithmetic being inlined in
 * both places, which is how it was written first.
 *
 * `LEDGER_SECONDS` is an approximation — Stellar targets ~5s and does not
 * guarantee it — and the error compounds across an expiry window. Issue #154
 * covers the consequence and the real fix (compare ledgers at read time and
 * treat any derived timestamp as display-only). Until then, do not change
 * this constant on one side only.
 */
export const LEDGER_SECONDS = 5;

/** Ledgers in a day. Exact: 86400 / 5 has no remainder. */
export const LEDGERS_PER_DAY = (24 * 60 * 60) / LEDGER_SECONDS;

/**
 * The ledger an escrow deposit prepared at `currentLedger` should expire at.
 * Callers must pass an integer `expiryDays`; the create route rejects
 * anything else before it gets here.
 */
export function expiryLedgerFor(currentLedger: number, expiryDays: number): number {
  return currentLedger + expiryDays * LEDGERS_PER_DAY;
}

/** Milliseconds between two ledger sequences, at the nominal close time. */
export function ledgerDeltaToMs(fromLedger: number, toLedger: number): number {
  return (toLedger - fromLedger) * LEDGER_SECONDS * 1000;
}
