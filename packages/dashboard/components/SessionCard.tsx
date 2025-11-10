"use client";

interface Session {
  sessionId: string;
  agentPubkey: string;
  consumed: number;
  packetsDelivered: number;
}

export default function SessionCard({ session }: { session: Session }) {
  return (
    <div className="bg-slate-800/50 backdrop-blur rounded-lg p-6 border border-slate-700 hover:border-purple-500 transition-colors">
      <div className="flex items-start justify-between mb-4">
        <div>
          <p className="text-xs text-slate-400 font-mono">
            {session.sessionId.substring(0, 20)}...
          </p>
          <p className="text-sm text-slate-300 mt-1">
            Agent: {session.agentPubkey.substring(0, 8)}...
          </p>
        </div>
        <span className="px-3 py-1 bg-green-500/20 text-green-400 rounded-full text-xs font-semibold">
          LIVE
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-slate-400">Packets Delivered</p>
          <p className="text-2xl font-bold text-white">
            {session.packetsDelivered.toLocaleString()}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-400">Cost (lamports)</p>
          <p className="text-2xl font-bold text-purple-400">
            {session.consumed.toLocaleString()}
          </p>
        </div>
      </div>

      <div className="mt-4 h-2 bg-slate-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-purple-500 to-pink-500 animate-pulse"
          style={{ width: "75%" }}
        ></div>
      </div>
    </div>
  );
}