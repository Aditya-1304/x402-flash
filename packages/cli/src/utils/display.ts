import chalk from 'chalk';
import Table from 'cli-table3';

export function displaySuccess(message: string) {
  console.log(chalk.green('✓ ') + message);
}

export function displayError(message: string) {
  console.log(chalk.red('✗ ') + message);
}

export function displayInfo(message: string) {
  console.log(chalk.blue('ℹ ') + message);
}

export function displayVaultCreated(data: {
  vaultPubkey: string;
  agentPubkey: string;
  deposit: string;
  tokenMint: string;
  signature: string;
}) {
  console.log('\n' + chalk.bold('Vault Created Successfully!') + '\n');

  const table = new Table({
    head: [chalk.cyan('Property'), chalk.cyan('Value')],
    colWidths: [20, 70]
  });

  table.push(
    ['Vault Address', chalk.yellow(data.vaultPubkey)],
    ['Agent Pubkey', data.agentPubkey],
    ['Deposit', `${data.deposit} lamports`],
    ['Token Mint', data.tokenMint],
    ['Transaction', chalk.green(data.signature)]
  );

  console.log(table.toString());
  console.log(chalk.dim(`\nView on Solana Explorer:`));
  console.log(chalk.blue(`https://explorer.solana.com/tx/${data.signature}?cluster=devnet\n`));
}

export function displayStreamMetrics(data: {
  packetsReceived: number;
  totalCost: number;
  packetsPerSec: string;
  dataType: string;
}) {
  console.log(chalk.dim(`[${new Date().toISOString()}]`),
    `Packets: ${chalk.yellow(data.packetsReceived)} | `,
    `Cost: ${chalk.green(data.totalCost)} lamports | `,
    `Rate: ${chalk.cyan(data.packetsPerSec)} pkt/s | `,
    `Type: ${data.dataType}`
  );
}