import { logger } from "./logger";

interface RateLimitEntry {
  count: number;
  firstRequest: number;
}

export class RateLimiter {
  private requests = new Map<string, RateLimitEntry>();
  private maxRequests: number;
  private windowMs: number;

  constructor(maxRequests = 10, windowMs = 60000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;

    setInterval(() => this.cleanup(), 60000);
  }

  public isAllowed(identifier: string): boolean {
    const now = Date.now();
    const entry = this.requests.get(identifier);

    if (!entry) {
      this.requests.set(identifier, { count: 1, firstRequest: now });
      return true;
    }

    const timePassed = now - entry.firstRequest;

    if (timePassed > this.windowMs) {
      this.requests.set(identifier, { count: 1, firstRequest: now });
      return true;
    }

    if (entry.count >= this.maxRequests) {
      logger.warn(
        { identifier, count: entry.count },
        "Rate limit exceeded"
      );
      return false;
    }

    entry.count++;
    return true;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.requests.entries()) {
      if (now - entry.firstRequest > this.windowMs) {
        this.requests.delete(key);
      }
    }
  }
}