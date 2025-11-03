import { PublicKey } from "@solana/web3.js";
import WebSocket from "ws";
import { logger } from "./utils/logger";
import { SettlementEngine } from "./settlement-engine";
import { Program, BN } from "@coral-xyz/anchor";
import { FlowVault } from "./idl/flow_vault";
import config from "config";

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

  constructor(
    private settlementEngine: SettlementEngine,
    private program: Program<FlowVault>
  ) {
    this.settlementThreshold = new BN(
      config.get<number>("settlement.threshold")
    );
    this.settlementPeriodMs = config.get<number>("settlement.periodMs");
    logger.info(
      {
        threshold: this.settlementThreshold.toString(),
        periodMs: this.settlementPeriodMs,
      },
      "SessionManager initialized"
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
      const vaultAccount = await this.program.account.vault.fetch(vaultPda);
      logger.info({ agentId, balance: vaultAccount.depositAmount.toString() }, "Vault validated");

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

      this.sessions.set(agentId, {
        ws,
        agent,
        providerAuthority,
        vaultPda,
        spentOffchain: new BN(0),
        isSettling: false,
        settlementTimer,
      });

      logger.info({ agentId, provider: providerPubkey }, "Agent session started");
    } catch (error) {
      logger.error(error, "Vault or Provider validation failed. Disconnecting agent.");
      ws.send(JSON.stringify({ type: "error", message: "Vault or Provider not found or invalid." }));
      ws.close();
    }
  }

  public reportUsage(agentId: string, usageAmount: BN) {
    const session = this.sessions.get(agentId);
    if (session && !session.isSettling) {
      session.spentOffchain = session.spentOffchain.add(usageAmount);
      logger.info(
        {
          agentId,
          usage: usageAmount.toString(),
          newTotal: session.spentOffchain.toString(),
        },
        "Usage reported by Provider"
      );
    } else {
      logger.warn({ agentId }, "Received usage report for unknown or settling session");
    }
  }

  handleDisconnect(agentId: string) {
    logger.info({ agentId }, "Agent disconnected");
    const session = this.sessions.get(agentId);
    if (session) {
      clearInterval(session.settlementTimer);
      this.sessions.delete(agentId);
    }
  }

  private async triggerSettlementCheck(agentId: string) {
    const session = this.sessions.get(agentId);
    if (!session || session.isSettling || session.spentOffchain.isZero()) {
      return;
    }

    if (session.spentOffchain.gte(this.settlementThreshold)) {
      logger.info({ agentId, amount: session.spentOffchain.toString() }, "Settlement threshold reached. Requesting signature...");
      session.isSettling = true;

      try {
        const vaultAccount = await this.program.account.vault.fetch(session.vaultPda);
        const nonce = vaultAccount.nonce.add(new BN(1));

        const message = {
          type: "request_signature",
          amount: session.spentOffchain.toString(),
          nonce: nonce.toString(),
        };
        session.ws.send(JSON.stringify(message));
      } catch (error) {
        logger.error(error, "Failed to fetch vault for settlement check");
        session.isSettling = false;
      }
    }
  }

  async handleSignature(
    agentId: string,
    amountStr: string,
    nonceStr: string,
    signature: string
  ) {
    const session = this.sessions.get(agentId);
    if (!session || !session.isSettling) {
      logger.warn({ agentId }, "Received unexpected signature");
      return;
    }

    const amount = new BN(amountStr);
    const nonce = new BN(nonceStr);
    const sigBuffer = Buffer.from(signature, "base64");

    if (!amount.eq(session.spentOffchain)) {
      logger.warn({
        agentId,
        clientAmount: amount.toString(),
        serverAmount: session.spentOffchain.toString()
      }, "Client-sent amount does not match server-tracked amount. Rejecting settlement.");
      session.ws.send(JSON.stringify({ type: "settlement_failed", message: "Amount mismatch" }));
      session.isSettling = false;
      return;
    }

    const txId = await this.settlementEngine.settle(
      session.agent,
      session.providerAuthority,
      session.vaultPda,
      amount,
      nonce,
      sigBuffer
    );

    if (txId) {
      session.spentOffchain = session.spentOffchain.sub(amount);
      session.ws.send(JSON.stringify({ type: "settlement_confirmed", txId }));
    } else {
      logger.error({ agentId }, "Settlement Engine failed to settle.");
      session.ws.send(JSON.stringify({ type: "settlement_failed" }));
    }

    session.isSettling = false;
  }
}