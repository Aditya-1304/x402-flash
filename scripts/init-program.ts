import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { Program, AnchorProvider, Wallet, BN } from "@coral-xyz/anchor";
import { FlowVault } from "../packages/facilitator/src/idl/flow_vault";
import idl from "../anchor/target/idl/flow_vault.json";
import * as fs from "fs";

async function main() {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  const keypairData = JSON.parse(
    fs.readFileSync(process.env.HOME + "/.config/solana/id.json", "utf-8")
  );
  const adminKeypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));

  const wallet = new Wallet(adminKeypair);
  const provider = new AnchorProvider(connection, wallet, {});
  const program = new Program<FlowVault>(idl as any, provider);

  console.log("Initializing global config...");

  const tx = await program.methods
    .initializeConfig(
      new BN(100000), // settle_threshold: 0.0001 USDC
      50      // fee_bps: 0.5%
    )
    .accounts({
      admin: adminKeypair.publicKey,
    } as any)
    .rpc();

  console.log("✅ Config initialized:", tx);
}

main().catch(console.error);