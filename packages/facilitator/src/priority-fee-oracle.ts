import { connection } from "./utils/rpc-client";
import { logger } from "./utils/logger";

const DEFAULT_PRIORITY_FEE = 10000;

export class PriorityFeeOracle {
  private lastPriorityFee = DEFAULT_PRIORITY_FEE;

  constructor() {
    setInterval(() => this.fetchPriorityFee(), 5000);
  }

  public async fetchPriorityFee(): Promise<void> {
    try {
      const fees = await connection.getRecentPrioritizationFees();
      if (fees.length === 0) {
        this.lastPriorityFee = DEFAULT_PRIORITY_FEE;
        return;
      }

      fees.sort((a, b) => a.prioritizationFee - b.prioritizationFee);
      const percentileIndex = Math.floor(fees.length * 0.75);
      const effectiveFee = fees[percentileIndex].prioritizationFee;

      this.lastPriorityFee = effectiveFee > 0 ? effectiveFee : DEFAULT_PRIORITY_FEE;
      logger.info({ fee: this.lastPriorityFee }, "Updated priority fee");
    } catch (error) {
      logger.error(error, "Failed to fetch priority fee");
      this.lastPriorityFee = DEFAULT_PRIORITY_FEE; // Fallback to default
    }
  }
  public getLatestPriorityFee(): number {
    return this.lastPriorityFee;
  }
}
