import { Connection, ConnectionConfig } from "@solana/web3.js";
import config from "config";
import { logger } from "./logger";

const rpcUrl = config.get<string>("rpcUrl");

const connectionConfig: ConnectionConfig = {
  commitment: "confirmed",
  confirmTransactionInitialTimeout: 60000,
  disableRetryOnRateLimit: false,
  httpHeaders: {
    "Content-Type": "application/json",
  },
};

export const connection = new Connection(rpcUrl, connectionConfig);

const sanitizedUrl = rpcUrl.replace(/api-key=[^&]+/, 'api-key=[REDACTED]');

connection
  .getSlot()
  .then((slot) => {
    logger.info({ rpcUrl: sanitizedUrl, slot }, "RPC connection established");
  })
  .catch((error) => {
    logger.error({ error, rpcUrl: sanitizedUrl }, "Failed to connect to RPC");
    process.exit(1);
  });