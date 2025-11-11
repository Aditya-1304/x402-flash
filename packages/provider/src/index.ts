import { StreamingServer } from './streaming-server';
import { X402HttpServer } from './x402/http-server';
import dotenv from 'dotenv';

dotenv.config();

const config = {
  port: parseInt(process.env.PROVIDER_PORT || '3001'),
  httpPort: parseInt(process.env.HTTP_PORT || '3002'),
  pricePerPacket: parseInt(process.env.PRICE_PER_PACKET || '1000'),
  rpcUrl: process.env.RPC_URL || 'https://api.devnet.solana.com',
  providerKeypair: process.env.PROVIDER_KEYPAIR_PATH || './provider-keypair.json',
  facilitatorUrl: process.env.FACILITATOR_URL || 'ws://localhost:8080',
  destinationTokenAccount: process.env.DESTINATION_TOKEN_ACCOUNT!,
  visaMerchantId: process.env.VISA_MERCHANT_ID || 'demo-provider',
};

const streamingServer = new StreamingServer(config);

const httpServer = new X402HttpServer(
  config.httpPort,
  config.pricePerPacket,
  config.destinationTokenAccount,
  config.visaMerchantId,
  config.facilitatorUrl
);

(async () => {
  try {
    await streamingServer.start();
    httpServer.start();

    console.log('='.repeat(60));
    console.log('x402-Flash Provider Service');
    console.log('='.repeat(60));
    console.log(`WebSocket:  ws://localhost:${config.port}`);
    console.log(`HTTP x402:  http://localhost:${config.httpPort}`);
    console.log(`Price:      ${config.pricePerPacket} lamports/packet`);
    console.log('='.repeat(60));
  } catch (error) {
    console.error('Failed to start provider:', error);
    process.exit(1);
  }
})();

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  streamingServer.stop();
  process.exit(0);
});