import WebSocket from "ws";
import { PublicKey } from "@solana/web3.js";
import { BN, Program } from "@coral-xyz/anchor";
import config from "config";
import { logger } from "./utils/logger";
import { SettlementEngine } from "./settlement-engine";
import { FlowVault } from "./idl/flow_vault";
import { SessionStore } from "./utils/session-state";

interface Session {
  ws: WebSocket;
  agent: PublicKey;
  providerAuthority: PublicKey;
  vaultPda: PublicKey;
  spentOffchain: BN;
  isSettling: boolean;
  settlementTimer: NodeJS.Timeout;
}

export class SessionManager {
  private sessions = new Map<string, Session>();
  private settlementThreshold: BN;
  private settlementPeriodMs: number;
  private sessionStore: SessionStore;

  constructor(
    private settlementEngine: SettlementEngine,
    private program: Program<FlowVault>
  ) {
    this.settlementThreshold = new BN(
      config.get<number>("settlement.threshold")
    );
    this.settlementPeriodMs = config.get<number>("settlement.periodMs");
    this.sessionStore = new SessionStore();

    logger.info(
      {
        threshold: this.settlementThreshold.toString(),
        periodMs: this.settlementPeriodMs,
      },
      "SessionManager initialized with Redis persistence"
    );
  }

