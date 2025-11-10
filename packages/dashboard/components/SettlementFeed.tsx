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
    <div className="space-y-3">
      {settlements.length === 0 ? (
        <div className="bg-slate-800/50 backdrop-blur rounded-lg p-6 text-center">
          <p className="text-slate-400 text-sm">
            Settlements will appear here as they confirm
          </p>
        </div>
      ) : (
        settlements.map((settlement, idx) => (
          <div
            key={settlement.txId}
            className="bg-slate-800/50 backdrop-blur rounded-lg p-4 border border-slate-700 hover:border-green-500 transition-all animate-in slide-in-from-right"
            style={{ animationDelay: `${idx * 100}ms` }}
          >
            <div className="flex items-start justify-between mb-2">
              <div className="flex-1">
                <div className="text-xs text-slate-400 mb-1">
                  {formatTime(settlement.timestamp)}
                </div>
                <div className="text-sm font-mono text-slate-300 truncate">
                  {settlement.txId.slice(0, 8)}...{settlement.txId.slice(-8)}
                </div>
              </div>
              <a
                href={`https://explorer.solana.com/tx/${settlement.txId}?cluster=devnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-2 p-2 hover:bg-slate-700 rounded transition-colors"
              >
                <ExternalLink className="w-4 h-4 text-blue-400" />
              </a>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-green-400">
                {formatAmount(settlement.amount)}
              </span>
              <span className="text-sm text-slate-500">SOL</span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}