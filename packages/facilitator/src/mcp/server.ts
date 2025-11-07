import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { FlashClient } from "@x402/sdk";
import { logger } from "../utils/logger";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import BN from "bn.js";
dotenv.config();

const server = new Server(
  {
    name: "x402-flash-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

let flashClient: FlashClient | null = null;

/**
 * Initialize the Flash client with agent credentials
 */
async function initializeClient(): Promise<void> {
  const rpcUrl = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");

  const keypairPath = path.join(
    os.homedir(),
    ".config",
    "x402-flash",
    "agent-keypair.json"
  );

  let agentKeypair: Keypair;

  if (fs.existsSync(keypairPath)) {
    const keypairData = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
    agentKeypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
    logger.info("Loaded existing agent keypair");
  } else {
    agentKeypair = Keypair.generate();
    fs.mkdirSync(path.dirname(keypairPath), { recursive: true });
    fs.writeFileSync(
      keypairPath,
      JSON.stringify(Array.from(agentKeypair.secretKey))
    );
    logger.info("Generated new agent keypair");
  }

  const autonomousSigner = {
    publicKey: agentKeypair.publicKey,
    signMessage: async (message: Uint8Array): Promise<Uint8Array> => {
      const nacl = await import("tweetnacl");
      return nacl.sign.detached(message, agentKeypair.secretKey);
    },
    signTransaction: async (tx: any): Promise<any> => {
      tx.sign(agentKeypair);
      return tx;
    },
    signAllTransactions: async (txs: any[]): Promise<any[]> => {
      txs.forEach((tx) => tx.sign(agentKeypair));
      return txs;
    },
  };

  flashClient = new FlashClient(connection, autonomousSigner, {
    facilitatorUrl: process.env.FACILITATOR_URL || "ws://localhost:8080",
  });

  logger.info(
    { publicKey: agentKeypair.publicKey.toBase58() },
    "Flash client initialized"
  );
}

/**
 * List available MCP tools
 */
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "x402_stream_data",
      description:
        "Stream data from a protected API using x402 micropayments. Returns real-time data chunks.",
      inputSchema: {
        type: "object",
        properties: {
          provider: {
            type: "string",
            description: "Base58-encoded provider public key",
          },
          apiUrl: {
            type: "string",
            description: "URL of the protected API endpoint",
          },
          duration: {
            type: "number",
            description: "Duration in seconds (optional)",
            default: 60,
          },
        },
        required: ["provider", "apiUrl"],
      },
    },
    {
      name: "x402_create_vault",
      description:
        "Create a new payment vault for the agent with specified deposit amount",
      inputSchema: {
        type: "object",
        properties: {
          depositAmount: {
            type: "number",
            description: "Amount to deposit in lamports",
          },
          tokenMint: {
            type: "string",
            description: "Token mint address (defaults to USDC devnet)",
          },
        },
        required: ["depositAmount"],
      },
    },
    {
      name: "x402_check_balance",
      description: "Check remaining balance in agent's vault",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
  ],
}));

/**
 * Handle tool execution
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (!flashClient) {
    throw new Error("Flash client not initialized");
  }

  const { name, arguments: args } = request.params;

  switch (name) {
    case "x402_stream_data": {
      const { provider, apiUrl, duration = 60 } = args as {
        provider: string;
        apiUrl: string;
        duration?: number;
      };

      flashClient.connect(
        new PublicKey(provider),
        process.env.VISA_TAP_JWT || "dummy-jwt"
      );

      const response = await flashClient.x402Fetch(apiUrl);
      const data = await response.json();

      return {
        content: [
          {
            type: "text",
            text: `✅ Streaming started from ${provider}\n\nData: ${JSON.stringify(data, null, 2)}\n\nDuration: ${duration}s`,
          },
        ],
      };
    }

    case "x402_create_vault": {
      const { depositAmount, tokenMint } = args as {
        depositAmount: number;
        tokenMint?: string;
      };

      const mint = tokenMint
        ? new PublicKey(tokenMint)
        : new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

      const txSig = await flashClient.createVault(
        new BN(depositAmount),
        mint
      );

      return {
        content: [
          {
            type: "text",
            text: `✅ Vault created!\n\nTransaction: ${txSig}\nDeposit: ${depositAmount} lamports`,
          },
        ],
      };
    }

    case "x402_check_balance": {
      return {
        content: [
          {
            type: "text",
            text: "Balance check not yet implemented. Check Solana Explorer.",
          },
        ],
      };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

/**
 * Start the MCP server
 */
async function main() {
  await initializeClient();

  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info("x402-Flash MCP Server running on stdio");
}

main().catch((error) => {
  logger.error(error, "Fatal error in MCP server");
  process.exit(1);
});