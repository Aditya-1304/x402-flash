import express, { Express } from 'express';
import cors from 'cors';
import { X402Middleware } from './middleware';
import WebSocket from 'ws';

export class X402HttpServer {
  private app: Express;
  private x402: X402Middleware;
  private facilitatorWs: WebSocket | null = null;
  private httpRequestCount = 0;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;

  constructor(
    private port: number,
    pricePerRequest: number,
    destinationAccount: string,
    merchantId: string,
    private facilitatorUrl?: string
  ) {
    this.app = express();
    this.x402 = new X402Middleware(
      pricePerRequest,
      destinationAccount,
      merchantId
    );

    this.setupMiddleware();
    this.setupRoutes();

    if (facilitatorUrl) {
      setTimeout(() => this.connectToFacilitator(), 2000);
    }
  }

  private connectToFacilitator() {
    if (!this.facilitatorUrl) return;

    try {
      const wsUrl = `${this.facilitatorUrl}?type=provider&provider=http-server`;
      console.log(`[x402-HTTP] Connecting to: ${wsUrl}`);

      this.facilitatorWs = new WebSocket(wsUrl);

      this.facilitatorWs.on('open', () => {
        console.log('✅ [x402-HTTP] Connected to facilitator as provider');
        this.reconnectAttempts = 0;
      });

      this.facilitatorWs.on('error', (err) => {
        console.error('[x402-HTTP] Facilitator connection error:', err.message);
      });

      this.facilitatorWs.on('close', () => {
        console.log('[x402-HTTP] Disconnected from facilitator');

        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          const delay = Math.min(5000 * this.reconnectAttempts, 30000);
          console.log(`[x402-HTTP] Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
          setTimeout(() => this.connectToFacilitator(), delay);
        }
      });
    } catch (err: unknown) {
      const error = err as Error;
      console.error('[x402-HTTP] Failed to connect to facilitator:', error.message);

      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        setTimeout(() => this.connectToFacilitator(), 5000);
      }
    }
  }

  private notifyFacilitator(endpoint: string, payment: { vault: string; amount: number; nonce: number }) {
    this.httpRequestCount++;

    if (this.facilitatorWs?.readyState === WebSocket.OPEN) {
      const message = {
        type: 'x402_http_request',
        endpoint,
        payment, // Contains vault, amount, nonce
        timestamp: Date.now(),
      };

      console.log('[x402-HTTP] 📤 Notifying facilitator:', {
        endpoint,
        vault: payment.vault.substring(0, 8) + '...',
        amount: payment.amount,
      });

      this.facilitatorWs.send(JSON.stringify(message));
    } else {
      const state = this.facilitatorWs?.readyState;
      const stateStr = state === WebSocket.CONNECTING ? 'CONNECTING' :
        state === WebSocket.CLOSING ? 'CLOSING' :
          state === WebSocket.CLOSED ? 'CLOSED' : 'UNKNOWN';
      console.log(`[x402-HTTP] ⚠️ Cannot send to facilitator (state: ${stateStr})`);
    }
  }

  private setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json());

    this.app.use((req, res, next) => {
      console.log(`[x402-HTTP] ${req.method} ${req.path}`);
      next();
    });
  }

  private setupRoutes() {
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        protocol: 'x402-flash',
        version: '1.0.0',
        totalRequests: this.httpRequestCount,
        facilitatorConnected: this.facilitatorWs?.readyState === WebSocket.OPEN,
        endpoints: {
          aiInference: '/api/ai-inference',
          marketData: '/api/market-data',
          sensorData: '/api/sensor-data',
        },
      });
    });

    this.app.get(
      '/api/ai-inference',
      this.x402.requirePayment,
      this.handleAiInference
    );

    this.app.get(
      '/api/market-data',
      this.x402.requirePayment,
      this.handleMarketData
    );

    this.app.get(
      '/api/sensor-data',
      this.x402.requirePayment,
      this.handleSensorData
    );

    this.app.post(
      '/api/ai-inference',
      this.x402.requirePayment,
      this.handleAiInferencePost
    );

    this.app.use((req, res) => {
      res.status(404).json({
        error: 'Not Found',
        availableEndpoints: [
          '/health',
          '/api/ai-inference',
          '/api/market-data',
          '/api/sensor-data',
        ],
      });
    });
  }

  private handleAiInference = (req: express.Request, res: express.Response) => {
    const payment = (req as { x402Payment?: { vault: string; amount: number; nonce: number } }).x402Payment;
    if (!payment) return res.status(500).json({ error: 'Payment info missing' });

    this.notifyFacilitator('/api/ai-inference', payment);

    res.json({
      type: 'ai-inference',
      result: {
        model: 'gpt-4',
        tokens: 150,
        response: 'Sample AI inference result for demonstration',
        confidence: 0.95,
      },
      payment: {
        vault: payment.vault,
        amount: payment.amount,
        nonce: payment.nonce,
      },
      timestamp: new Date().toISOString(),
    });
  };

  private handleMarketData = (req: express.Request, res: express.Response) => {
    const payment = (req as { x402Payment?: { vault: string; amount: number; nonce: number } }).x402Payment;
    if (!payment) return res.status(500).json({ error: 'Payment info missing' });

    this.notifyFacilitator('/api/market-data', payment);

    res.json({
      type: 'market-data',
      data: {
        symbol: 'SOL/USD',
        price: 23.45 + Math.random() * 2,
        volume: 1234567,
        change24h: 2.5,
      },
      payment: {
        vault: payment.vault,
        amount: payment.amount,
        nonce: payment.nonce,
      },
      timestamp: new Date().toISOString(),
    });
  };

  private handleSensorData = (req: express.Request, res: express.Response) => {
    const payment = (req as { x402Payment?: { vault: string; amount: number; nonce: number } }).x402Payment;
    if (!payment) return res.status(500).json({ error: 'Payment info missing' });

    this.notifyFacilitator('/api/sensor-data', payment);

    res.json({
      type: 'sensor-reading',
      data: {
        temperature: 22.5 + Math.random() * 5,
        humidity: 45 + Math.random() * 10,
        pressure: 1013 + Math.random() * 5,
      },
      payment: {
        vault: payment.vault,
        amount: payment.amount,
        nonce: payment.nonce,
      },
      timestamp: new Date().toISOString(),
    });
  };

  private handleAiInferencePost = (req: express.Request, res: express.Response) => {
    const payment = (req as { x402Payment?: { vault: string; amount: number; nonce: number } }).x402Payment;
    if (!payment) return res.status(500).json({ error: 'Payment info missing' });

    const { prompt } = req.body;
    this.notifyFacilitator('/api/ai-inference (POST)', payment);


    res.json({
      type: 'ai-inference',
      prompt: prompt || 'No prompt provided',
      result: {
        model: 'gpt-4',
        tokens: 250,
        response: `Processed: ${prompt || 'default query'}`,
        confidence: 0.98,
      },
      payment: {
        vault: payment.vault,
        amount: payment.amount,
        nonce: payment.nonce,
      },
      timestamp: new Date().toISOString(),
    });
  };

  start() {
    this.app.listen(this.port, () => {
      console.log('');
      console.log('🌐 x402 HTTP Server Started');
      console.log('============================');
      console.log(`Port:              ${this.port}`);
      console.log(`Protocol:          x402-flash (HTTP 402 compatible)`);
      console.log(`Facilitator:       ${this.facilitatorUrl || 'Not configured'}`);
      console.log('');
      console.log('📋 Endpoints:');
      console.log(`  GET  /health                (no payment)`);
      console.log(`  GET  /api/ai-inference      (${process.env.PRICE_PER_PACKET} lamports)`);
      console.log(`  POST /api/ai-inference      (${process.env.PRICE_PER_PACKET} lamports)`);
      console.log(`  GET  /api/market-data       (${process.env.PRICE_PER_PACKET} lamports)`);
      console.log(`  GET  /api/sensor-data       (${process.env.PRICE_PER_PACKET} lamports)`);
      console.log('');
      console.log('💡 HTTP requests will trigger settlement when threshold reached');
      console.log('');
    });
  }
}