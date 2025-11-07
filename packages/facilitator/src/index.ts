import * as dotenv from "dotenv";
dotenv.config();

import config from "config";
import { logger } from "./utils/logger";
import { PriorityFeeOracle } from "./priority-fee-oracle";
import { SettlementEngine } from "./settlement-engine";
import { SessionManager } from "./session-manager";
import { startServer } from "./server";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { FlowVault } from "./idl/flow_vault";
import idl from "../../../anchor/target/idl/flow_vault.json";
import { Keypair } from "@solana/web3.js";
import { connection } from "./utils/rpc-client";
import { CircuitBreaker } from "./circuit-breaker";
import { shutdownManager } from "./utils/shutdown";

async function main() {
  logger.info("Starting x402-Flash Facilitator...");

  const port = config.get<number>("port");
  const dummyWallet = new Wallet(Keypair.generate());
  const provider = new AnchorProvider(connection, dummyWallet, {});
  const program = new Program<FlowVault>(idl as any, provider);

  const priorityFeeOracle = await PriorityFeeOracle.create();
  const circuitBreaker = new CircuitBreaker();
  const settlementEngine = new SettlementEngine(
    priorityFeeOracle,
    circuitBreaker
  );
  const sessionManager = new SessionManager(settlementEngine, program);

  shutdownManager.register(async () => {
    logger.info("Shutting down session manager...");
    await sessionManager.cleanup();
  });

  startServer(port, sessionManager);

  logger.info("Facilitator is running.");
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});