import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

/**
 * Constructs the canonical message for settlement signature verification.
 * The layout MUST match exactly what the on-chain program expects.
 *
 * Anchor Program (settle_batch.rs):
 * expected_message.extend_from_slice(b"X402_FLOW_SETTLE");
 * expected_message.extend_from_slice(&ctx.accounts.vault.key().to_bytes());
 * expected_message.extend_from_slice(&ctx.accounts.provider.key().to_bytes());
 * expected_message.extend_from_slice(&amount.to_le_bytes());
 * expected_message.extend_from_slice(&nonce.to_le_bytes());
 */
export function constructSettlementMessage(
  vaultPda: PublicKey,
  providerPda: PublicKey,
  amount: BN,
  nonce: BN
): Buffer {
  const prefix = Buffer.from("X402_FLOW_SETTLE");
  const vaultBuffer = vaultPda.toBuffer();
  const providerBuffer = providerPda.toBuffer();
  const amountBuffer = amount.toBuffer("le", 8);
  const nonceBuffer = nonce.toBuffer("le", 8);

  return Buffer.concat([
    prefix,
    vaultBuffer,
    providerBuffer,
    amountBuffer,
    nonceBuffer,
  ]);
}