import express from 'express';
import WebSocket from 'ws';
import { Server as HTTPServer } from 'http';
import { IncomingMessage } from 'http';
import { Socket } from 'net';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { FlashClient } from '../../sdk/dist/FlashClient';
import { DataGenerator } from './data-generator';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

export interface ProviderConfig {
  port: number;
  pricePerPacket: number;
  rpcUrl: string;
  providerKeypair: string;
  facilitatorUrl: string;
  destinationTokenAccount: string;
}

interface StreamSession {
  sessionId: string;
  vaultPubkey: string;
  agentPubkey: string;
  ws: WebSocket;
  pricePerPacket: number;
  consumed: number;
  packetsDelivered: number;
  interval?: NodeJS.Timeout;
}

export class StreamingServer {
  private app: express.Application;
  private wss: WebSocket.Server;
  private dataGen: DataGenerator;
  private config: ProviderConfig;
  private activeStreams: Map<string, StreamSession> = new Map();
  private metricsInterval?: NodeJS.Timeout;
  private server?: HTTPServer;
  private providerClient: FlashClient;
  private providerKeypair: Keypair;
  private facilitatorWs: WebSocket | null = null;

  constructor(config: ProviderConfig) {
    this.config = config;
    this.app = express();
    this.wss = new WebSocket.Server({ noServer: true });
    this.dataGen = new DataGenerator();

    const keypairData = JSON.parse(fs.readFileSync(config.providerKeypair, 'utf-8'));
    this.providerKeypair = Keypair.fromSecretKey(new Uint8Array(keypairData));

    const connection = new Connection(config.rpcUrl, 'confirmed');
    const signer = {
      keypair: this.providerKeypair,
      publicKey: this.providerKeypair.publicKey,
      signMessage: async (message: Uint8Array) => {
        const nacl = await import('tweetnacl');
        return nacl.sign.detached(message, this.providerKeypair.secretKey);
      },
      signTransaction: async (tx: any) => {
        tx.sign(this.providerKeypair);
        return tx;
      },
      signAllTransactions: async (txs: any[]) => {
        txs.forEach(tx => tx.sign(this.providerKeypair));
        return txs;
      }
    };

    this.providerClient = new FlashClient(connection, signer, {
      facilitatorUrl: config.facilitatorUrl
    });

    this.setupRoutes();
    this.setupWebSocket();
  }

  public async initialize(): Promise<void> {
    console.log('[Provider] Registering on-chain...');

    try {
      const txId = await this.providerClient.registerProvider({
        destinationTokenAccount: new PublicKey(this.config.destinationTokenAccount),
        protocol: { nativeSpl: {} },
        visaMerchantId: process.env.VISA_MERCHANT_ID
      });

      console.log(`[Provider] Registered on-chain: ${txId}`);
      console.log(`[Provider] Public Key: ${this.providerKeypair.publicKey.toBase58()}`);

      await this.connectToFacilitator();

    } catch (error: any) {
      if (error.message.includes('already in use')) {
        console.log('[Provider] Already registered on-chain');
        await this.connectToFacilitator();
      } else {
        throw error;
      }
    }
  }

  private async connectToFacilitator(): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log('[Provider] Connecting to facilitator...');

      const url = new URL(this.config.facilitatorUrl);
      url.searchParams.set('provider', this.providerKeypair.publicKey.toBase58());
      url.searchParams.set('type', 'provider');

      this.facilitatorWs = new WebSocket(url.toString());

      this.facilitatorWs.onopen = () => {
        console.log('[Provider] Connected to facilitator');
        resolve();
      };

