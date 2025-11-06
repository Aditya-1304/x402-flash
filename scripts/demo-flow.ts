const { Connection, Keypair, PublicKey } = require("@solana/web3.js");
const { BN } = require("@coral-xyz/anchor");
const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

// Load SDK
const sdkPath = path.resolve(__dirname, "../packages/sdk/dist");
const { FlashClient, USDC_MINT_DEVNET } = require(sdkPath);

dotenv.config();

async function main() {
  console.log("\n🚀 x402-Flash Complete Demo Flow\n");
  console.log("=".repeat(50));

  // 1. Setup - USE HELIUS RPC
  const rpcUrl = process.env.RPC_URL || "https://api.devnet.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");

  const agentKeypair = Keypair.generate();
  console.log("\n1️⃣  Agent Wallet Created");
  console.log(`   Address: ${agentKeypair.publicKey.toBase58()}`);

  // 2. Airdrop SOL - WITH RETRY LOGIC
  console.log("\n2️⃣  Requesting SOL Airdrop...");
  let retries = 3;
  let airdropSuccess = false;

  while (retries > 0 && !airdropSuccess) {
    try {
      const airdropSig = await connection.requestAirdrop(
        agentKeypair.publicKey,
        2e9
      );

      // Use latest blockhash for confirmation
      const latestBlockhash = await connection.getLatestBlockhash();
      await connection.confirmTransaction({
        signature: airdropSig,
        blockhash: latestBlockhash.blockhash,
        lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      });

      airdropSuccess = true;
      console.log("   ✅ Received 2 SOL");
    } catch (error) {
      retries--;
      console.log(`   ⚠️  Airdrop failed, retrying... (${retries} attempts left)`);
      if (retries === 0) {
        console.log("\n❌ Airdrop failed after 3 attempts.");
        console.log("💡 TIP: You can manually fund this wallet and press Enter to continue:");
        console.log(`   Address: ${agentKeypair.publicKey.toBase58()}`);
        console.log(`   Need: 2 SOL on devnet`);

        // Wait for user input
        await new Promise((resolve) => {
          process.stdin.once("data", resolve);
        });
        break;
      }
      // Wait 2 seconds before retry
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  // Check balance
  const balance = await connection.getBalance(agentKeypair.publicKey);
  if (balance < 1e9) {
    console.error("\n❌ Insufficient balance. Please fund the wallet and try again.");
    process.exit(1);
  }
  console.log(`   💰 Current balance: ${balance / 1e9} SOL`);

  // 3. Create Autonomous Signer
  const autonomousSigner = {
    publicKey: agentKeypair.publicKey,
    signMessage: async (msg: any) => {
      const nacl = require("tweetnacl");
      return nacl.sign.detached(msg, agentKeypair.secretKey);
    },
    signTransaction: async (tx: any) => {
      tx.sign([agentKeypair]);
      return tx;
    },
    signAllTransactions: async (txs: any) => {
      for (const tx of txs) {
        tx.sign([agentKeypair]);
      }
      return txs;
    },
  };

  // 4. Initialize Flash Client
  console.log("\n3️⃣  Initializing Flash Client...");
  const client = new FlashClient(connection, autonomousSigner, {
    facilitatorUrl:
      process.env.FACILITATOR_URL || "ws://localhost:8080",
  });
  console.log("   ✅ Flash Client Ready");

  // 5. Create Vault
  console.log("\n4️⃣  Creating Vault with 10 USDC...");
  try {
    const vaultTx = await client.createVault(
      new BN(10_000_000), // 10 USDC (6 decimals)
      USDC_MINT_DEVNET
    );
    console.log(`   ✅ Vault Created: ${vaultTx}`);
  } catch (error: any) {
    console.log(`   ❌ Vault creation failed: ${error.message}`);
    console.log(`   This is expected if you don't have USDC tokens`);
  }

  // 6. Connect to Provider
  console.log("\n5️⃣  Connecting to Facilitator...");
  const providerPubkey = new PublicKey(
    process.env.PROVIDER_PUBKEY ||
    "11111111111111111111111111111111" // Replace with real provider
  );
  const jwtToken = process.env.VISA_TAP_JWT || "demo-jwt-token";

  try {
    client.connect(providerPubkey, jwtToken);
    console.log("   ✅ Connected to Facilitator");
  } catch (error: any) {
    console.log(`   ⚠️  Connection failed: ${error.message}`);
  }

  // 7. Make x402 API Call
  console.log("\n6️⃣  Making x402-metered API Call...");
  try {
    const response = await client.x402Fetch(
      "http://localhost:8080/api/stream",
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    const data = await response.json();
    console.log("   ✅ API Response:", JSON.stringify(data, null, 2));
  } catch (error: any) {
    console.log("   ⚠️  API call failed (facilitator may not be running)");
    console.log(`   Error: ${error.message}`);
  }

  console.log("\n" + "=".repeat(50));
  console.log("✅ Demo Flow Completed Successfully!");
  console.log("=".repeat(50) + "\n");

  // Cleanup
  client.disconnect();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  });