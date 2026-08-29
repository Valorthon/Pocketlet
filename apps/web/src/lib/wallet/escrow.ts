import { Address, xdr, nativeToScVal } from '@stellar/stellar-sdk';
import { AssembledTransaction } from '@stellar/stellar-sdk/contract';
import { NETWORK_PASSPHRASE, RPC_URL } from './network';

function getEscrowContractId(): string {
  const id = process.env.NEXT_PUBLIC_ESCROW_CONTRACT_ID;
  if (!id) {
    throw new Error('NEXT_PUBLIC_ESCROW_CONTRACT_ID is not configured');
  }
  return id;
}

function addressScVal(addr: string): xdr.ScVal {
  return new Address(addr).toScVal();
}

function bytes32ScVal(hex: string): xdr.ScVal {
  return nativeToScVal(Buffer.from(hex, 'hex'), { type: 'bytes' });
}

interface EscrowTxOptions {
  publicKey: string;
}

export async function prepareEscrowDepositTx(
  options: EscrowTxOptions,
  tokenContractId: string,
  amount: bigint,
  claimHashHex: string,
  recipientIdHashHex: string,
  expiryLedger: number
): Promise<AssembledTransaction<null>> {
  return AssembledTransaction.build({
    method: 'deposit',
    args: [
      addressScVal(options.publicKey),
      addressScVal(tokenContractId),
      nativeToScVal(amount, { type: 'i128' }),
      bytes32ScVal(claimHashHex),
      bytes32ScVal(recipientIdHashHex),
      nativeToScVal(BigInt(expiryLedger), { type: 'u64' }),
    ],
    contractId: getEscrowContractId(),
    networkPassphrase: NETWORK_PASSPHRASE,
    rpcUrl: RPC_URL,
    publicKey: options.publicKey,
    parseResultXdr: () => null,
  });
}

export async function prepareEscrowClaimTx(
  options: EscrowTxOptions,
  secretHex: string,
  recipientWallet: string
): Promise<AssembledTransaction<null>> {
  return AssembledTransaction.build({
    method: 'claim',
    args: [
      bytes32ScVal(secretHex),
      addressScVal(recipientWallet),
    ],
    contractId: getEscrowContractId(),
    networkPassphrase: NETWORK_PASSPHRASE,
    rpcUrl: RPC_URL,
    publicKey: options.publicKey,
    parseResultXdr: () => null,
  });
}

export async function prepareEscrowRefundTx(
  options: EscrowTxOptions,
  claimHashHex: string
): Promise<AssembledTransaction<null>> {
  return AssembledTransaction.build({
    method: 'refund',
    args: [bytes32ScVal(claimHashHex)],
    contractId: getEscrowContractId(),
    networkPassphrase: NETWORK_PASSPHRASE,
    rpcUrl: RPC_URL,
    publicKey: options.publicKey,
    parseResultXdr: () => null,
  });
}
