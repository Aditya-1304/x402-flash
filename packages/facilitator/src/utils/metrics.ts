import client from "prom-client";

const register = new client.Registry();

client.collectDefaultMetrics({ register });

export const activeConnections = new client.Gauge({
  name: "x402_active_connections",
  help: "Number of active WebSocket connections",
  registers: [register],
});

export const settlementsTotal = new client.Counter({
  name: "x402_settlements_total",
  help: "Total number of settlement attempts",
  labelNames: ["status"],
  registers: [register],
});

export const settlementAmount = new client.Histogram({
  name: "x402_settlement_amount_lamports",
  help: "Distribution of settlement amounts in lamports",
  buckets: [100000, 500000, 1000000, 5000000, 10000000],
  registers: [register],
});

export const priorityFee = new client.Gauge({
  name: "x402_priority_fee_lamports",
  help: "Current priority fee in lamports",
  registers: [register],
});

export const circuitBreakerState = new client.Gauge({
  name: "x402_circuit_breaker_state",
  help: "Circuit breaker state (0=CLOSED, 1=HALF_OPEN, 2=OPEN)",
  registers: [register],
});

export function getMetricsRegistry() {
  return register;
}