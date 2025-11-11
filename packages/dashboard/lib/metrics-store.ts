export interface Settlement {
  txId: string;
  amount: string;
  timestamp: number;
}

export interface StoredMetrics {
  totalPackets: number;
  peakPacketsPerSec: number;
  settlements: Settlement[];
  totalSettlements: number;
  httpRequests: number;
  lastUpdate: number;
}

const STORAGE_KEY = 'x402-flash-metrics';

export function saveMetrics(metrics: Partial<StoredMetrics>) {
  if (typeof window === 'undefined') return;

  const existing = loadMetrics();
  const updated = { ...existing, ...metrics, lastUpdate: Date.now() };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}

export function loadMetrics(): StoredMetrics {
  if (typeof window === 'undefined') {
    return {
      totalPackets: 0,
      peakPacketsPerSec: 0,
      settlements: [],
      totalSettlements: 0,
      httpRequests: 0,
      lastUpdate: Date.now(),
    };
  }

  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    return {
      totalPackets: 0,
      peakPacketsPerSec: 0,
      settlements: [],
      totalSettlements: 0,
      httpRequests: 0,
      lastUpdate: Date.now(),
    };
  }

  return JSON.parse(stored) as StoredMetrics;
}

export function clearMetrics() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}