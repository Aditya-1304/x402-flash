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
  public sessions = new Map<string, Session>();
  private dashboardObservers = new Set<WebSocket>();
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
  public async triggerSettlement(agentId: string): Promise<void> {
    await this.triggerSettlementCheck(agentId);
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
    if (!this.settlementEngine.canSettle()) {
      logger.warn({ agentId }, "Circuit breaker is OPEN, skipping settlement request");
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
        vaultPda: session.vaultPda.toBase58(),
        providerAuthority: session.providerAuthority.toBase58(),
      })
    );
  }

  public registerDashboard(ws: WebSocket): void {
    this.dashboardObservers.add(ws);
    logger.info("Dashboard observer registered");

    ws.on("close", () => {
      this.dashboardObservers.delete(ws);
      logger.info("Dashboard observer removed");
    });
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

        const settlementEvent = {
          type: "settlement_confirmed",
          txId: txId,
          amount: amount.toString(),
          agentId: agentId,
          vaultPda: session.vaultPda.toBase58(),
        };

        this.broadcastToAll(settlementEvent);
        this.broadcastToDashboards(settlementEvent);

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
          fatal: true,
        })
      );

    } finally {
      session.isSettling = false;
    }
  }

  private broadcastToAll(message: any): void {
    const msgString = JSON.stringify(message);
    this.sessions.forEach((session) => {
      if (session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(msgString);
      }
    });
  }

  public broadcastToDashboards(message: any): void {
    const msgString = JSON.stringify(message);
    let sent = 0;

    console.log(`[DEBUG] Broadcasting ${message.type} to ${this.dashboardObservers.size} dashboards`);

    this.dashboardObservers.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        console.log(`[DEBUG] Sending to dashboard ${sent + 1}`);
        ws.send(msgString);
        sent++;
      }
    });

    logger.debug(
      { type: message.type, dashboards: sent },
      "Broadcasted to dashboards"
    );
  }


  public getSettlementThreshold(): BN {
    return this.settlementThreshold;
  }

  public broadcastMetrics(): void {
    const sessions = Array.from(this.sessions.values());

    const metricsUpdate = {
      type: "session_update",
      timestamp: Date.now(),
      sessions: sessions.map(s => ({
        sessionId: s.agent.toBase58().substring(0, 16),
        agentPubkey: s.agent.toBase58(),
        consumed: s.spentOffchain.toNumber(),
        packetsDelivered: Math.floor(s.spentOffchain.toNumber() / 1000),
      })),
    };

    console.log(`📊 Broadcasting metrics: ${sessions.length} sessions`);
    this.broadcastToDashboards(metricsUpdate);
  }



  public broadcastToAllClients(message: Record<string, unknown>): void {
    const msgString = JSON.stringify(message);

    this.sessions.forEach((session) => {
      if (session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(msgString);
      }
    });

    this.dashboardObservers.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(msgString);
      }
    });

    logger.debug({ messageType: message.type }, "Broadcasted message to all clients");
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

