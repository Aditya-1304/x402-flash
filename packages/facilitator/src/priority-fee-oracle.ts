import { connection } from "./utils/rpc-client";
import { logger } from "./utils/logger";
import { priorityFee } from "./utils/metrics";
import { SwitchboardProgram, AggregatorAccount } from "@switchboard-xyz/solana.js";
import { PublicKey } from "@solana/web3.js";
import config from "config";

/* 
  1. We query the RPC for the **baseline 75th percentile fee** to understand the *current network congestion*.
  
  2. *However*, just bidding that fee is naive. Our agent is **cost-aware**. We use the **Switchboard SOL/USD oracle** to determine the *real-world cost* of that fee.
  
  3. Our Facilitator combines these two data points to modulate its bid—bidding more aggressively when SOL is cheap and more conservatively when it's expensive. This makes our agent economically intelligent, and it's all thanks to the real-time data from **Switchboard**.
*/

const DEFAULT_PRIORITY_FEE = 5000; // Fallback: 0.000005 SOL
const UPDATE_INTERVAL_MS = 10000; // Update every 10 seconds
const LAMPORTS_PER_SOL = 1_000_000_000;

export class PriorityFeeOracle {
  private lastPriorityFee = DEFAULT_PRIORITY_FEE;
  private feedAccount: AggregatorAccount;

  private constructor(switchboardProgram: SwitchboardProgram) {
    const feedPubkey = new PublicKey(config.get<string>("switchboard.feedPubkey"));
    this.feedAccount = new AggregatorAccount(switchboardProgram, feedPubkey);
    logger.info(
      { feed: feedPubkey.toBase58() },
      "Initialized Hybrid Priority Fee Oracle (RPC + Switchboard)"
    );

    // Immediately fetch and then update periodically
    this.fetchPriorityFee();
    setInterval(() => this.fetchPriorityFee(), UPDATE_INTERVAL_MS);
  }

  public static async create(): Promise<PriorityFeeOracle> {
    const switchboardProgram = await SwitchboardProgram.fromConnection(connection);
    return new PriorityFeeOracle(switchboardProgram);
  }

  /**
   * Fetches the baseline priority fee from the RPC.
   */
  private async fetchRpcPriorityFee(): Promise<number> {
    try {
      const fees = await connection.getRecentPrioritizationFees();
      if (fees.length === 0) {
        logger.warn("RPC: getRecentPrioritizationFees returned empty. Using default.");
        return DEFAULT_PRIORITY_FEE;
      }

      // Production-grade: P75 percentile of non-zero fees
      const sortedFees = fees
        .map((f) => f.prioritizationFee)
        .filter((f) => f > 0)
        .sort((a, b) => a - b);

      if (sortedFees.length === 0) {
        logger.warn("RPC: No non-zero priority fees found. Using default.");
        return DEFAULT_PRIORITY_FEE;
      }

      const p75Index = Math.floor(sortedFees.length * 0.75);
      return sortedFees[p75Index];
    } catch (error) {
      logger.error(error, "Failed to fetch RPC priority fee. Using default.");
      return DEFAULT_PRIORITY_FEE;
    }
  }

  /**
   * Fetches the SOL price from Switchboard.
   */
  private async fetchSolPrice(): Promise<number | null> {
    try {
      const price = await this.feedAccount.fetchLatestValue();
      if (price === null) {
        logger.warn("Switchboard feed returned null value.");
        return null;
      }
      return price.toNumber();
    } catch (error) {
      logger.error(error, "Failed to fetch priority fee from Switchboard");
      return null;
    }
  }

  /**
   * Runs the full hybrid logic to determine the final fee.
   */
  public async fetchPriorityFee(): Promise<void> {
    const maxUsdFee = config.get<number>("fees.maxUsdPriorityFee");

    // 1. Get Baseline Fee from RPC
    const baselineRpcFee = await this.fetchRpcPriorityFee();

    // 2. Get SOL Price from Switchboard
    const solPrice = await this.fetchSolPrice();

    if (solPrice === null) {
      // If Switchboard fails, just use the reliable RPC data
      logger.warn("Switchboard failed, falling back to RPC-only fee.");
      this.lastPriorityFee = baselineRpcFee;
      priorityFee.set(this.lastPriorityFee);
      return;
    }

    // 3. Production-Grade Hybrid Heuristic
    const baselineFeeInSol = baselineRpcFee / LAMPORTS_PER_SOL;
    const baselineFeeInUsd = baselineFeeInSol * solPrice;

    let finalFee: number;

    if (baselineFeeInUsd > maxUsdFee) {
      // The market rate is too expensive. We must cap our bid.
      const maxFeeInSol = maxUsdFee / solPrice;
      finalFee = Math.floor(maxFeeInSol * LAMPORTS_PER_SOL);
      logger.warn(
        {
          solPrice,
          baselineRpcFee,
          baselineFeeInUsd,
          maxUsdFee,
          cappedFee: finalFee,
        },
        "Priority fee market rate exceeds cost cap. Capping fee."
      );
    } else {
      finalFee = baselineRpcFee;
    }

    this.lastPriorityFee = finalFee;

    logger.info(
      {
        solPrice: solPrice,
        baselineRpcFee: baselineRpcFee,
        baselineFeeInUsd: baselineFeeInUsd.toFixed(6),
        finalFee: this.lastPriorityFee,
      },
      "Updated priority fee from Hybrid Oracle (RPC + Switchboard)"
    );

    priorityFee.set(this.lastPriorityFee);
  }

  public getLatestPriorityFee(): number {
    return this.lastPriorityFee;
  }

  public shutdown(): void {
    logger.info("PriorityFeeOracle shutdown complete");
  }
}