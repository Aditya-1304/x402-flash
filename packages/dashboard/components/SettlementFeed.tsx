"use client";

import { ExternalLink } from "lucide-react";

interface Settlement {
  txId: string;
  amount: string;
  timestamp: number;
}

export default function SettlementFeed({
  settlements,
}: {
  settlements: Settlement[];
}) {
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
  };

  const formatAmount = (lamports: string) => {
    return (parseInt(lamports) / 1_000_000_000).toFixed(4);
  };

  return (
    <div className="bg-slate-800/50 backdrop-blur rounded-lg p-4 border border-slate-700">
      {/* ✅ Header with count */}
      <div className="mb-4">
        <div className="text-3xl font-bold text-green-400" suppressHydrationWarning>
          {settlements.length}
        </div>
        <p className="text-sm text-slate-400">On-Chain Settlements</p>
      </div>

      {/* Scrollable list with max height */}
      <div className="space-y-3 max-h-80 overflow-y-auto pr-2">
        {settlements.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-slate-400 text-sm">
              Settlements will appear here as they confirm
            </p>
          </div>
        ) : (
          settlements.map((settlement, idx) => (
            <div
              key={`${settlement.txId}-${idx}`}
              className="bg-slate-900/50 rounded-lg p-3 border border-slate-700 hover:border-green-500/50 transition-all"
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-slate-500 mb-1" suppressHydrationWarning>
                    {formatTime(settlement.timestamp)}
                  </div>
                  <div className="text-xs font-mono text-slate-400 truncate">
                    {settlement.txId.slice(0, 8)}...{settlement.txId.slice(-8)}
                  </div>
                </div>
                <a
                  href={`https://explorer.solana.com/tx/${settlement.txId}?cluster=devnet`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 p-1.5 hover:bg-slate-700/50 rounded transition-colors flex-shrink-0"
                  title="View on Solana Explorer"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-blue-400" />
                </a>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-lg font-bold text-green-400" suppressHydrationWarning>
                  {formatAmount(settlement.amount)}
                </span>
                <span className="text-xs text-slate-500">SOL</span>
              </div>
            </div>
          ))
        )}
      </div>

      {settlements.length > 0 && (
        <div className="mt-4 pt-4 border-t border-slate-700">
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-400">Total Settled</span>
            <span className="text-green-400 font-mono font-bold" suppressHydrationWarning>
              {(settlements
                .reduce((sum, s) => sum + parseInt(s.amount), 0) / 1_000_000_000)
                .toLocaleString(undefined, { 
                  minimumFractionDigits: 4,
                  maximumFractionDigits: 4 
                })} SOL
            </span>
          </div>
        </div>
      )}
    </div>
  );
}