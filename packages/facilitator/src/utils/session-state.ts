import Redis from "ioredis";
import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import { logger } from "./logger";
import config from "config";

interface PersistedSession {
  agent: string;
  providerAuthority: string;
  vaultPda: string;
  spentOffchain: string;
  lastUpdate: number;
}

export class SessionStore {
  private redis: Redis;

  constructor() {
    const redisUrl = config.get<string>("redis.url");
    this.redis = new Redis(redisUrl, {
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    this.redis.on("error", (err) => {
      logger.error(err, "Redis connection error");
    });

    this.redis.on("connect", () => {
      logger.info("Connected to Redis");
    });
  }

  public async saveSession(
    agentId: string,
    session: {
      agent: PublicKey;
      providerAuthority: PublicKey;
      vaultPda: PublicKey;
      spentOffchain: BN;
    }
  ): Promise<void> {
    const data: PersistedSession = {
      agent: session.agent.toBase58(),
      providerAuthority: session.providerAuthority.toBase58(),
      vaultPda: session.vaultPda.toBase58(),
      spentOffchain: session.spentOffchain.toString(),
      lastUpdate: Date.now(),
    };

    await this.redis.set(
      `session:${agentId}`,
      JSON.stringify(data),
      "EX",
      3600
    );

    logger.debug({ agentId }, "Session persisted to Redis");
  }

  public async loadSession(agentId: string): Promise<{
    agent: PublicKey;
    providerAuthority: PublicKey;
    vaultPda: PublicKey;
    spentOffchain: BN;
  } | null> {
    const data = await this.redis.get(`session:${agentId}`);
    if (!data) return null;

    const parsed: PersistedSession = JSON.parse(data);

    return {
      agent: new PublicKey(parsed.agent),
      providerAuthority: new PublicKey(parsed.providerAuthority),
      vaultPda: new PublicKey(parsed.vaultPda),
      spentOffchain: new BN(parsed.spentOffchain),
    };
  }

  public async deleteSession(agentId: string): Promise<void> {
    await this.redis.del(`session:${agentId}`);
    logger.debug({ agentId }, "Session deleted from Redis");
  }

  public async close(): Promise<void> {
    await this.redis.quit();
    logger.info("Redis connection closed");
  }
}