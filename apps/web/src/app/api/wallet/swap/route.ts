import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { verifySessionToken } from '@/lib/auth/session';
import { SESSION_COOKIE_NAME } from '@/lib/auth/config';
import { getUserByEmail, verifyPinForUser } from '@/lib/auth/store';
import { keyStorage } from '@/lib/wallet/keys';
import { getUsdcContractId, getXlmContractId } from '@/lib/wallet/assets';
import { getDexContractId } from '@/lib/wallet/deploy';
import {
  invokeWalletContract,
  amountToBaseUnits,
  calculateMinBuyAmount,
  i128ScVal,
  addressScVal,
} from '@/lib/wallet/invoke';

export interface SwapRequest {
  direction: 'USDC_TO_XLM' | 'XLM_TO_USDC';
  amount: string;
  slippageBps?: number;
  pin: string;
}

function validateAmount(amount: string): string | null {
  if (!amount || Number.isNaN(Number(amount)) || Number(amount) <= 0) {
    return 'Amount must be a positive number';
  }
  const parts = amount.split('.');
  if (parts.length > 2) {
    return 'Invalid amount format';
  }
  if (parts[1] && parts[1].length > 7) {
    return 'Amount cannot have more than 7 decimal places';
  }
  return null;
}

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const session = await verifySessionToken(token);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = getUserByEmail(session.email);
  if (!user || !user.contractId || !keyStorage.has(user.email)) {
    return NextResponse.json({ error: 'Wallet not deployed' }, { status: 404 });
  }

  let body: SwapRequest;
  try {
    body = (await request.json()) as SwapRequest;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { direction, amount, pin } = body;
  const slippageBps =
    typeof body.slippageBps === 'number' && body.slippageBps >= 0 && body.slippageBps <= 10_000
      ? body.slippageBps
      : 100;

  if (direction !== 'USDC_TO_XLM' && direction !== 'XLM_TO_USDC') {
    return NextResponse.json(
      { error: 'Direction must be USDC_TO_XLM or XLM_TO_USDC' },
      { status: 400 }
    );
  }

  const amountError = validateAmount(amount);
  if (amountError) {
    return NextResponse.json({ error: amountError }, { status: 400 });
  }

  if (!pin || typeof pin !== 'string') {
    return NextResponse.json({ error: 'PIN is required' }, { status: 400 });
  }

  if (!verifyPinForUser(user.email, pin)) {
    return NextResponse.json({ error: 'Invalid PIN' }, { status: 401 });
  }

  try {
    const usdcContractId = getUsdcContractId();
    const xlmContractId = getXlmContractId();
    const sellToken = direction === 'USDC_TO_XLM' ? usdcContractId : xlmContractId;
    const buyToken = direction === 'USDC_TO_XLM' ? xlmContractId : usdcContractId;
    const sellAmount = amountToBaseUnits(amount);
    const minBuyAmount = calculateMinBuyAmount(sellAmount, slippageBps);
    const dexContractId = await getDexContractId();

    const result = await invokeWalletContract(user, 'swap', [
      addressScVal(sellToken),
      addressScVal(buyToken),
      i128ScVal(sellAmount),
      i128ScVal(minBuyAmount),
      addressScVal(dexContractId),
    ]);

    return NextResponse.json({ hash: result.hash });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Swap failed';
    console.error('Swap failed:', err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
