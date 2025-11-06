import * as dotenv from "dotenv";
import path from "path";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import chalk from "chalk";

dotenv.config();

const sdkPath = path.resolve(__dirname, "../packages/sdk/dist");
const { FlashClient, CASH_MINT_DEVNET } = require(sdkPath);

async function main() {
  console.log(chalk.bold.cyan("\n🌐 x402 Protocol Demo - Metered API Access\n"));

  const connection = new Connection(
    process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
    "confirmed"
  );

  const agentKeypair = Keypair.generate();

  console.log(chalk.blue("1️⃣  Agent initialized"));
  console.log(chalk.dim(`   Address: ${agentKeypair.publicKey.toBase58()}\n`));

  const autonomousSigner = {
    publicKey: agentKeypair.publicKey,
    signMessage: async (message: Uint8Array): Promise<Uint8Array> => {
      const nacl = await import("tweetnacl");
      return nacl.sign.detached(message, agentKeypair.secretKey);
    },
    signTransaction: async (tx: any): Promise<any> => {
      tx.sign(agentKeypair);
      return tx;
    },
    signAllTransactions: async (txs: any[]): Promise<any[]> => {
      txs.forEach((tx) => tx.sign(agentKeypair));
      return txs;
    },
  };

  const client = new FlashClient(connection, autonomousSigner, {
    facilitatorUrl: process.env.FACILITATOR_URL || "ws://localhost:8080",
  });

  console.log(chalk.blue("2️⃣  Requesting devnet SOL..."));
  const airdropSig = await connection.requestAirdrop(
    agentKeypair.publicKey,
    2e9
  );
  await connection.confirmTransaction(airdropSig);
  console.log(chalk.green("   ✅ Received 2 SOL\n"));

  console.log(chalk.blue("3️⃣  Creating vault with $CASH..."));
  const depositAmount = new BN(10_000_000); // 10 CASH
  const vaultTx = await client.createVault(depositAmount, CASH_MINT_DEVNET);
  console.log(chalk.green(`   ✅ Vault created: ${vaultTx}\n`));

  console.log(chalk.blue("4️⃣  Connecting to facilitator..."));
  const providerPubkey = new PublicKey(
    process.env.PROVIDER_PUBKEY || "11111111111111111111111111111111"
  );
  client.connect(providerPubkey, "demo-visa-jwt");
  console.log(chalk.green("   ✅ Connected\n"));

  console.log(chalk.blue("5️⃣  Making x402 API calls with micropayments...\n"));

  try {
    // First API call
    const response1 = await client.x402Fetch(
      "http://localhost:8080/api/stream"
    );
    const data1 = await response1.json();
    console.log(chalk.green("   ✅ API Call 1:"), data1);

    // Second API call
    const response2 = await client.x402Fetch("http://localhost:8080/api/data");
    const data2 = await response2.json();
    console.log(chalk.green("   ✅ API Call 2:"), data2);

    console.log(
      chalk.bold.green(
        "\n🎉 x402 Protocol Demo Complete! Micropayments working!\n"
      )
    );
  } catch (error: any) {
    if (error.message.includes("402")) {
      console.log(chalk.red("\n❌ Payment Required!"));
      console.log(chalk.yellow("   Need to top up vault or connect provider\n"));
    } else {
      throw error;
    }
  }
}

main().catch(console.error);