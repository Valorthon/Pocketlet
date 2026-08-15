import { Address, nativeToScVal, xdr } from '@stellar/stellar-sdk';

/**
 * Convert a decimal amount string to Stellar base units (7 decimals).
 */
export function amountToBaseUnits(amount: string, decimals = 7): bigint {
  const [integerPart, fractionPart = ''] = amount.split('.');
  const integer = integerPart || '0';
  const fraction = (fractionPart + '0'.repeat(decimals)).slice(0, decimals);
  const scale = BigInt(10 ** decimals);
  return BigInt(integer) * scale + BigInt(fraction);
}

/**
 * Convert an i128 ScVal to a bigint.
 */
export function i128ToBigInt(value: xdr.ScVal): bigint {
  const i128 = value.i128();
  const hi = i128.hi().toBigInt();
  const lo = i128.lo().toBigInt();
  return (hi << 64n) + lo;
}

/**
 * Build an i128 ScVal from a bigint.
 */
export function i128ScVal(value: bigint): xdr.ScVal {
  return nativeToScVal(value, { type: 'i128' });
}

/**
 * Build an Address ScVal from a contract/account string.
 */
export function addressScVal(value: string): xdr.ScVal {
  return new Address(value).toScVal();
}

/**
 * Compute the minimum acceptable buy amount given a sell amount and slippage
 * tolerance in basis points (e.g. 100 = 1%).
 */
export function calculateMinBuyAmount(sellAmount: bigint, slippageBps: number): bigint {
  return (sellAmount * BigInt(10_000 - slippageBps)) / 10_000n;
}
