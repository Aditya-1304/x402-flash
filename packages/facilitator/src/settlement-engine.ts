import {
  PublicKey,
  Keypair,
  Transaction,
  ComputeBudgetProgram,
  Ed25519Program,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";
import { Program, AnchorProvider, Wallet, BN } from "@coral-xyz/anchor";
import { FlowVault } from "./idl/flow_vault";
import idl from "./idl/flow_vault.json"; // Make sure this path is correct
import { connection } from "./utils/rpc-client";
import { logger } from "./utils/logger";
import { PriorityFeeOracle } from "./priority-fee-oracle";
import { constructSettlementMessage } from "./utils/signature-verify"; // Correct import
import { CircuitBreaker } from "./circuit-breaker"; // Import CircuitBreaker
import config from "config";
import fs from "fs";
import os from "os";
import path from "path";

export class SettlementEngine {
  private program: Program<FlowVault>;
  private facilitatorKeypair: Keypair;

  constructor(
    private priorityFeeOracle: PriorityFeeOracle,
    private circuitBreaker: CircuitBreaker // Accept the breaker
  ) {
    // ... (keypair loading is correct)
    const keypairPath = path.resolve(
      config.get<string>("facilitatorKeypairPath").replace("~", os.homedir())
    );
    if (!fs.existsSync(keypairPath)) {
      throw new Error(`Facilitator keypair not found at path: ${keypairPath}`);
    }
    const secretKey = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
    this.facilitatorKeypair = Keypair.fromSecretKey(new Uint8Array(secretKey));
    logger.info(
      { pubkey: this.facilitatorKeypair.publicKey.toBase58() },
      "Facilitator wallet loaded"
    );

    const wallet = new Wallet(this.facilitatorKeypair);
    const provider = new AnchorProvider(connection, wallet, {
      commitment: "confirmed",
    });

    this.program = new Program<FlowVault>(idl as any, provider);
  }

  public async settle(
    agent: PublicKey,
    providerAuthority: PublicKey,
    vaultPda: PublicKey,
    amount: BN,
    nonce: BN,
    signature: Buffer
  ): Promise<string | null> {
    logger.info(
      {
        agent: agent.toBase58(),
        provider: providerAuthority.toBase58(),
        amount: amount.toString(),
        nonce: nonce.toString(),
      },
      "Attempting settlement..."
    );

    // 1. Check the Circuit Breaker first
    if (!this.circuitBreaker.canAttempt()) {
      logger.warn(
        { state: this.circuitBreaker.getState() },
        "Settlement skipped: Circuit Breaker is OPEN"
      );
      return null;
    }

    try {
      // 2. Derive all PDAs
      const [providerPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("provider"), providerAuthority.toBuffer()],
        this.program.programId
      );
      const [globalConfigPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("config")],
        this.program.programId
      );
      const [vaultTokenAccountPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault_token_account"), agent.toBuffer()],
        this.program.programId
      );

      // 3. Fetch Provider account for bounty logic
      const providerAccount = await this.program.account.provider.fetch(
        providerPda
      );

      // --- [BOUNTY: ATXP & Visa TAP] ---
      if (providerAccount.protocol.atxpBridge) {
        logger.info(
          {
            provider: providerAuthority.toBase58(),
            visaMerchantId: providerAccount.visaMerchantId, // [BOUNTY: Visa TAP]
          },
          "[BOUNTY: ATXP] Provider is ATXP-compatible. Routing to ATXP API (simulation)..."
        );
        // This counts as a "success" for the circuit breaker
        this.circuitBreaker.onSuccess();
        return `atxp-simulated-settlement-${Date.now()}`;
      }
      // --- END BOUNTY LOGIC ---

      logger.info(
        {
          provider: providerAuthority.toBase58(),
          visaMerchantId: providerAccount.visaMerchantId, // [BOUNTY: Visa TAP]
        },
        "Provider is NativeSPL. Proceeding with on-chain settlement."
      );

      // 4. [CRITICAL FIX] Construct the *correct* 5-part message
      const message = constructSettlementMessage(
        vaultPda,
        providerPda,
        amount,
        nonce
      );

      const ed25519Instruction = Ed25519Program.createInstructionWithPublicKey({
        publicKey: agent.toBytes(),
        message,
        signature,
      });

      // 5. [BOUNTY: Switchboard] Get dynamic fee
      const priorityFeeInstruction = ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: this.priorityFeeOracle.getLatestPriorityFee(),
      });

      // 6. Build the transaction
      const tx = await this.program.methods
        .settleBatch(amount, nonce)
        .accounts({
          facilitator: this.facilitatorKeypair.publicKey,
          agent: agent,
          vault: vaultPda,
          provider: providerPda,
          globalConfig: globalConfigPda,
          vaultTokenAccount: vaultTokenAccountPda,
          destination: providerAccount.destination, // Use 'destination' from providerAccount
          tokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
          instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        } as any)
        .preInstructions([priorityFeeInstruction, ed25519Instruction])
        .transaction();

      // 7. Send and confirm
      const signatureTx = await connection.sendTransaction(tx, [
        this.facilitatorKeypair,
      ]);
      logger.info({ signature: signatureTx }, "Settlement transaction sent");

      const confirmation = await connection.confirmTransaction(
        signatureTx,
        "confirmed"
      );

      if (confirmation.value.err) {
        throw new Error(`Transaction failed confirmation: ${confirmation.value.err}`);
      }

      logger.info({ signature: signatureTx }, "Settlement transaction confirmed");
      this.circuitBreaker.onSuccess(); // Report success
      return signatureTx;

    } catch (error) {
      logger.error(error, "Settlement failed");
      this.circuitBreaker.onFailure(); // Report failure
      return null;
    }
  }
}