import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { FlashClient } from '../../../sdk/dist/FlashClient';
import { getAssociatedTokenAddress } from '@solana/spl-token';
import { displaySuccess, displayError } from '../utils/display';
import fs from 'fs';
import ora from 'ora';
import chalk from 'chalk';

export async function withdrawCommand(options: any) {
  const spinner = ora('Initializing withdrawal...').start();

  try {
    const connection = new Connection(
      process.env.RPC_URL || 'https://api.devnet.solana.com',
      'confirmed'
    );

    // Load wallet
    if (!options.wallet) {
      spinner.fail('Wallet required');
      displayError('Must specify --wallet <path>');
      process.exit(1);
    }

    const keypairData = JSON.parse(fs.readFileSync(options.wallet, 'utf-8'));
    const agentKeypair = Keypair.fromSecretKey(new Uint8Array(keypairData));

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

    let tokenMint: PublicKey;
    if (options.mint) {
      tokenMint = new PublicKey(options.mint);
    } else if (process.env.USE_CASH === 'true') {
      tokenMint = new PublicKey(process.env.CASH_MINT_DEVNET!);
    } else {
      tokenMint = new PublicKey(process.env.USDC_MINT_DEVNET!);
    }

    spinner.text = 'Finding token account...';
    const agentTokenAccount = await getAssociatedTokenAddress(
      tokenMint,
      agentKeypair.publicKey
    );

    spinner.text = 'Fetching vault balance...';

    spinner.text = 'Executing withdrawal transaction...';
    const signature = await client.withdraw(agentTokenAccount);

    spinner.succeed('Withdrawal successful!');

    console.log('\n' + chalk.bold('Withdrawal Complete') + '\n');
    console.log(`${chalk.cyan('Agent:')}         ${agentKeypair.publicKey.toBase58()}`);
    console.log(`${chalk.cyan('Token Account:')} ${agentTokenAccount.toBase58()}`);
    console.log(`${chalk.cyan('Transaction:')}   ${chalk.green(signature)}`);
    console.log(chalk.dim(`\nView on Explorer:`));
    console.log(chalk.blue(`https://explorer.solana.com/tx/${signature}?cluster=devnet\n`));

    displaySuccess('Funds withdrawn to agent wallet');

  } catch (error: any) {
    spinner.fail('Withdrawal failed');
    displayError(error.message);

    if (error.message.includes('Account does not exist')) {
      console.log(chalk.yellow('\n💡 Tip: Make sure you created a vault first with:'));
      console.log(chalk.dim('   x402-flash create-vault --amount <amount> --wallet <path>\n'));
    }

    process.exit(1);
  }
}