interface MetricsHistory {
  totalPackets: number;
  totalSettlements: number;
  peakPacketsPerSec: number;
  lastUpdate: number;
  settlements: Array<{
    txId: string;
    amount: string;
    timestamp: number;
  }>;
}

const STORAGE_KEY = 'x402-metrics';

export function saveMetrics(metrics: Partial<MetricsHistory>): void {
  if (typeof window === 'undefined') return;

  const existing = loadMetrics();
  const updated = { ...existing, ...metrics, lastUpdate: Date.now() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}

export function loadMetrics(): MetricsHistory {
  if (typeof window === 'undefined') {
    return {
      totalPackets: 0,
      totalSettlements: 0,
      peakPacketsPerSec: 0,
      lastUpdate: 0,
      settlements: [],
    };
  }

  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return getDefaultMetrics();

    const parsed = JSON.parse(data);

    // Reset if data is older than 1 hour
    if (Date.now() - parsed.lastUpdate > 3600000) {
      return getDefaultMetrics();
    }

    return parsed;
  } catch {
    return getDefaultMetrics();
  }
}

export function clearMetrics(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}

function getDefaultMetrics(): MetricsHistory {
  return {
    totalPackets: 0,
    totalSettlements: 0,
    peakPacketsPerSec: 0,
    lastUpdate: 0,
    settlements: [],
  };
}