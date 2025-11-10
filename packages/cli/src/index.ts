#!/usr/bin/env node
import { Command } from 'commander';
import { createVaultCommand } from './commands/create-vault';
import { streamCommand } from './commands/stream';
import { statsCommand } from './commands/stats';
import { withdrawCommand } from './commands/withdraw';
import { x402Request } from './commands/x402-request';
import dotenv from 'dotenv';

dotenv.config();

const program = new Command();

program
  .name('x402-flash')
  .description('x402-Flash CLI - Autonomous Agent Payments on Solana')
  .version('1.0.0');

program
  .command('create-vault')
  .description('Create a new x402 vault')
  .requiredOption('-a, --amount <number>', 'Initial deposit amount in lamports')
  .option('-w, --wallet <path>', 'Path to wallet keypair', process.env.WALLET_PATH)
  .option('--cdp', 'Use Coinbase Developer Platform wallet', false)
  .option('--mint <address>', 'Custom token mint address')
  .option('--use-sol', 'Use native SOL instead of USDC/CASH', false)
  .action(createVaultCommand);

program
  .command('stream')
  .description('Start streaming data from provider (with autonomous payments)')
  .requiredOption('-v, --vault <address>', 'Vault public key')
  .requiredOption('-p, --provider <url>', 'Provider WebSocket URL')
  .option('-w, --wallet <path>', 'Path to agent wallet keypair')
  .option('--cdp', 'Use Coinbase CDP embedded wallet')
  .option('--auto-settle', 'Enable automatic settlement signing', true)
  .action(streamCommand);

program
  .command('stats')
  .description('Show vault and session statistics')
  .requiredOption('-v, --vault <address>', 'Vault public key')
  .option('-f, --facilitator <url>', 'Facilitator URL for live stats')
  .action(statsCommand);

program
  .command('withdraw')
  .description('Withdraw remaining funds from vault')
  .requiredOption('-v, --vault <address>', 'Vault public key')
  .option('-w, --wallet <path>', 'Path to agent wallet keypair')
  .action(withdrawCommand);

program
  .command('x402')
  .description('Make an x402 HTTP request with payment proof')
  .requiredOption('-e, --endpoint <url>', 'API endpoint URL')
  .requiredOption('-w, --wallet <path>', 'Path to wallet keypair')
  .requiredOption('-v, --vault <address>', 'Vault address')
  .option('-m, --method <method>', 'HTTP method (GET/POST)', 'GET')
  .option('-d, --data <json>', 'Request body (for POST)')
  .action((options) => {
    x402Request({
      endpoint: options.endpoint,
      wallet: options.wallet,
      vault: options.vault,
      method: options.method,
      data: options.data ? JSON.parse(options.data) : undefined,
    });
  });

program.parse();