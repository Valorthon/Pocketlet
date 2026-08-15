import { NextResponse } from 'next/server';

/**
 * Swaps are deferred. The previous implementation relied on the deleted
 * `mock_dex` contract and the server-side owner key model. Re-enable this
 * endpoint once a real Stellar DEX/AMM integration is wired through the
 * passkey-kit + fee-payer flow.
 */
export async function POST() {
  return NextResponse.json(
    {
      error:
        'Swaps are temporarily disabled while the DEX integration is rebuilt for the passkey-kit wallet.',
    },
    { status: 410 }
  );
}
