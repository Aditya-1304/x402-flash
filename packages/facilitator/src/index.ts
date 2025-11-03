import config from "config";
import { logger } from "./utils/logger";
import { PriorityFeeOracle } from "./priority-fee-oracle";
import { SettlementEngine } from "./settlement-engine";
import { SessionManager } from "./session-manager";
import { startServer } from "./server";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { FlowVault } from "./idl/flow_vault";
import idl from "../../../anchor/target/idl/flow_vault.json"; // Make sure this path is correct
import { Keypair } from "@solana/web3.js";
import { connection } from "./utils/rpc-client";
import { CircuitBreaker } from "./circuit-breaker";

async function main() {
  logger.info("Starting x402-Flash Facilitator...");

  const port = config.get<number>("port");

  // A dummy wallet is sufficient for read-only program instance
  const dummyWallet = new Wallet(Keypair.generate());
  const provider = new AnchorProvider(connection, dummyWallet, {});
  const program = new Program<FlowVault>(idl as any, provider);

  // 1. Initialize all production-grade components
  const priorityFeeOracle = await PriorityFeeOracle.create();
  const circuitBreaker = new CircuitBreaker();
  const settlementEngine = new SettlementEngine(
    priorityFeeOracle,
    circuitBreaker // Pass the breaker in
  );
  const sessionManager = new SessionManager(settlementEngine, program);

  // 2. Start the server
  startServer(port, sessionManager); // Renamed

  logger.info("Facilitator is running.");
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});