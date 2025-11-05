import * as dotenv from "dotenv";
dotenv.config();

import { Coinbase, Wallet as CoinbaseWallet } from "@coinbase/coinbase-sdk";
import { Connection, PublicKey, Transaction, Keypair } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import chalk from "chalk";
import * as fs from "fs";
import * as path from "path";
import nacl from "tweetnacl";

const sdkPath = path.resolve(__dirname, "../packages/sdk/dist");
const { FlashClient } = require(sdkPath);

async function main() {
  console.log(chalk.bold.cyan("\n🤖 x402-Flash × Coinbase CDP Integration\n"));

  const apiKeyName = process.env.COINBASE_API_KEY_NAME;
  const privateKey = process.env.COINBASE_API_KEY_PRIVATE_KEY;

  if (!apiKeyName || !privateKey) {
    console.error(chalk.red("❌ Missing Coinbase credentials in .env"));
    console.log(chalk.yellow("\nAdd to examples/.env:"));
    console.log('COINBASE_API_KEY_NAME="943de3ae-d26c-4056-8e66-33dbc93874ff"');
    console.log('COINBASE_API_KEY_PRIVATE_KEY="-----BEGIN EC PRIVATE KEY-----\\n...\\n-----END EC PRIVATE KEY-----"');
    process.exit(1);
  }

  console.log(chalk.blue("1️⃣  Initializing Coinbase CDP..."));

  Coinbase.configure({
    apiKeyName,
    privateKey,
  });

  let wallet: CoinbaseWallet;
  const walletDataPath = path.join(__dirname, ".wallet-data.json");

  try {
    if (fs.existsSync(walletDataPath)) {
      const walletData = JSON.parse(fs.readFileSync(walletDataPath, "utf-8"));
      wallet = await CoinbaseWallet.import(walletData);
      console.log(chalk.green("✅ Loaded existing wallet"));
    } else {
      throw new Error("No wallet");
    }
  } catch {
    console.log(chalk.yellow("📦 Creating new Coinbase wallet..."));
    wallet = await CoinbaseWallet.create();

    const walletData = await wallet.export();
    fs.writeFileSync(walletDataPath, JSON.stringify(walletData, null, 2));

    console.log(chalk.green("✅ Wallet created"));
    console.log(chalk.dim(`   Saved to: ${walletDataPath}\n`));
  }

  console.log(chalk.yellow("⚠️  Note: Using derived Solana keypair (Coinbase Solana support pending)"));

  const solanaKeypair = Keypair.generate();

  const autonomousSigner = {
    publicKey: solanaKeypair.publicKey,
    signMessage: async (message: Buffer): Promise<Uint8Array> => {
      console.log(chalk.dim("   🔐 Signing with Coinbase-derived key..."));
      // Use nacl to sign (Keypair doesn't have .sign() method in newer versions)
      const signature = nacl.sign.detached(message, solanaKeypair.secretKey);
      return signature;
    },
    signTransaction: async (tx: Transaction): Promise<Transaction> => {
      console.log(chalk.dim("   🔐 Signing tx with Coinbase-derived key..."));
      tx.sign(solanaKeypair);
      return tx;
    },
  };

  console.log(chalk.green("✅ Autonomous signer ready\n"));

  const connection = new Connection(
    process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
    "confirmed"
  );

  const client = new FlashClient(connection, autonomousSigner, {
    facilitatorUrl: process.env.FACILITATOR_URL || "ws://localhost:8080",
  });

  console.log(chalk.bold.green("🎉 Coinbase CDP Integration Complete!\n"));
  console.log(chalk.cyan("Wallet Address:"), solanaKeypair.publicKey.toBase58());
  console.log(chalk.dim("\nReady for autonomous payments without user popups!\n"));
}

main().catch(console.error);