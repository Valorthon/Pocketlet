/**
 * Client-side helpers for escrow claim-link flows.
 */

export async function generateSecretAndHash(): Promise<{
  secret: string;
  claimHash: string;
}> {
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const hashBuffer = await crypto.subtle.digest('SHA-256', secret);
  return {
    secret: Buffer.from(secret).toString('hex'),
    claimHash: Buffer.from(hashBuffer).toString('hex'),
  };
}

export async function hashRecipientId(id: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(id));
  return Buffer.from(hashBuffer).toString('hex');
}
