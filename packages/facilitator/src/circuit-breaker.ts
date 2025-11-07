import { logger } from "./utils/logger";

type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

/**
 * A production-grade CircuitBreaker.
 * - CLOSED: All operations are allowed.
 * - OPEN: All operations are blocked.
 * - HALF_OPEN: A single "test" operation is allowed to see if the system has recovered.
 */
export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime: number | null = null;
  private failureThreshold: number;
  private recoveryTimeout: number;
  private successThreshold: number;

  constructor(
    failureThreshold = 5,
    recoveryTimeout = 30000,
    successThreshold = 3
  ) {
    this.failureThreshold = failureThreshold;
    this.recoveryTimeout = recoveryTimeout;
    this.successThreshold = successThreshold;
    logger.info("CircuitBreaker initialized");
  }

  /**
   * Check if the circuit breaker allows an operation.
   */
  public canAttempt(): boolean {
    if (this.state === "OPEN") {
      const now = Date.now();
      if (
        this.lastFailureTime &&
        now - this.lastFailureTime > this.recoveryTimeout
      ) {
        this.state = "HALF_OPEN";
        this.successCount = 0;
        logger.warn("CircuitBreaker state moving to HALF_OPEN");
        return true;
      }
      return false;
    }
    return true;
  }

  /**
   * Report a successful operation.
   */
  public onSuccess(): void {
    if (this.state === "HALF_OPEN") {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        this.state = "CLOSED";
        this.failureCount = 0;
        logger.info("CircuitBreaker state moved to CLOSED (system recovered)");
      }
    } else {
      this.failureCount = 0;
    }
  }

  /**
   * Report a failed operation.
   */
  public onFailure(): void {
    this.failureCount++;

    if (this.state === "HALF_OPEN") {
      this.state = "OPEN";
      this.lastFailureTime = Date.now();
      logger.error(
        `CircuitBreaker test failed. State moving back to OPEN for ${this.recoveryTimeout}ms`
      );
    } else if (
      this.state === "CLOSED" &&
      this.failureCount >= this.failureThreshold
    ) {
      this.state = "OPEN";
      this.lastFailureTime = Date.now();
      logger.error(
        { failureCount: this.failureCount },
        `CircuitBreaker TRIPPED. State moving to OPEN for ${this.recoveryTimeout}ms`
      );
    }
  }

  public getState(): CircuitState {
    return this.state;
  }
}