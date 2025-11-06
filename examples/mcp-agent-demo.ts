import * as dotenv from "dotenv";
import chalk from "chalk";
import { spawn } from "child_process";
import path from "path";

dotenv.config();

async function main() {
  console.log(chalk.bold.magenta("\n🤖 MCP Agent Demo - AI-Powered x402 Payments\n"));

  console.log(chalk.blue("Starting MCP server..."));

  const mcpServerPath = path.resolve(
    __dirname,
    "../packages/facilitator/dist/mcp/server.js"
  );

  const mcpServer = spawn("node", [mcpServerPath], {
    stdio: ["pipe", "pipe", "inherit"],
    env: {
      ...process.env,
      SOLANA_RPC_URL: process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
      FACILITATOR_URL: process.env.FACILITATOR_URL || "ws://localhost:8080",
    },
  });

  console.log(chalk.green("✅ MCP server started\n"));

  console.log(chalk.yellow("📋 Available MCP tools:"));
  console.log(chalk.dim("   - x402_stream_data"));
  console.log(chalk.dim("   - x402_create_vault"));
  console.log(chalk.dim("   - x402_check_balance\n"));

  console.log(chalk.cyan("💡 Configure Claude Desktop:"));
  console.log(chalk.dim(`
{
  "mcpServers": {
    "x402-flash": {
      "command": "node",
      "args": ["${mcpServerPath}"]
    }
  }
}
  `));

  console.log(chalk.bold.green("\n🎯 Next steps:"));
  console.log(chalk.dim("1. Add MCP config to Claude Desktop"));
  console.log(chalk.dim("2. Restart Claude"));
  console.log(chalk.dim("3. Ask Claude to use x402_stream_data\n"));

  // Keep server running
  mcpServer.on("exit", (code) => {
    console.log(chalk.red(`\nMCP server exited with code ${code}`));
  });

  // Handle Ctrl+C
  process.on("SIGINT", () => {
    console.log(chalk.yellow("\n\nShutting down MCP server..."));
    mcpServer.kill();
    process.exit(0);
  });
}

main().catch(console.error);