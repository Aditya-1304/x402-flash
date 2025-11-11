"use client";

import { Activity, Zap, Users, CheckCircle, Globe } from "lucide-react";

interface LiveMetricsProps {
  totalPackets: number;
  packetsPerSec: number;
  activeSessions: number;
  totalSettlements: number;
  httpRequests: number;
}

export default function LiveMetrics({
  totalPackets,
  packetsPerSec,
  activeSessions,
  totalSettlements,
  httpRequests,
}: LiveMetricsProps) {
  const metrics = [
    {
      label: "Total Packets",
      value: totalPackets.toLocaleString(),
      icon: Activity,
      color: "from-blue-500 to-cyan-500",
    },
    {
      label: "Packets/Sec",
      value: packetsPerSec.toFixed(1),
      icon: Zap,
      color: "from-yellow-500 to-orange-500",
    },
    {
      label: "Active Sessions",
      value: activeSessions,
      icon: Users,
      color: "from-green-500 to-emerald-500",
    },
    {
      label: "Settlements",
      value: totalSettlements,
      icon: CheckCircle,
      color: "from-purple-500 to-pink-500",
    },
    {
      label: "HTTP Requests",
      value: httpRequests,
      icon: Globe,
      color: "from-cyan-500 to-blue-500",
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
      {metrics.map((metric) => {
        const Icon = metric.icon;
        return (
          <div
            key={metric.label}
            className="bg-slate-800/50 backdrop-blur rounded-lg p-6 border border-slate-700 hover:border-slate-600 transition-colors"
          >
            <div className="flex items-center justify-between mb-2">
              <p className="text-slate-400 text-sm font-medium">
                {metric.label}
              </p>
              <div
                className={`p-2 rounded-lg bg-gradient-to-br ${metric.color}`}
              >
                <Icon className="w-4 h-4 text-white" />
              </div>
            </div>
            {/* Suppress hydration warning for client-side values */}
            <p className="text-3xl font-bold text-white" suppressHydrationWarning>
              {metric.value}
            </p>
          </div>
        );
      })}
    </div>
  );
}