import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { FlashClient } from "../packages/sdk/dist";
import { BN } from "@coral-xyz/anchor";

async function main() {
  console.log("🚀 Testing x402 Protocol End-to-End\n");

  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const agentKeypair = Keypair.generate();

  console.log("1️⃣ Requesting devnet SOL...");
  const airdrop = await connection.requestAirdrop(agentKeypair.publicKey, 2e9);
  await connection.confirmTransaction(airdrop);
  console.log("✅ Received 2 SOL\n");

  const client = new FlashClient(
    connection,
    {
      publicKey: agentKeypair.publicKey,
      signMessage: async (msg) => {
        const nacl = await import("tweetnacl");
        return nacl.sign.detached(msg, agentKeypair.secretKey);
      },
      signTransaction: async (tx) => {
        tx.sign([agentKeypair]);
        return tx;
      },
      signAllTransactions: async (txs) => {
        txs.forEach(tx => tx.sign(agentKeypair));
        return txs;
      },
    },
    { facilitatorUrl: "ws://localhost:8080" }
  );

  console.log("2️⃣ Creating vault...");
  const vaultTx = await client.createVault(
    new BN(1_000_000),
    new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU")
  );
  console.log("✅ Vault created:", vaultTx, "\n");

  console.log("3️⃣ Connecting to facilitator...");
  client.connect(
    new PublicKey("PROVIDER_PUBKEY_HERE"),
    "demo-jwt"
  );

  console.log("4️⃣ Making x402 API call...");
  const response = await client.x402Fetch("http://localhost:8080/api/stream");
  const data = await response.json();
  console.log("✅ API Response:", data);

  console.log("\n🎉 x402 Protocol working end-to-end!");
}

main().catch(console.error);