"use client";

import { useEffect, useState } from "react";
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

interface HttpRequest {
  endpoint: string;
  timestamp: number;
  vault: string;
  settlement?: {
    txId: string;
    amount: string;
  };
}

interface WebSocketMessage {
  type: string;
  sessions?: Session[];
  txId?: string;
  amount?: string;
  vaultPda?: string;
  endpoint?: string;
  timestamp?: number;
  protocol?: string;
  payment?: {
    vault: string;
    amount: number;
    nonce: number;
  };
}
const processedRequests = new Set<string>();

export default function Dashboard() {
  // ✅ PROPER FIX: Use lazy initialization to load from localStorage ONCE
  // This function only runs once on mount, not on every render
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

  const [httpRequests, setHttpRequests] = useState<number>(() => {
    if (typeof window === 'undefined') return 0;
    const stored = loadMetrics();
    return stored.httpRequests || 0;
  });

  const [peakPacketsPerSec, setPeakPacketsPerSec] = useState<number>(() => {
    if (typeof window === 'undefined') return 0;
    const stored = loadMetrics();
    return stored.peakPacketsPerSec;
  });

  const [sessions, setSessions] = useState<Session[]>([]);
  const [recentHttpRequests, setRecentHttpRequests] = useState<HttpRequest[]>([]);
  const [packetsPerSec, setPacketsPerSec] = useState(0);
  const [connectionStatus, setConnectionStatus] = useState<
    "connecting" | "connected" | "disconnected"
  >("connecting");

  // WebSocket connection
  useEffect(() => {
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
          const data = JSON.parse(event.data) as WebSocketMessage;

          console.log('📨 Dashboard received message:', data.type, data);

          // Handle session updates
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

          // ✅ Handle x402 HTTP requests (dashboard display + usage tracking)
          if (data.type === "x402_http_request") {
            const requestKey = `${data.payment?.vault}-${data.payment?.nonce}-${data.timestamp}`;
        
        // ✅ Skip if we've already processed this exact request
        if (processedRequests.has(requestKey)) {
          console.log('⚠️ Duplicate request ignored:', requestKey);
          return;
        }
        
        // ✅ Mark as processed
        processedRequests.add(requestKey);
        
        // ✅ Clean up old entries (keep last 100)
        if (processedRequests.size > 100) {
          const firstKey = processedRequests.values().next().value;
          if (firstKey) {
            processedRequests.delete(firstKey);
          }
        }

        console.log('🌐 x402 HTTP request received!', data);
            
            // Increment HTTP request counter ONCE
            setHttpRequests(prev => {
              const newCount = prev + 1;
              console.log(`📊 HTTP Requests: ${prev} → ${newCount}`);
              saveMetrics({ httpRequests: newCount });
              return newCount;
            });

            // Add to recent requests feed
            if (data.endpoint && data.timestamp && data.payment?.vault) {
              setRecentHttpRequests(prev => {
                const newRequest = {
                  endpoint: data.endpoint!,
                  timestamp: data.timestamp!,
                  vault: data.payment!.vault,
                };
                return [newRequest, ...prev.slice(0, 9)];
              });
            }
          }

          // Handle settlement confirmations
          if (data.type === "settlement_confirmed") {
  console.log("💰 Settlement confirmed:", data);
  
  const newSettlement: Settlement = {
    txId: data.txId || 'unknown',
    amount: data.amount || '0',
    timestamp: Date.now(),
  };
  
  setSettlements((prev) => {
    const updated = [newSettlement, ...prev.slice(0, 19)];
    
    saveMetrics({ 
      settlements: updated,
      totalSettlements: updated.length 
    });
    
    return updated;
  });

  // ✅ FIX: Match HTTP requests by vaultPda
  if (data.txId && data.amount && data.vaultPda) {
    console.log(`🔗 Linking settlement ${data.txId} to vault ${data.vaultPda}`);
    
    setRecentHttpRequests(prev => 
      prev.map(req => {
        // Match requests from this vault that don't have a settlement yet
        if (req.vault === data.vaultPda && !req.settlement) {
          console.log(`✅ Linked request ${req.endpoint} to settlement`);
          return {
            ...req,
            settlement: {
              txId: data.txId!,
              amount: data.amount!,
            }
          };
        }
        return req;
      })
    );
  }
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
  }, []); // ✅ No dependencies, runs once

  const handleClearData = () => {
    if (confirm("Clear all stored metrics and settlements?")) {
      clearMetrics();
      setTotalPackets(0);
      setSettlements([]);
      setPeakPacketsPerSec(0);
      setPacketsPerSec(0);
      setHttpRequests(0);
      setRecentHttpRequests([]);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
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
            <button
              onClick={handleClearData}
              className="px-4 py-2 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-lg text-sm transition-colors"
            >
              Clear Data
            </button>
            
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

      {connectionStatus === "disconnected" && (
        <div className="mb-6 bg-red-900/20 border border-red-500 rounded-lg p-4">
          <p className="text-red-400 text-sm">
            ⚠️ Unable to connect to backend services. Make sure the facilitator
            and provider are running.
          </p>
        </div>
      )}

      <LiveMetrics
        totalPackets={totalPackets}
        packetsPerSec={packetsPerSec}
        activeSessions={sessions.length}
        totalSettlements={settlements.length}
        httpRequests={httpRequests}
      />

      {/* Protocol Breakdown */}
      <div className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-4">
  <div className="bg-slate-800/30 rounded-lg p-4 border border-slate-700">
    <div className="text-slate-400 text-sm mb-1">WebSocket Packets</div>
    <div className="text-2xl font-bold text-purple-400" suppressHydrationWarning>
      {totalPackets}
    </div>
    <div className="text-xs text-slate-500 mt-1">Streaming Protocol</div>
  </div>
  <div className="bg-slate-800/30 rounded-lg p-4 border border-slate-700">
    <div className="text-slate-400 text-sm mb-1">HTTP 402 Calls</div>
    <div className="text-2xl font-bold text-blue-400" suppressHydrationWarning>
      {httpRequests}
    </div>
    <div className="text-xs text-slate-500 mt-1">Request/Response</div>
  </div>
  <div className="bg-slate-800/30 rounded-lg p-4 border border-slate-700">
    <div className="text-slate-400 text-sm mb-1">Peak Throughput</div>
    <div className="text-2xl font-bold text-yellow-400" suppressHydrationWarning>
      {peakPacketsPerSec.toFixed(2)} pkt/s
    </div>
  </div>
  <div className="bg-slate-800/30 rounded-lg p-4 border border-slate-700">
    <div className="text-slate-400 text-sm mb-1">Unified Settlement</div>
    <div className="text-2xl font-bold text-green-400">
      ✓ Active
    </div>
    <div className="text-xs text-slate-500 mt-1">Both protocols → 1 tx</div>
  </div>
</div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-8">
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

        <div className="space-y-6">
  <div>
    <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
      <span className="text-blue-400">🌐</span>
      x402 HTTP Requests
    </h2>
    <div className="bg-slate-800/50 backdrop-blur rounded-lg p-4 border border-slate-700">
      <div className="text-3xl font-bold text-blue-400 mb-2" suppressHydrationWarning>
        {httpRequests}
      </div>
      <p className="text-sm text-slate-400 mb-4">Total HTTP 402 Requests</p>
              
             <div className="space-y-2 max-h-80 overflow-y-auto">
              {recentHttpRequests.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-xs text-slate-500 mb-2">No HTTP requests yet</p>
                  <code className="text-xs bg-slate-900 px-3 py-1 rounded text-cyan-400">
                    curl http://localhost:3002/api/market-data
                  </code>
                </div>
              ) : (
                recentHttpRequests.map((req, idx) => (
                  <div key={`${req.vault}-${req.timestamp}-${idx}`} className="bg-slate-900/50 p-3 rounded border border-slate-700 hover:border-blue-500/50 transition-colors">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-cyan-400 font-mono text-sm font-semibold truncate">
                        {req.endpoint}
                      </span>
                      <span className="text-xs text-slate-500">
                        {new Date(req.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    
                    <div className="flex items-center gap-2 text-xs text-slate-400 mb-2">
                      <span className="bg-slate-800 px-2 py-1 rounded font-mono">
                        {req.vault.substring(0, 8)}...
                      </span>
                      <span className="text-green-400">✓ Paid</span>
                    </div>

                    {/* ✅ NEW: Show settlement link if settled */}
                    {req.settlement && (
                      <a
                        href={`https://explorer.solana.com/tx/${req.settlement.txId}?cluster=devnet`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 mt-2 text-xs text-purple-400 hover:text-purple-300 transition-colors"
                      >
                        <span className="flex items-center gap-1">
                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z"/>
                            <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z"/>
                          </svg>
                          Settled: {(parseInt(req.settlement.amount) / 1_000_000_000).toFixed(4)} SOL
                        </span>
                      </a>
                    )}
                  </div>
                ))
              )}
            </div>

               <div suppressHydrationWarning>
  {httpRequests > 0 && (
    <div  className="mt-4 pt-4 border-t border-slate-700">
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-400">Est. Revenue (HTTP)</span>
        <span className="text-green-400 font-mono font-bold">
          {(httpRequests * 0.001).toFixed(4)} SOL
        </span>
      </div>
    </div>
  )}
</div>
</div>
  </div>

          <div>
            <h2 className="text-2xl font-bold text-white mb-4 flex items-center gap-2">
              <span className="text-green-400">💰</span>
              Recent Settlements
            </h2>
            <SettlementFeed settlements={settlements} />
          </div>
        </div>
      </div>

      <div className="mt-12 text-center text-slate-400 text-sm space-y-2">
        <p>
          Built for Solana x402 Hackathon • Powered by{" "}
          <a href="https://switchboard.xyz" className="text-purple-400 hover:underline">Switchboard</a> •{" "}
          <a href="https://visa.com" className="text-pink-400 hover:underline">Visa TAP</a> •{" "}
          <a href="https://coinbase.com" className="text-blue-400 hover:underline">Coinbase CDP</a>
        </p>
        <p className="text-xs">
          <span className="text-green-400">✓ x402 HTTP Compatible</span> •{" "}
          <span className="text-cyan-400">WebSocket Streaming</span> •{" "}
          <span className="text-yellow-400">Unified Settlement</span>
        </p>
        <p className="text-xs opacity-60">
          HTTP API: <code className="bg-slate-800 px-2 py-1 rounded">http://localhost:3002</code> •{" "}
          WebSocket: <code className="bg-slate-800 px-2 py-1 rounded">ws://localhost:3001</code>
        </p>
      </div>

      
    </div>
  );
}