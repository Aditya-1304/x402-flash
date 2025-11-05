import { connection } from "./rpc-client";
import { logger } from "./logger";

export interface HealthStatus {
  status: "healthy" | "degraded" | "unhealthy";
  checks: {
    rpc: boolean;
    uptime: number;
    memory: {
      used: number;
      total: number;
      percentage: number;
    };
  };
  timestamp: number;
}

export async function getHealthStatus(): Promise<HealthStatus> {
  const checks = {
    rpc: await checkRpcHealth(),
    uptime: process.uptime(),
    memory: getMemoryUsage(),
  };

  let status: "healthy" | "degraded" | "unhealthy" = "healthy";

  if (!checks.rpc) {
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