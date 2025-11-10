import {
  PublicKey,
  Keypair,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  Ed25519Program,
  ComputeBudgetProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram
} from "@solana/web3.js";
import { Program, BN } from "@coral-xyz/anchor";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { FlowVault } from "./idl/flow_vault";
import { logger } from "./utils/logger";
import { connection } from "./utils/rpc-client";
import { PriorityFeeOracle } from "./priority-fee-oracle";
import { CircuitBreaker } from "./circuit-breaker";
import { settlementsTotal, settlementAmount } from "./utils/metrics";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import config from "config";
import axios from "axios";

interface AtxpSettlementResponse {
  txId: string;
}

/**
 * Production-grade settlement engine with:
 * - ATXP protocol routing
 * - Visa TAP merchant tracking
 * - Switchboard-optimized fees
 * - Circuit breaker protection
 */

export class SettlementEngine {
  private program: Program<FlowVault>;
  private facilitatorKeypair: Keypair;
  private atxpConnection: string | null = null;

  constructor(
    private priorityFeeOracle: PriorityFeeOracle,
    private circuitBreaker: CircuitBreaker
  ) {
    const keypairPath = path.resolve(
      config.get<string>("facilitatorKeypairPath").replace("~", os.homedir())
    );

    if (!fs.existsSync(keypairPath)) {
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

    this.initializeAtxp();
  }

  private initializeAtxp(): void {
    this.atxpConnection = process.env.ATXP_CONNECTION || null;

    if (!this.atxpConnection) {
      logger.warn("[BOUNTY: ATXP] No ATXP_CONNECTION found. ATXP settlements will be simulated.");
    } else {
      logger.info("[BOUNTY: ATXP] ATXP connection string loaded");
    }
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
      logger.warn("Circuit breaker is OPEN. Blocking settlement.");
      settlementsTotal.inc({ status: "blocked" });
      return null;
    }

    try {
      const [providerPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("provider"), providerAuthority.toBuffer()],
        this.program.programId
      );

      const providerAccount = await this.program.account.provider.fetch(providerPda);

      if (providerAccount.protocol.atxpBridge) {
        return await this.settleViaAtxp(
          agent,
          providerAuthority,
          vaultPda,
          amount,
          nonce,
          signature,
          providerAccount
        );
      }

      return await this.settleOnChain(
        agent,
        providerAuthority,
        vaultPda,
        amount,
        nonce,
        signature,
        providerAccount
      );

    } catch (error: any) {
      logger.error(
        { error: error.message, agent: agent.toBase58(), amount: amount.toString() },
        "Settlement failed"
      );

      this.circuitBreaker.onFailure();
      settlementsTotal.inc({ status: "failure" });

      throw error;
    }
  }

  /**
   * [BOUNTY: ATXP] Production ATXP settlement using connection string
   */
  private async settleViaAtxp(
    agent: PublicKey,
    providerAuthority: PublicKey,
    vaultPda: PublicKey,
    amount: BN,
    nonce: BN,
    signature: Buffer,
    providerAccount: any
  ): Promise<string> {
    logger.info(
      {
        provider: providerAuthority.toBase58(),
        amount: amount.toString(),
        visaMerchantId: providerAccount.visaMerchantId,
      },
      "[BOUNTY: ATXP] Routing settlement via ATXP protocol"
    );

    if (!this.atxpConnection) {
      throw new Error(
        "[BOUNTY: ATXP] ATXP_CONNECTION environment variable is required for ATXP settlements. " +
        "Please configure ATXP connection string in .env"
      );
    }

    try {
      const url = new URL(this.atxpConnection);
      const connectionToken = url.searchParams.get("connection_token");
      const accountId = url.searchParams.get("account_id");

      const response = await axios.post<AtxpSettlementResponse>(
        "https://api.atxp.ai/v1/settlements",
        {
          sourceChain: "solana",
          sourceAccount: agent.toBase58(),
          destinationChain: providerAccount.protocol.atxpBridge.destinationChain || "ethereum",
          destinationAccount: providerAccount.destination.toBase58(),
          amount: amount.toString(),
          nonce: nonce.toString(),
          signature: signature.toString("base64"),
          metadata: {
            vaultPda: vaultPda.toBase58(),
            visaMerchantId: providerAccount.visaMerchantId,
          },
        },
        {
          headers: {
            "Authorization": `Bearer ${connectionToken}`,
            "X-ATXP-Account-ID": accountId,
            "Content-Type": "application/json",
          },
          timeout: 30000,
        }
      );

      logger.info(
        { txId: response.data.txId },
        "[BOUNTY: ATXP] Settlement confirmed via ATXP protocol"
      );

      settlementsTotal.inc({ status: "success_atxp" });
      settlementAmount.observe(amount.toNumber());
      this.circuitBreaker.onSuccess();

      return response.data.txId;

    } catch (error: any) {
      logger.error(
        { error: error.message },
        "[BOUNTY: ATXP] ATXP settlement failed"
      );

      this.circuitBreaker.onFailure();
      settlementsTotal.inc({ status: "failure_atxp" });

      throw new Error(`ATXP settlement failed: ${error.message}`);
    }
  }

  private async settleOnChain(
    agent: PublicKey,
    providerAuthority: PublicKey,
    vaultPda: PublicKey,
    amount: BN,
    nonce: BN,
    signature: Buffer,
    providerAccount: any
  ): Promise<string> {
    const [providerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("provider"), providerAuthority.toBuffer()],
      this.program.programId
    );

    const vaultAccount = await this.program.account.vault.fetch(vaultPda);
    const [configPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      this.program.programId
    );

    const NATIVE_SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
    const isNativeSol = vaultAccount.tokenMint.equals(NATIVE_SOL_MINT);

    logger.info(
      {
        vault: vaultPda.toBase58(),
        tokenMint: vaultAccount.tokenMint.toBase58(),
        isNativeSol,
        vaultTokenAccount: vaultAccount.vaultTokenAccount?.toBase58() || "none",
      },
      "Vault payment type detected"
    );

    if (providerAccount.visaMerchantId) {
      logger.info(
        {
          visaMerchantId: providerAccount.visaMerchantId,
          amount: amount.toString(),
        },
        "[BOUNTY: Visa TAP] Settlement includes Visa merchant ID"
      );
    }

    const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
      publicKey: agent.toBytes(),
      message: this.constructMessage(vaultPda, providerPda, amount, nonce),
      signature: signature,
    });

    let settleBatchIx: TransactionInstruction;

    if (isNativeSol) {
      logger.info("✅ Using native SOL settlement (no Token Program)");

      settleBatchIx = await this.program.methods
        .settleBatch(amount, nonce)
        .accounts({
          facilitator: this.facilitatorKeypair.publicKey,
          agent: agent,
          vault: vaultPda,
          globalConfig: configPda,
          provider: providerPda,
          destination: providerAccount.destination,
          systemProgram: SystemProgram.programId,
          instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        } as any)
        .instruction();

    } else {
      logger.info("Using SPL token settlement (with Token Program)");

      settleBatchIx = await this.program.methods
        .settleBatch(amount, nonce)
        .accounts({
          facilitator: this.facilitatorKeypair.publicKey,
          agent: agent,
          vault: vaultPda,
          vaultTokenAccount: vaultAccount.vaultTokenAccount,
          globalConfig: configPda,
          provider: providerPda,
          destination: providerAccount.destination,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        } as any)
        .instruction();
    }

    const instructions: TransactionInstruction[] = [];

    const priorityFee = this.priorityFeeOracle.getLatestPriorityFee();

    if (priorityFee > 0) {
      const computeBudgetIx = ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: priorityFee,
      });
      instructions.push(computeBudgetIx);

      logger.info(
        { priorityFee, source: "Switchboard+RPC" },
        "[BOUNTY: Switchboard] Optimizing transaction with dynamic priority fee"
      );
    }

    instructions.push(ed25519Ix, settleBatchIx);

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("finalized");

    const message = new TransactionMessage({
      payerKey: this.facilitatorKeypair.publicKey,
      recentBlockhash: blockhash,
      instructions,
    }).compileToV0Message();

    const tx = new VersionedTransaction(message);
    tx.sign([this.facilitatorKeypair]);

    logger.info({
      txAccounts: instructions[instructions.length - 1].keys.map(k => ({
        pubkey: k.pubkey.toBase58(),
        isSigner: k.isSigner,
        isWritable: k.isWritable
      }))
    }, "Settlement transaction accounts");

    const txId = await connection.sendTransaction(tx, {
      skipPreflight: false,
      maxRetries: 3,
    });

    try {
      const confirmation = await connection.confirmTransaction(
        {
          signature: txId,
          blockhash,
          lastValidBlockHeight,
        },
        "confirmed"
      );

      if (confirmation.value.err) {
        const txDetails = await connection.getTransaction(txId, {
          maxSupportedTransactionVersion: 0,
        });

        logger.error({
          error: confirmation.value.err,
          logs: txDetails?.meta?.logMessages,
          txId
        }, "Transaction failed with logs");

        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}\nLogs: ${JSON.stringify(txDetails?.meta?.logMessages)}`);
      }

      logger.info(
        { txId, amount: amount.toString(), slot: confirmation.context.slot },
        "Settlement confirmed on-chain"
      );

      this.circuitBreaker.onSuccess();
      settlementsTotal.inc({ status: "success" });
      settlementAmount.observe(amount.toNumber());

      return txId;

    } catch (error: any) {
      logger.error({ txId, error: error.message }, "Settlement confirmation failed");
      throw error;
    }
  }

  public canSettle(): boolean {
    return this.circuitBreaker.canAttempt();
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

  public async shutdown(): Promise<void> {
    logger.info("SettlementEngine shutting down...");
  }
}