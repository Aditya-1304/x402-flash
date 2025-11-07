import { logger } from "./logger";

type ShutdownHandler = () => Promise<void> | void;

export class GracefulShutdown {
  private handlers: ShutdownHandler[] = [];
  private isShuttingDown = false;

  constructor() {
    process.on("SIGTERM", () => this.shutdown("SIGTERM"));
    process.on("SIGINT", () => this.shutdown("SIGINT"));
  }

  public register(handler: ShutdownHandler): void {
    this.handlers.push(handler);
  }

  private async shutdown(signal: string): Promise<void> {
    if (this.isShuttingDown) {
      logger.warn("Shutdown already in progress, ignoring signal");
      return;
    }

    this.isShuttingDown = true;
    logger.info({ signal }, "Received shutdown signal, cleaning up...");

    for (const handler of this.handlers) {
      try {
        await handler();
      } catch (error) {
        logger.error(error, "Error during shutdown handler");
      }
    }

    logger.info("Graceful shutdown complete");
    process.exit(0);
  }
}

export const shutdownManager = new GracefulShutdown();