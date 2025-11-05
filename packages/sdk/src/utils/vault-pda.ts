import { PublicKey } from "@solana/web3.js";
import { FLOW_VAULT_PROGRAM_ID } from "../constants";

export function findVaultPda(agent: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), agent.toBuffer()],
    FLOW_VAULT_PROGRAM_ID
  );
}

export function findProviderPda(
  providerAuthority: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("provider"), providerAuthority.toBuffer()],
    FLOW_VAULT_PROGRAM_ID
  );
}