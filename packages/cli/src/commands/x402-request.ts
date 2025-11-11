import { Keypair } from '@solana/web3.js';
import axios from 'axios';
import * as nacl from 'tweetnacl';
import bs58 from 'bs58';
import * as fs from 'fs';

interface X402RequestOptions {
  endpoint: string;
  wallet: string;
  vault: string;
  method?: 'GET' | 'POST';
  data?: any;
}

export async function x402Request(options: X402RequestOptions) {
  console.log('🌐 Making x402 HTTP Request\n');

  const walletData = JSON.parse(fs.readFileSync(options.wallet, 'utf-8'));
  const keypair = Keypair.fromSecretKey(new Uint8Array(walletData));

  console.log(`Wallet:   ${keypair.publicKey.toBase58()}`);
  console.log(`Vault:    ${options.vault}`);
  console.log(`Endpoint: ${options.endpoint}\n`);

  try {
    const initialResponse = await axios.get(options.endpoint, {
      validateStatus: () => true,
    });

    if (initialResponse.status === 402) {
      console.log('💰 Payment Required (HTTP 402)');
      console.log('x402 Headers:');
      console.log(`  Price:    ${initialResponse.headers['x402-price']} lamports`);
      console.log(`  Accept:   ${initialResponse.headers['x402-accept']}`);
      console.log(`  Address:  ${initialResponse.headers['x402-address']}`);
      console.log(`  Protocol: ${initialResponse.headers['x402-protocol']}\n`);

      const price = parseInt(initialResponse.headers['x402-price'] || '1000');
      const nonce = Date.now();

      const message = Buffer.from(`${options.vault}:${price}:${nonce}`);
      const signature = nacl.sign.detached(message, keypair.secretKey);

      const paymentProof = {
        vault: options.vault,
        amount: price,
        nonce: nonce,
        signature: bs58.encode(signature),
        publicKey: bs58.encode(keypair.publicKey.toBytes()),
      };

      console.log('✓ Payment proof generated');
      console.log(`  Amount:    ${price} lamports`);
      console.log(`  Nonce:     ${nonce}`);
      console.log(`  Signature: ${paymentProof.signature.slice(0, 20)}...\n`);

      console.log('Sending request with payment proof...\n');

      const paidResponse = await axios({
        method: options.method || 'GET',
        url: options.endpoint,
        headers: {
          'x402-payment': JSON.stringify(paymentProof),
          'Content-Type': 'application/json',
        },
        data: options.data,
      });

      console.log('✅ Request Successful!\n');
      console.log('Response:');
      console.log(JSON.stringify(paidResponse.data, null, 2));

    } else {
      console.log('✅ Request Successful (no payment required)!\n');
      console.log('Response:');
      console.log(JSON.stringify(initialResponse.data, null, 2));
    }

  } catch (error: any) {
    console.error('❌ Request failed:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    }
  }
}