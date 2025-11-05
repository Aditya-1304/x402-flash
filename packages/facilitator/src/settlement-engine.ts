import { PublicKey, Keypair, TransactionInstruction, TransactionMessage, VersionedTransaction, Ed25519Program } from "@solana/web3.js";
import { Program, BN } from "@coral-xyz/anchor";
import { FlowVault } from "./idl/flow_vault";
import { logger } from "./utils/logger";
import { connection } from "./utils/rpc-client";
import { PriorityFeeOracle } from "./priority-fee-oracle";
import { CircuitBreaker } from "./circuit-breaker";
import { settlementsTotal, settlementAmount } from "./utils/metrics"; // Add metrics
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import config from "config";

export class SettlementEngine {
  private program: Program<FlowVault>;
  private facilitatorKeypair: Keypair;

  constructor(
    private priorityFeeOracle: PriorityFeeOracle,
    private circuitBreaker: CircuitBreaker
  ) {
    const keypairPath = path.resolve(
      config.get<string>("facilitatorKeypairPath").replace("~", os.homedir())
    );
    if (!fs.existsSync(keypairPath)) {
      logger.error({ path: keypairPath }, "Facilitator keypair not found");
      throw new Error(`Facilitator keypair not found at ${keypairPath}`);
    }
    const secretKey = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
    this.facilitatorKeypair = Keypair.fromSecretKey(new Uint8Array(secretKey));
    logger.info(
      { pubkey: this.facilitatorKeypair.publicKey.toBase58() },
      "Facilitator wallet loaded"
    );

    const wallet = {
      publicKey: this.facilitatorKeypair.publicKey,
      signTransaction: async (tx: any) => tx,
      signAllTransactions: async (txs: any[]) => txs,
      payer: this.facilitatorKeypair,
    };

    const provider = {
      connection,
      publicKey: this.facilitatorKeypair.publicKey,
      wallet,
    };

    this.program = new Program<FlowVault>(
      require("./idl/flow_vault.json"),
      provider as any
    );
  }

  public async settle(
    agent: PublicKey,
    providerAuthority: PublicKey,
    vaultPda: PublicKey,
    amount: BN,
    nonce: BN,
    signature: Buffer
  ): Promise<string | null> {
    if (!this.circuitBreaker.canAttempt()) {
      logger.warn("Circuit breaker is OPEN. Blocking settlement attempt.");
      settlementsTotal.inc({ status: "blocked" });
      return null;
    }

    try {
      const [providerPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("provider"), providerAuthority.toBuffer()],
        this.program.programId
      );

      const vaultAccount = await this.program.account.vault.fetch(vaultPda);
      const providerAccount = await this.program.account.provider.fetch(providerPda);
      const [configPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("config")],
        this.program.programId
      );

      const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
        publicKey: agent.toBytes(),
        message: this.constructMessage(vaultPda, providerPda, amount, nonce),
        signature: signature,
      });

      const settleBatchIx = await this.program.methods
        .settleBatch(amount, nonce)
        .accounts({
          facilitator: this.facilitatorKeypair.publicKey,
          agent: agent,
          vault: vaultPda,
          vaultTokenAccount: vaultAccount.vaultTokenAccount,
          globalConfig: configPda,
          provider: providerPda,
          destination: providerAccount.destination,
          tokenProgram: require("@solana/spl-token").TOKEN_PROGRAM_ID,
          instructions: require("@solana/web3.js").SYSVAR_INSTRUCTIONS_PUBKEY,
        } as any)
        .instruction();

      const instructions: TransactionInstruction[] = [ed25519Ix, settleBatchIx];
      const priorityFee = this.priorityFeeOracle.getLatestPriorityFee();

      if (priorityFee > 0) {
        const computeBudgetIx = require("@solana/web3.js").ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: priorityFee,
        });
        instructions.unshift(computeBudgetIx);
      }

      const { blockhash } = await connection.getLatestBlockhash();
      const message = new TransactionMessage({
        payerKey: this.facilitatorKeypair.publicKey,
        recentBlockhash: blockhash,
        instructions,
      }).compileToV0Message();

      const tx = new VersionedTransaction(message);
      tx.sign([this.facilitatorKeypair]);

      const txId = await connection.sendTransaction(tx, {
        skipPreflight: false,
        maxRetries: 3,
      });

      await connection.confirmTransaction(txId, "confirmed");

      logger.info({ txId, amount: amount.toString() }, "Settlement confirmed on-chain");

      // Record metrics
      this.circuitBreaker.onSuccess();
      settlementsTotal.inc({ status: "success" });
      settlementAmount.observe(amount.toNumber());

      return txId;
    } catch (error: any) {
      logger.error(error, "Settlement failed");
      this.circuitBreaker.onFailure();
      settlementsTotal.inc({ status: "failure" });
      throw error;
    }
  }

  private constructMessage(
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
}