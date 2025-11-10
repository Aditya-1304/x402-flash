import express, { Express } from 'express';
import cors from 'cors';
import { X402Middleware } from './middleware';

export class X402HttpServer {
  private app: Express;
  private x402: X402Middleware;

  constructor(
    private port: number,
    pricePerRequest: number,
    destinationAccount: string,
    merchantId: string
  ) {
    this.app = express();
    this.x402 = new X402Middleware(
      pricePerRequest,
      destinationAccount,
      merchantId
    );

    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json());

    // Logging middleware
    this.app.use((req, res, next) => {
      console.log(`[x402-HTTP] ${req.method} ${req.path}`);
      next();
    });
  }

  private setupRoutes() {
    // Health check (no payment required)
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        protocol: 'x402-flash',
        version: '1.0.0',
        endpoints: {
          aiInference: '/api/ai-inference',
          marketData: '/api/market-data',
          sensorData: '/api/sensor-data',
        },
      });
    });

    // x402-protected endpoints
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

    // Catch-all for undefined routes
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
    const payment = (req as any).x402Payment;

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
    const payment = (req as any).x402Payment;

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
    const payment = (req as any).x402Payment;

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
    const payment = (req as any).x402Payment;
    const { prompt } = req.body;

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
      console.log('');
      console.log('📋 Endpoints:');
      console.log(`  GET  /health                (no payment)`);
      console.log(`  GET  /api/ai-inference      (${process.env.PRICE_PER_PACKET} lamports)`);
      console.log(`  POST /api/ai-inference      (${process.env.PRICE_PER_PACKET} lamports)`);
      console.log(`  GET  /api/market-data       (${process.env.PRICE_PER_PACKET} lamports)`);
      console.log(`  GET  /api/sensor-data       (${process.env.PRICE_PER_PACKET} lamports)`);
      console.log('');
      console.log('💡 Test with:');
      console.log(`  curl http://localhost:${this.port}/health`);
      console.log(`  curl http://localhost:${this.port}/api/market-data`);
      console.log('');
    });
  }
}