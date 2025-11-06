import { connection } from "./rpc-client";
import { logger } from "./logger";
import Redis from "ioredis";
import config from "config";

export interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  checks: {
    rpc: boolean;
    redis: boolean;
    uptime: number;
    memory: {
      used: number;
      total: number;
      percentage: number;
    };
  };
  timestamp: number;
}

let redisClient: Redis | null = null;

function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(config.get<string>("redis.url"));
  }
  return redisClient;
}

export async function getHealthStatus(): Promise<HealthStatus> {
  const checks = {
    rpc: await checkRpcHealth(),
    redis: await checkRedisHealth(),
    uptime: process.uptime(),
    memory: getMemoryUsage(),
  };

  let status: "healthy" | "degraded" | "unhealthy" = "healthy";

  if (!checks.rpc || !checks.redis) {
    status = "unhealthy";
  } else if (checks.memory.percentage > 90) {
    status = "degraded";
  }

  return {
    status,
    checks,
    timestamp: Date.now(),
  };
}

async function checkRpcHealth(): Promise<boolean> {
  try {
    const slot = await connection.getSlot();
    return slot > 0;
  } catch (error) {
    logger.error(error, "RPC health check failed");
    return false;
  }
}

async function checkRedisHealth(): Promise<boolean> {
  try {
    const redis = getRedisClient();
    const pong = await redis.ping();
    return pong === "PONG";
  } catch (error) {
    logger.error(error, "Redis health check failed");
    return false;
  }
}

function getMemoryUsage() {
  const usage = process.memoryUsage();
  const total = usage.heapTotal;
  const used = usage.heapUsed;
  return {
    used,
    total,
    percentage: (used / total) * 100,
  };
}