  async handleConnect(
    ws: WebSocket,
    agentPubkey: string,
    providerPubkey: string
  ) {
    const agent = new PublicKey(agentPubkey);
    const providerAuthority = new PublicKey(providerPubkey);
    const agentId = agent.toBase58();
    logger.info({ agentId, provider: providerPubkey }, "Agent connecting...");

    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), agent.toBuffer()],
      this.program.programId
    );

    try {
      const persistedSession = await this.sessionStore.loadSession(agentId);
      let spentOffchain = new BN(0);

      if (persistedSession) {
        logger.info(
          { agentId, spentOffchain: persistedSession.spentOffchain },
          "Restored session from Redis"
        );
        spentOffchain = new BN(persistedSession.spentOffchain);
      }

      const vaultAccount = await this.program.account.vault.fetch(vaultPda);

      if (vaultAccount.depositAmount.sub(vaultAccount.totalSettled).lte(new BN(0))) {
        logger.warn({ agentId }, "Vault has insufficient balance. Disconnecting agent.");
        ws.send(JSON.stringify({
          type: "error",
          message: "Vault has insufficient balance for streaming."
        }));
        ws.close();
        return;
      }

      logger.info({
        agentId,
        balance: vaultAccount.depositAmount.toString(),
        totalSettled: vaultAccount.totalSettled.toString(),
        available: vaultAccount.depositAmount.sub(vaultAccount.totalSettled).toString()
      }, "Vault validated");

      const [providerPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("provider"), providerAuthority.toBuffer()],
        this.program.programId
      );
      await this.program.account.provider.fetch(providerPda);
      logger.info({ provider: providerPubkey }, "Provider validated");

      const settlementTimer = setInterval(
        () => this.triggerSettlementCheck(agentId),
        this.settlementPeriodMs
      );

      const session: Session = {
        ws,
        agent,
        providerAuthority,
        vaultPda,
        spentOffchain,
        isSettling: false,
        settlementTimer,
      };

      this.sessions.set(agentId, session);

      await this.sessionStore.saveSession(agentId, {
        agent,
        providerAuthority,
        vaultPda,
        spentOffchain,
      });

      logger.info({ agentId, provider: providerPubkey }, "Agent session started and persisted");
    } catch (error) {
      logger.error(error, "Vault or Provider validation failed. Disconnecting agent.");
      ws.send(JSON.stringify({ type: "error", message: "Vault or Provider not found or invalid." }));
      ws.close();
    }
  }

  public async reportUsage(agentId: string, usageAmount: BN) {
    const session = this.sessions.get(agentId);
    if (!session) {
      logger.warn({ agentId }, "reportUsage called for unknown session");
      return;
    }

    session.spentOffchain = session.spentOffchain.add(usageAmount);
    logger.debug(
      {
        agentId,
        usage: usageAmount.toString(),
        totalSpent: session.spentOffchain.toString(),
      },
      "Usage reported"
    );

    await this.sessionStore.saveSession(agentId, {
      agent: session.agent,
      providerAuthority: session.providerAuthority,
      vaultPda: session.vaultPda,
      spentOffchain: session.spentOffchain,
    });

    if (session.spentOffchain.gte(this.settlementThreshold)) {
      logger.info({ agentId }, "Threshold exceeded, triggering settlement");
      await this.triggerSettlementCheck(agentId);
    }
  }

  async handleDisconnect(agentId: string) {
    const session = this.sessions.get(agentId);
    if (!session) return;

    clearInterval(session.settlementTimer);
    this.sessions.delete(agentId);

    logger.info({ agentId }, "Agent disconnected, session kept in Redis for reconnection");
  }

  private async triggerSettlementCheck(agentId: string) {
    const session = this.sessions.get(agentId);
    if (!session) {
      logger.warn({ agentId }, "triggerSettlementCheck: session not found");
      return;
    }

    if (session.isSettling) {
      logger.debug({ agentId }, "Settlement already in progress, skipping");
      return;
    }

    if (session.spentOffchain.lt(this.settlementThreshold)) {
      logger.debug(
        { agentId, spent: session.spentOffchain.toString() },
        "Spent amount below threshold, skipping settlement"
      );
      return;
    }

    const vaultAccount = await this.program.account.vault.fetch(
      session.vaultPda
    );
    const amount = session.spentOffchain;
    const nonce = vaultAccount.nonce.add(new BN(1));

    logger.info(
      { agentId, amount: amount.toString(), nonce: nonce.toString() },
      "Requesting settlement signature from agent"
    );

    session.ws.send(
      JSON.stringify({
        type: "request_signature",
        amount: amount.toString(),
        nonce: nonce.toString(),
      })
    );
  }

  async handleSignature(
    agentId: string,
    amountStr: string,
    nonceStr: string,
    signature: string
  ) {
    const session = this.sessions.get(agentId);
    if (!session) {
      logger.warn({ agentId }, "handleSignature: session not found");
      return;
    }

    if (session.isSettling) {
      logger.warn({ agentId }, "Settlement already in progress");
      return;
    }

    session.isSettling = true;

    try {
      const amount = new BN(amountStr);
      const nonce = new BN(nonceStr);
      const signatureBuffer = Buffer.from(signature, "base64");

      logger.info(
        { agentId, amount: amount.toString(), nonce: nonce.toString() },
        "Received settlement signature, submitting to blockchain"
      );

      const txId = await this.settlementEngine.settle(
        session.agent,
        session.providerAuthority,
        session.vaultPda,
        amount,
        nonce,
        signatureBuffer
      );

      if (txId) {
        session.spentOffchain = session.spentOffchain.sub(amount);

        // Update Redis
        await this.sessionStore.saveSession(agentId, {
          agent: session.agent,
          providerAuthority: session.providerAuthority,
          vaultPda: session.vaultPda,
          spentOffchain: session.spentOffchain,
        });

        session.ws.send(
          JSON.stringify({
            type: "settlement_confirmed",
            txId,
            amountSettled: amount.toString(),
          })
        );
        logger.info({ agentId, txId }, "Settlement confirmed");
      } else {
        session.ws.send(
          JSON.stringify({
            type: "settlement_failed",
            message: "Circuit breaker is OPEN. Settlement blocked.",
          })
        );
        logger.warn({ agentId }, "Settlement blocked by circuit breaker");
      }
    } catch (error: any) {
      logger.error(error, "Error processing settlement signature");
      session.ws.send(
        JSON.stringify({
          type: "settlement_failed",
          message: error.message,
        })
      );
    } finally {
      session.isSettling = false;
    }
  }

  public async cleanup(): Promise<void> {
    logger.info("Cleaning up session manager...");

    const savePromises = Array.from(this.sessions.entries()).map(
      async ([agentId, session]) => {
        await this.sessionStore.saveSession(agentId, {
          agent: session.agent,
          providerAuthority: session.providerAuthority,
          vaultPda: session.vaultPda,
          spentOffchain: session.spentOffchain,
        });
      }
    );

    await Promise.all(savePromises);
    await this.sessionStore.close();
    logger.info("Session manager cleanup complete");
  }
}