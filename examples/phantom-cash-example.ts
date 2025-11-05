import * as dotenv from "dotenv";
dotenv.config();

import { Connection, PublicKey, Keypair, Transaction } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import chalk from "chalk";
import * as path from "path";
import nacl from "tweetnacl";

const sdkPath = path.resolve(__dirname, "../packages/sdk/dist");
const { FlashClient, CASH_MINT_DEVNET } = require(sdkPath);

async function main() {
  console.log(chalk.bold.magenta("\n💸 x402-Flash × Phantom CASH Integration\n"));

  const connection = new Connection(
    process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
    "confirmed"
  );

  const agentKeypair = Keypair.generate();

  console.log(chalk.blue("1️⃣  Agent wallet initialized"));
  console.log(chalk.dim(`   Address: ${agentKeypair.publicKey.toBase58()}\n`));

  const autonomousSigner = {
    publicKey: agentKeypair.publicKey,
    signMessage: async (message: Buffer): Promise<Uint8Array> => {
      return nacl.sign.detached(message, agentKeypair.secretKey);
    },
    signTransaction: async (tx: Transaction): Promise<Transaction> => {
      tx.sign(agentKeypair);
      return tx;
    },
  };

  const client = new FlashClient(connection, autonomousSigner, {
    facilitatorUrl: process.env.FACILITATOR_URL || "ws://localhost:8080",
  });

  console.log(chalk.blue("2️⃣  Requesting devnet SOL..."));
  try {
    const airdropSig = await connection.requestAirdrop(agentKeypair.publicKey, 2e9);
    await connection.confirmTransaction(airdropSig);
    console.log(chalk.green("   ✅ Received 2 SOL\n"));
  } catch {
    console.log(chalk.yellow("   ⚠️  Airdrop rate limited\n"));
  }

  console.log(chalk.blue("3️⃣  Creating vault with Phantom CASH"));
  console.log(chalk.dim(`   Mint: ${CASH_MINT_DEVNET.toBase58()}`));

  const depositAmount = new BN(10_000_000);

  try {
    const txId = await client.createVault(depositAmount, CASH_MINT_DEVNET);

    console.log(chalk.green("\n✅ Vault Created with Phantom CASH!"));
    console.log(chalk.dim(`   Transaction: ${txId}`));
    console.log(chalk.dim(`   Deposit: 10.0 CASH\n`));

    console.log(chalk.bold.magenta("🎉 Phantom CASH Integration Complete!\n"));
    console.log(chalk.cyan("Why Phantom CASH?"));
    console.log(chalk.green("  ✓ Optimized for high-frequency micro-transactions"));
    console.log(chalk.green("  ✓ Low fees, perfect for streaming payments"));
    console.log(chalk.green("  ✓ Native Solana SPL token\n"));

  } catch (error: any) {
    console.error(chalk.red("\n❌ Error:"), error.message);
  }
}

main().catch(console.error);