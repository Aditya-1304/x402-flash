import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { findProviderPda } from '../../../sdk/dist/utils/vault-pda';
import { FlashClient } from '../../../sdk/dist/FlashClient';
// import { constructSettlementMessage } from '../../../sdk/dist/utils/signature';
import { displaySuccess, displayError, displayInfo, displayStreamMetrics } from '../utils/display';
import WebSocket from 'ws';
import ora from 'ora';
import fs from 'fs';
import jwt from 'jsonwebtoken';
import BN from 'bn.js';

function constructSettlementMessage(
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

export async function streamCommand(options: any) {
  console.log('\n' + '='.repeat(60));
  console.log('x402-Flash Autonomous Streaming Agent');
  console.log('='.repeat(60) + '\n');

  try {
    const connection = new Connection(
      process.env.RPC_URL || 'https://api.devnet.solana.com',
      'confirmed'
    );

    let agentKeypair: Keypair;

    if (options.cdp) {
      displayInfo('[BOUNTY: Coinbase CDP] Using autonomous embedded wallet');

      try {
        const { Coinbase, Wallet } = await import('@coinbase/coinbase-sdk');

        Coinbase.configureFromJson({
          filePath: process.env.CDP_API_KEY_PATH || '~/.coinbase/cdp_api_key.json'
        });

        const walletId = process.env.CDP_WALLET_ID;
        if (!walletId) {
          throw new Error('CDP_WALLET_ID not found. Create a vault first with --cdp');
        }

        const cdpWallet = await Wallet.fetch(walletId);
        const walletData: any = await cdpWallet.export();

        let secretKeyBytes: Uint8Array;

        if (walletData.seed) {
          secretKeyBytes = Buffer.from(String(walletData.seed), 'hex').slice(0, 32);
        } else if (walletData.data?.seed) {
          secretKeyBytes = Buffer.from(String(walletData.data.seed), 'hex').slice(0, 32);
        } else if (walletData.keys && Array.isArray(walletData.keys) && walletData.keys.length > 0) {
          const privateKey = String(walletData.keys[0].privateKey || walletData.keys[0].seed);
          secretKeyBytes = Buffer.from(privateKey, 'hex').slice(0, 32);
        } else {
          throw new Error('Unable to extract private key from CDP wallet');
        }

        agentKeypair = Keypair.fromSeed(secretKeyBytes);

      } catch (error: any) {
        displayError(`CDP Error: ${error.message}`);
        process.exit(1);
      }

    } else if (options.wallet) {
      const keypairData = JSON.parse(fs.readFileSync(options.wallet, 'utf-8'));
      agentKeypair = Keypair.fromSecretKey(new Uint8Array(keypairData));
    } else {
      throw new Error('Must specify --wallet or --cdp');
    }

    const signer = {
      keypair: agentKeypair,
      publicKey: agentKeypair.publicKey,
      signMessage: async (message: Uint8Array) => {
        const nacl = await import('tweetnacl');
        return nacl.sign.detached(message, agentKeypair.secretKey);
      },
      signTransaction: async (tx: any) => {
        tx.sign(agentKeypair);
        return tx;
      },
      signAllTransactions: async (txs: any[]) => {
        txs.forEach(tx => tx.sign(agentKeypair));
        return txs;
      }
    };

    const client = new FlashClient(connection, signer, {
      facilitatorUrl: process.env.FACILITATOR_URL || 'ws://localhost:8080'
    });

    const visaTapJwt = jwt.sign(
      {
        agentPubkey: agentKeypair.publicKey.toBase58(),
        merchantId: process.env.VISA_MERCHANT_ID || 'demo-merchant',
        iat: Math.floor(Date.now() / 1000)
      },
      process.env.VISA_TAP_JWT_SECRET || 'demo-secret',
      { expiresIn: '1h' }
    );

    displayInfo('[BOUNTY: Visa TAP] JWT credential generated');

    const facilitatorSpinner = ora('Connecting to facilitator...').start();
    const providerPubkey = process.env.PROVIDER_PUBKEY || 'PROVIDER_PUBLIC_KEY_HERE';

    client.connect(new PublicKey(providerPubkey), visaTapJwt);
    facilitatorSpinner.succeed('Connected to facilitator');

    if (options.autoSettle) {
      displayInfo('[Auto-Settlement] Enabled - Agent will sign settlements autonomously');

      const waitForWs = setInterval(() => {
        if (client.ws && client.ws.readyState === WebSocket.OPEN) {
          clearInterval(waitForWs);

          console.log('[Auto-Settlement] Listening for settlement requests...');

          client.ws.on('message', async (data: Buffer) => {
            try {
              const message = JSON.parse(data.toString());


              if (message.type === 'request_signature') {
                console.log('\n⚡ Settlement Request Received');
                console.log(`   Amount: ${message.amount} lamports`);
                console.log(`   Nonce:  ${message.nonce}`);

                if (options.cdp) {
                  displayInfo('[BOUNTY: Coinbase CDP] Signing settlement autonomously');
                }

                const spinner = ora('Signing settlement...').start();

                try {
                  const vaultPda = new PublicKey(message.vaultPda);
                  const providerAuthority = new PublicKey(message.providerAuthority);

                  const [providerPda] = findProviderPda(providerAuthority);

                  const amount = new BN(message.amount);
                  const nonce = new BN(message.nonce);


                  const settlementMessage = constructSettlementMessage(
                    vaultPda,
                    providerPda,
                    amount,
                    nonce
                  );

                  const nacl = await import('tweetnacl');
                  const signature = nacl.sign.detached(settlementMessage, agentKeypair.secretKey);

                  client.ws!.send(JSON.stringify({
                    type: 'settlement_signature',
                    amount: message.amount,
                    nonce: message.nonce,
                    signature: Buffer.from(signature).toString('base64')
                  }));

                  spinner.succeed('Settlement signed and sent');
                } catch (error: any) {
                  spinner.fail('Settlement signing failed');
                  displayError(error.message);
                }
              }

              if (message.type === 'settlement_confirmed') {
                displaySuccess(`💰 Settlement confirmed: ${message.txId}`);
                console.log(`   Amount settled: ${parseInt(message.amount) / 1_000_000_000} SOL`);
                displayInfo('[BOUNTY: Switchboard] Dynamic priority fee applied');
              }

              if (message.type === 'settlement_failed') {
                displayError(`❌ Settlement failed: ${message.message}`);
              }

            } catch (error: any) {
              console.error('Error handling message:', error.message);
            }
          });
        }
      }, 100);
    }

    const providerSpinner = ora(`Connecting to provider ${options.provider}...`).start();
    const ws = new WebSocket(options.provider);

    let packetsReceived = 0;
    let totalCost = 0;
    const startTime = Date.now();

    ws.on('open', () => {
      providerSpinner.succeed('Connected to provider');
      ws.send(JSON.stringify({
        type: 'x402_handshake',
        vaultPubkey: options.vault,
        agentPubkey: agentKeypair.publicKey.toBase58()
      }));
    });

    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());

      if (msg.type === 'x402_ready') {
        displaySuccess(`Stream ready! Price: ${msg.pricePerPacket} lamports/packet`);
        console.log('');
      }

      if (msg.type === 'data') {
        packetsReceived++;
        totalCost += msg.price;

        if (packetsReceived % 10 === 0) {
          const elapsed = (Date.now() - startTime) / 1000;
          displayStreamMetrics({
            packetsReceived,
            totalCost,
            packetsPerSec: (packetsReceived / elapsed).toFixed(2),
            dataType: msg.packet.type
          });
        }
      }

      if (msg.type === 'x402_credit_required') {
        console.log('\n⚠️  Credit required - waiting for settlement...');
        console.log(`   Consumed: ${msg.consumed} lamports`);
        console.log(`   Credit:   ${msg.credit} lamports`);
        console.log(`   Deficit:  ${msg.deficit} lamports\n`);
      }
    });

    ws.on('error', (error) => {
      displayError(`WebSocket error: ${error.message}`);
    });

    ws.on('close', () => {
      console.log('\n📊 Final Statistics:');
      console.log(`   Packets received: ${packetsReceived}`);
      console.log(`   Total cost:       ${totalCost} lamports`);
      console.log(`   Duration:         ${((Date.now() - startTime) / 1000).toFixed(2)}s`);
      console.log(`   Avg rate:         ${(packetsReceived / ((Date.now() - startTime) / 1000)).toFixed(2)} pkt/s`);
      process.exit(0);
    });

    process.on('SIGINT', () => {
      console.log('\n\nShutting down gracefully...');
      ws.close();
      client.disconnect();
    });

  } catch (error: any) {
    displayError(error.message);
    process.exit(1);
  }
}