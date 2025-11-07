import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { FlashClient } from '../../../sdk/dist/FlashClient';
import { displaySuccess, displayError, displayInfo, displayVaultCreated } from '../utils/display';
import fs from 'fs';
import ora from 'ora';
import BN from 'bn.js';

export async function createVaultCommand(options: any) {
  const spinner = ora('Initializing...').start();

  try {
    const connection = new Connection(
      process.env.RPC_URL || 'https://api.devnet.solana.com',
      'confirmed'
    );

    let agentKeypair: Keypair;

    if (options.cdp) {
      spinner.text = '[BOUNTY: Coinbase CDP] Creating embedded wallet...';

      try {
        const { Coinbase, Wallet } = await import('@coinbase/coinbase-sdk');

        Coinbase.configureFromJson({
          filePath: process.env.CDP_API_KEY_PATH || '~/.coinbase/cdp_api_key.json'
        });

        let cdpWallet: any;
        const walletId = process.env.CDP_WALLET_ID;

        if (walletId) {
          cdpWallet = await Wallet.fetch(walletId);
          spinner.text = 'Loaded existing CDP wallet';
        } else {
          cdpWallet = await Wallet.create({ networkId: 'solana-devnet' });
          console.log(`\n💡 Save this wallet ID: ${cdpWallet.getId()}`);
          console.log('   Add to .env: CDP_WALLET_ID=' + cdpWallet.getId() + '\n');
        }

        const walletData: any = await cdpWallet.export();
        let secretKeyBytes: Uint8Array;

        if (walletData.seed) {
          const seed = String(walletData.seed);
          secretKeyBytes = Buffer.from(seed, 'hex').slice(0, 32);
        }
        else if (walletData.data && walletData.data.seed) {
          const seed = String(walletData.data.seed);
          secretKeyBytes = Buffer.from(seed, 'hex').slice(0, 32);
        }
        else if (walletData.keys && Array.isArray(walletData.keys) && walletData.keys.length > 0) {
          const keyData = walletData.keys[0];
          const privateKey = String(keyData.privateKey || keyData.seed);
          secretKeyBytes = Buffer.from(privateKey, 'hex').slice(0, 32);
        }
        else if (cdpWallet.getDefaultAddress) {
          const address = await cdpWallet.getDefaultAddress();
          if (address.privateKey) {
            secretKeyBytes = Buffer.from(String(address.privateKey), 'hex').slice(0, 32);
          } else {
            throw new Error('Unable to extract private key from CDP wallet address');
          }
        }
        else {
          throw new Error('Unable to extract private key from CDP wallet. Wallet data structure not recognized.');
        }

        agentKeypair = Keypair.fromSeed(secretKeyBytes);
        displaySuccess('Coinbase CDP wallet ready');

      } catch (error: any) {
        spinner.fail('CDP wallet setup failed');
        displayError(`CDP Error: ${error.message}`);
        console.log('\nTroubleshooting:');
        console.log('1. Make sure @coinbase/coinbase-sdk is installed');
        console.log('2. Configure CDP API key: ~/.coinbase/cdp_api_key.json');
        console.log('3. Or use --wallet flag with a standard Solana keypair\n');
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

    spinner.text = 'Initializing Flash SDK...';
    const client = new FlashClient(connection, signer, {
      facilitatorUrl: process.env.FACILITATOR_URL || 'ws://localhost:8080'
    });

    let tokenMint: PublicKey;

    if (options.useSol) {
      tokenMint = new PublicKey('So11111111111111111111111111111111111111112');
      spinner.text = 'Creating SOL vault...';
      displayInfo('Using native SOL for vault deposit');
    } else if (options.mint) {
      tokenMint = new PublicKey(options.mint);
      spinner.text = 'Creating vault with custom token...';
    } else if (process.env.USE_CASH === 'true') {
      displayInfo('[BOUNTY: Phantom CASH] Using $CASH token');
      tokenMint = new PublicKey(process.env.CASH_MINT_DEVNET!);
      spinner.text = 'Creating CASH vault...';
    } else {
      tokenMint = new PublicKey(process.env.USDC_MINT_DEVNET!);
      spinner.text = 'Creating USDC vault...';
    }

    spinner.text = 'Creating FlowVault on-chain...';
    const vaultTx = await client.createVault(
      new BN(options.amount),
      tokenMint
    );

    spinner.succeed('Vault created successfully!');

    displayVaultCreated({
      vaultPubkey: vaultTx,
      agentPubkey: agentKeypair.publicKey.toBase58(),
      deposit: options.amount,
      tokenMint: tokenMint.toBase58(),
      signature: vaultTx
    });

  } catch (error: any) {
    spinner.fail('Failed to create vault');
    displayError(error.message);
    process.exit(1);
  }
}