      this.facilitatorWs.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data.toString());

          if (msg.type === 'settlement_confirmed') {
            console.log(`[Provider] Settlement confirmed: ${msg.txId}`);
            this.handleSettlementConfirmed(msg);
          }

        } catch (error) {
          console.error('[Provider] Error handling facilitator message:', error);
        }
      };

      this.facilitatorWs.onerror = (error) => {
        console.error('[Provider] Facilitator connection error:', error);
        reject(error);
      };

      this.facilitatorWs.onclose = () => {
        console.log('[Provider] Facilitator connection closed');
        this.facilitatorWs = null;
      };
    });
  }

  private setupRoutes(): void {
    this.app.use((req, res, next) => {
      res.setHeader("Access-Control-Allow-Origin", "http://localhost:3000");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        res.sendStatus(200);
        return;
      }
      next();
    });

    this.app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        activeStreams: this.activeStreams.size,
        pricePerPacket: this.config.pricePerPacket,
        providerPubkey: this.providerKeypair.publicKey.toBase58(),
        timestamp: Date.now()
      });
    });

    this.app.get('/.well-known/x402', (req, res) => {
      res.json({
        version: '1.0',
        provider: 'x402-flash-demo-provider',
        providerPubkey: this.providerKeypair.publicKey.toBase58(),
        pricing: {
          model: 'per-packet',
          pricePerPacket: this.config.pricePerPacket,
          currency: 'lamports'
        },
        capabilities: ['streaming', 'real-time-data'],
        endpoints: {
          websocket: `ws://localhost:${this.config.port}`,
          health: `http://localhost:${this.config.port}/health`
        }
      });
    });

    this.app.get('/sessions', (req, res) => {
      const sessions = Array.from(this.activeStreams.values()).map(s => ({
        sessionId: s.sessionId,
        vaultPubkey: s.vaultPubkey,
        agentPubkey: s.agentPubkey,
        consumed: s.consumed,
        packetsDelivered: s.packetsDelivered
      }));
      res.json({ count: sessions.length, sessions });
    });
  }

  private setupWebSocket(): void {
    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      const sessionId = this.generateSessionId();
      console.log(`[Provider] New connection: ${sessionId}`);

      ws.on('message', async (data: WebSocket.Data) => {
        try {
          const msg = JSON.parse(data.toString());

          if (msg.type === 'x402_handshake') {
            await this.handleHandshake(ws, sessionId, msg);
          }

        } catch (error) {
          console.error('[Provider] Message error:', error);
          ws.send(JSON.stringify({
            type: 'error',
            message: error instanceof Error ? error.message : 'Unknown error'
          }));
        }
      });

      ws.on('close', () => {
        console.log(`[Provider] Connection closed: ${sessionId}`);
        const session = this.activeStreams.get(sessionId);
        if (session?.interval) {
          clearInterval(session.interval);
        }
        this.activeStreams.delete(sessionId);
      });

      ws.on('error', (error: Error) => {
        console.error(`[Provider] WebSocket error on ${sessionId}:`, error);
      });
    });
  }

  private async handleHandshake(
    ws: WebSocket,
    sessionId: string,
    msg: any
  ): Promise<void> {
    const { vaultPubkey, agentPubkey } = msg;

    const session: StreamSession = {
      sessionId,
      vaultPubkey,
      agentPubkey,
      ws,
      pricePerPacket: this.config.pricePerPacket,
      consumed: 0,
      packetsDelivered: 0
    };

    this.activeStreams.set(sessionId, session);

    ws.send(JSON.stringify({
      type: 'x402_ready',
      sessionId,
      pricePerPacket: this.config.pricePerPacket,
      providerPubkey: this.providerKeypair.publicKey.toBase58()
    }));

    console.log(`[Provider] Session ${sessionId} ready for agent ${agentPubkey}`);

    this.notifyFacilitatorNewSession(vaultPubkey, agentPubkey);

    this.startDataStream(session);
  }

  private notifyFacilitatorNewSession(vaultPubkey: string, agentPubkey: string): void {
    if (this.facilitatorWs && this.facilitatorWs.readyState === WebSocket.OPEN) {
      this.facilitatorWs.send(JSON.stringify({
        type: 'provider_session_start',
        vaultPubkey,
        agentPubkey,
        providerPubkey: this.providerKeypair.publicKey.toBase58(),
        pricePerPacket: this.config.pricePerPacket
      }));
    }
  }

  private startDataStream(session: StreamSession): void {
    const SETTLEMENT_THRESHOLD = 100000;
    const REPORT_INTERVAL = 10;
    const interval = setInterval(() => {
      if (!session.ws || session.ws.readyState !== WebSocket.OPEN) {
        clearInterval(interval);
        return;
      }

      const packet = this.dataGen.generatePacket();
      session.ws.send(JSON.stringify({
        type: 'data',
        packet,
        consumed: session.consumed,
        price: this.config.pricePerPacket,
        session: session.sessionId
      }));

      session.consumed += this.config.pricePerPacket;
      session.packetsDelivered++;

      if (session.packetsDelivered % REPORT_INTERVAL === 0) {
        this.reportUsageToFacilitator(session);
      }

      if (session.consumed >= SETTLEMENT_THRESHOLD && session.consumed % SETTLEMENT_THRESHOLD < this.config.pricePerPacket) {
        console.log(`[Provider] Threshold reached for session ${session.sessionId}`);
      }

      if (session.packetsDelivered % 100 === 0) {
        console.log(`[Provider] Session ${session.sessionId}: ${session.packetsDelivered} packets, ${session.consumed} lamports consumed`);
      }

    }, 100);

    session.interval = interval;
  }

  private reportUsageToFacilitator(session: StreamSession): void {
    if (this.facilitatorWs && this.facilitatorWs.readyState === WebSocket.OPEN) {
      this.facilitatorWs.send(JSON.stringify({
        type: 'usage_report',
        vaultPubkey: session.vaultPubkey,
        agentPubkey: session.agentPubkey,
        providerPubkey: this.providerKeypair.publicKey.toBase58(),
        amount: session.consumed,
        packetsDelivered: session.packetsDelivered,
        sessionId: session.sessionId
      }));

      console.log(`[Provider] Reported usage: ${session.packetsDelivered} packets, ${session.consumed} lamports`);
    } else {
      console.warn('[Provider] Cannot report usage - facilitator not connected');
    }
  }

  private handleSettlementConfirmed(msg: any): void {
    const session = Array.from(this.activeStreams.values()).find(
      s => s.vaultPubkey === msg.vaultPubkey && s.agentPubkey === msg.agentPubkey
    );

    if (session) {
      console.log(`[Provider] Settlement confirmed for session ${session.sessionId}: ${msg.amount} lamports`);
      session.consumed = 0;
    }
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private broadcastMetrics(): void {
    if (this.facilitatorWs && this.facilitatorWs.readyState === WebSocket.OPEN) {
      const totalPackets = Array.from(this.activeStreams.values())
        .reduce((sum, s) => sum + s.packetsDelivered, 0);

      this.facilitatorWs.send(JSON.stringify({
        type: "metrics",
        totalPackets,
        packetsPerSec: this.calculatePacketsPerSec(),
        activeSessions: this.activeStreams.size,
      }));
    }
  }

  private calculatePacketsPerSec(): number {
    return this.activeStreams.size * 10;
  }

  async start(): Promise<void> {
    await this.initialize();

    this.server = this.app.listen(this.config.port, () => {
      console.log(`[Provider] HTTP server listening on port ${this.config.port}`);
    });

    this.server.on('upgrade', (request: IncomingMessage, socket: Socket, head: Buffer) => {
      this.wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
        this.wss.emit('connection', ws, request);
      });
    });

    this.metricsInterval = setInterval(() => {
      this.broadcastMetrics();
    }, 1000);

    console.log(`[Provider] WebSocket server ready`);
    console.log(`[Provider] Price: ${this.config.pricePerPacket} lamports/packet`);
  }


  stop(): void {
    console.log('[Provider] Shutting down...');

    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }

    if (this.facilitatorWs) {
      this.facilitatorWs.close();
    }

    if (this.facilitatorWs) {
      this.facilitatorWs.close();
    }

    for (const [sessionId, session] of this.activeStreams.entries()) {
      if (session.interval) {
        clearInterval(session.interval);
      }
      session.ws.close();
    }

    this.activeStreams.clear();
    this.wss.close();

    if (this.server) {
      this.server.close();
    }
  }
}