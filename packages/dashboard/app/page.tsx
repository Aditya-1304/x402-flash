"use client";

import { useEffect, useState, useRef } from "react";
import LiveMetrics from "@/components/LiveMetrics";
import SettlementFeed from "@/components/SettlementFeed";
import SessionCard from "@/components/SessionCard";
import { initWebSocket } from "@/lib/websocket";
import { saveMetrics, loadMetrics, clearMetrics } from "@/lib/metrics-store";

interface Session {
  sessionId: string;
  agentPubkey: string;
  consumed: number;
  packetsDelivered: number;
}

interface Settlement {
  txId: string;
  amount: string;
  timestamp: number;
}

export default function Dashboard() {
  const hasMounted = useRef(false);
  const [isClient, setIsClient] = useState(false);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>(() => {
    if (typeof window === 'undefined') return [];
    const stored = loadMetrics();
    return stored.settlements;
  });
  const [totalPackets, setTotalPackets] = useState<number>(() => {
    if (typeof window === 'undefined') return 0;
    const stored = loadMetrics();
    return stored.totalPackets;
  });
  const [packetsPerSec, setPacketsPerSec] = useState(0);
  const [peakPacketsPerSec, setPeakPacketsPerSec] = useState<number>(() => {
    if (typeof window === 'undefined') return 0;
    const stored = loadMetrics();
    return stored.peakPacketsPerSec;
  });
  const [connectionStatus, setConnectionStatus] = useState<
    "connecting" | "connected" | "disconnected"
  >("connecting");

  useEffect(() => {
    if (!hasMounted.current) {
      hasMounted.current = true;
      setIsClient(true);
    }

    if (!hasMounted.current) return;

    let ws: WebSocket | null = null;
    let reconnectTimeout: NodeJS.Timeout;
    let metricsInterval: NodeJS.Timeout;
    let lastPacketCount = 0;
    let lastUpdateTime = Date.now();

    const connect = () => {
      try {
        setConnectionStatus("connecting");
        ws = initWebSocket();

        ws.onopen = () => {
          console.log("✓ Dashboard connected to facilitator");
          setConnectionStatus("connected");
          ws!.send(JSON.stringify({ type: "request_metrics" }));
        };

        ws.onmessage = (event) => {
          const data = JSON.parse(event.data);

          if (data.type === "session_update" || data.type === "metrics") {
            if (data.sessions && Array.isArray(data.sessions)) {
              setSessions(data.sessions);

              const total = data.sessions.reduce(
                (sum: number, s: Session) => sum + (s.packetsDelivered || 0),
                0
              );
              
              setTotalPackets(total);

              const now = Date.now();
              const timeDelta = (now - lastUpdateTime) / 1000;

              if (timeDelta > 0 && total !== lastPacketCount) {
                const packetDelta = total - lastPacketCount;
                const pps = packetDelta / timeDelta;
                const currentPPS = Math.max(0, pps);
                
                setPacketsPerSec(currentPPS);

                setPeakPacketsPerSec(prev => {
                  const newPeak = Math.max(prev, currentPPS);
                  saveMetrics({ peakPacketsPerSec: newPeak });
                  return newPeak;
                });

                lastPacketCount = total;
                lastUpdateTime = now;
                
                saveMetrics({ 
                  totalPackets: total,
                  lastUpdate: now 
                });
              }
            }
          }

          if (data.type === "settlement_confirmed") {
            console.log("💰 Settlement confirmed:", data);
            
            const newSettlement = {
              txId: data.txId,
              amount: data.amount,
              timestamp: Date.now(),
            };
            
            setSettlements((prev) => {
              const updated = [newSettlement, ...prev.slice(0, 19)];
              
              // Save to localStorage
              saveMetrics({ 
                settlements: updated,
                totalSettlements: updated.length 
              });
              
              return updated;
            });
          }
        };

        ws.onerror = (error) => {
          if (connectionStatus === "connected") {
            console.error("❌ WebSocket error:", error);
          }
          setConnectionStatus("disconnected");
        };

        ws.onclose = () => {
          console.log("WebSocket closed. Reconnecting in 5s...");
          setConnectionStatus("disconnected");
          reconnectTimeout = setTimeout(connect, 5000);
        };

        metricsInterval = setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "request_metrics" }));
          }
        }, 1000);
      } catch (error) {
        console.error("Failed to connect WebSocket:", error);
        setConnectionStatus("disconnected");
        reconnectTimeout = setTimeout(connect, 5000);
      }
    };

    connect();

    return () => {
      ws?.close();
      clearTimeout(reconnectTimeout);
      clearInterval(metricsInterval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClearData = () => {
    if (confirm("Clear all stored metrics and settlements?")) {
      clearMetrics();
      setTotalPackets(0);
      setSettlements([]);
      setPeakPacketsPerSec(0);
      setPacketsPerSec(0);
    }
  };

  if (!isClient) {
    return (
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-5xl font-bold text-white mb-2">
            x402-Flash
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-600">
              {" "}
              Live Dashboard
            </span>
          </h1>
          <p className="text-slate-300">
            Autonomous AI Agent Payments on Solana • Real-time Streaming
          </p>
        </div>

        {/* Loading Skeleton */}
        <div className="animate-pulse space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="h-32 bg-slate-800/30 rounded-lg"></div>
            <div className="h-32 bg-slate-800/30 rounded-lg"></div>
            <div className="h-32 bg-slate-800/30 rounded-lg"></div>
            <div className="h-32 bg-slate-800/30 rounded-lg"></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="h-24 bg-slate-800/30 rounded-lg"></div>
            <div className="h-24 bg-slate-800/30 rounded-lg"></div>
          </div>
          <div className="h-64 bg-slate-800/30 rounded-lg"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-5xl font-bold text-white mb-2">
              x402-Flash
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-600">
                {" "}
                Live Dashboard
              </span>
            </h1>
            <p className="text-slate-300">
              Autonomous AI Agent Payments on Solana • Real-time Streaming
            </p>
          </div>

          <div className="flex items-center gap-4">
            {/* Clear Data Button */}
            <button
              onClick={handleClearData}
              className="px-4 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg text-sm transition-colors"
            >
              Clear Data
            </button>
            
            {/* Connection Status */}
            <div className="flex items-center gap-2">
              <div
                className={`w-3 h-3 rounded-full ${
                  connectionStatus === "connected"
                    ? "bg-green-500 animate-pulse"
                    : connectionStatus === "connecting"
                    ? "bg-yellow-500 animate-pulse"
                    : "bg-red-500"
                }`}
              ></div>
              <span className="text-sm text-slate-400">
                {connectionStatus === "connected"
                  ? "Connected"
                  : connectionStatus === "connecting"
                  ? "Connecting..."
                  : "Disconnected"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Connection Warning */}
      {connectionStatus === "disconnected" && (
        <div className="mb-6 bg-red-900/20 border border-red-500 rounded-lg p-4">
          <p className="text-red-400 text-sm">
            ⚠️ Unable to connect to backend services. Make sure the facilitator
            and provider are running.
          </p>
        </div>
      )}

      {/* Metrics Grid */}
      <LiveMetrics
        totalPackets={totalPackets}
        packetsPerSec={packetsPerSec}
        activeSessions={sessions.length}
        totalSettlements={settlements.length}
      />

      {/* Peak Stats */}
      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-slate-800/30 rounded-lg p-4 border border-slate-700">
          <div className="text-slate-400 text-sm mb-1">Peak Throughput</div>
          <div className="text-2xl font-bold text-yellow-400">
            {peakPacketsPerSec.toFixed(2)} pkt/s
          </div>
        </div>
        <div className="bg-slate-800/30 rounded-lg p-4 border border-slate-700">
          <div className="text-slate-400 text-sm mb-1">Data Persisted</div>
          <div className="text-2xl font-bold text-green-400">
            ✓ Local Storage
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-8">
        {/* Active Sessions */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <span
              className={`w-3 h-3 rounded-full ${
                sessions.length > 0
                  ? "bg-green-500 animate-pulse"
                  : "bg-slate-600"
              }`}
            ></span>
            Active Streaming Sessions
          </h2>
          {sessions.length === 0 ? (
            <div className="bg-slate-800/50 backdrop-blur rounded-lg p-8 text-center">
              <p className="text-slate-400 mb-4">
                No active sessions. Start a stream with the CLI:
              </p>
              <code className="text-sm bg-slate-900 px-4 py-2 rounded text-purple-400 inline-block">
                npm run dev -- stream --vault YOUR_VAULT --wallet
                ./test-wallet.json --auto-settle
              </code>
            </div>
          ) : (
            sessions.map((session) => (
              <SessionCard key={session.sessionId} session={session} />
            ))
          )}
        </div>

        {/* Settlement Feed */}
        <div>
          <h2 className="text-2xl font-bold text-white mb-4">
            Recent Settlements
          </h2>
          <SettlementFeed settlements={settlements} />
        </div>
      </div>

      {/* Footer */}
      <div className="mt-12 text-center text-slate-400 text-sm">
        <p>
          Built for Solana x402 Hackathon • Powered by{" "}
          <span className="text-purple-400">Switchboard</span> •{" "}
          <span className="text-pink-400">Visa TAP</span> •{" "}
          <span className="text-blue-400">Coinbase CDP</span>
        </p>
      </div>
    </div>
  );
}