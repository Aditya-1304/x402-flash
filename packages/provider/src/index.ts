import { StreamingServer } from './streaming-server';
import dotenv from 'dotenv';

dotenv.config();

const config = {
  port: parseInt(process.env.PROVIDER_PORT || '3001'),
  pricePerPacket: parseInt(process.env.PRICE_PER_PACKET || '1000'),
  rpcUrl: process.env.RPC_URL || 'https://api.devnet.solana.com',
  providerKeypair: process.env.PROVIDER_KEYPAIR_PATH || './provider-keypair.json',
  facilitatorUrl: process.env.FACILITATOR_URL || 'ws://localhost:8080',
  destinationTokenAccount: process.env.DESTINATION_TOKEN_ACCOUNT!
};

const server = new StreamingServer(config);

(async () => {
  try {
    await server.start();

    console.log('='.repeat(60));
    console.log('x402-Flash Provider Service');
    console.log('='.repeat(60));
    console.log(`HTTP:       http://localhost:${config.port}`);
    console.log(`WebSocket:  ws://localhost:${config.port}`);
    console.log(`Price:      ${config.pricePerPacket} lamports/packet`);
    console.log('='.repeat(60));
  } catch (error) {
    console.error('Failed to start provider:', error);
    process.exit(1);
  }
})();

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  server.stop();
  process.exit(0);
});