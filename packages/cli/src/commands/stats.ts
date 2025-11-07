import { Connection, PublicKey } from '@solana/web3.js';
import { displayError, displayInfo } from '../utils/display';
import chalk from 'chalk';
import Table from 'cli-table3';
import ora from 'ora';

interface SessionData {
  count: number;
  sessions: Array<{
    sessionId: string;
    vaultPubkey: string;
    agentPubkey: string;
    consumed: number;
    credit: number;
    packetsDelivered: number;
  }>;
}

export async function statsCommand(options: any) {
  const spinner = ora('Fetching vault statistics...').start();

  try {
    const connection = new Connection(
      process.env.RPC_URL || 'https://api.devnet.solana.com',
      'confirmed'
    );

    const vaultPubkey = new PublicKey(options.vault);

    const accountInfo = await connection.getAccountInfo(vaultPubkey);

    if (!accountInfo) {
      spinner.fail('Vault not found');
      displayError('Vault account does not exist');
      process.exit(1);
    }

    spinner.succeed('Vault data fetched');
    const data = accountInfo.data;

    console.log('\n' + chalk.bold('Vault Statistics') + '\n');

    const table = new Table({
      head: [chalk.cyan('Property'), chalk.cyan('Value')],
      colWidths: [25, 55]
    });

    table.push(
      ['Vault Address', chalk.yellow(vaultPubkey.toBase58())],
      ['Owner (Program)', accountInfo.owner.toBase58()],
      ['Lamports', `${accountInfo.lamports.toLocaleString()} lamports`],
      ['Data Size', `${data.length} bytes`],
      ['Executable', accountInfo.executable ? 'Yes' : 'No'],
      ['Rent Epoch', accountInfo.rentEpoch?.toString() ?? 'N/A']
    );

    console.log(table.toString());

    if (options.facilitator) {
      spinner.start('Fetching live session data...');
      try {
        const response = await fetch(`${options.facilitator}/sessions`);
        const sessionData = await response.json() as SessionData;

        spinner.succeed('Live session data fetched');

        if (sessionData.count > 0) {
          console.log('\n' + chalk.bold('Active Sessions') + '\n');

          const sessionTable = new Table({
            head: [
              chalk.cyan('Session ID'),
              chalk.cyan('Agent'),
              chalk.cyan('Consumed'),
              chalk.cyan('Credit'),
              chalk.cyan('Packets')
            ],
            colWidths: [25, 25, 15, 15, 10]
          });

          sessionData.sessions.forEach((session) => {
            if (session.vaultPubkey === vaultPubkey.toBase58()) {
              sessionTable.push([
                session.sessionId.substring(0, 20) + '...',
                session.agentPubkey.substring(0, 20) + '...',
                `${session.consumed}`,
                `${session.credit}`,
                `${session.packetsDelivered}`
              ]);
            }
          });

          console.log(sessionTable.toString());
        } else {
          displayInfo('No active sessions');
        }
      } catch (error: any) {
        spinner.fail('Failed to fetch session data');
        displayError(error.message);
      }
    }

    console.log('');

  } catch (error: any) {
    spinner.fail('Failed to fetch stats');
    displayError(error.message);
    process.exit(1);
  }
}