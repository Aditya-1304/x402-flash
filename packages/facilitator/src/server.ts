import { createServer, IncomingMessage } from "http";
import WebSocket from "ws";
import { logger } from "./utils/logger";
import { SessionManager } from "./session-manager";
import { PublicKey } from "@solana/web3.js";
import * as jwt from "jsonwebtoken";
import { BN } from "@coral-xyz/anchor";

const VISA_TAP_JWT_SECRET = process.env.VISA_TAP_JWT_SECRET;
if (!VISA_TAP_JWT_SECRET) {
  logger.error("FATAL: VISA_TAP_JWT_SECRET is not set in the environment.");
  process.exit(1);
}

export function startServer(port: number, sessionManager: SessionManager) {
  // The HTTP server will handle BOTH WebSockets and internal API calls
  const server = createServer(async (req, res) => {
    // --- THIS IS THE NEW PRODUCTION-GRADE USAGE REPORTING ENDPOINT ---
    if (req.url === "/report-usage" && req.method === "POST") {
      try {
        let body = "";
        for await (const chunk of req) {
          body += chunk.toString();
        }

        const { agentId, usage } = JSON.parse(body);
        if (!agentId || !usage) {
          throw new Error("Missing agentId or usage in usage report");
        }

        // Report usage to the session manager
        sessionManager.reportUsage(agentId, new BN(usage));

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      } catch (error: any) {
        logger.error(error, "Failed to process usage report");
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "error", message: error.message }));
      }
    } else {
      // Any other HTTP request is not found (WebSockets are handled below)
      res.writeHead(404);
      res.end();
    }
    // --- END OF NEW HTTP LOGIC ---
  });

  const wss = new WebSocket.Server({ server });

  // This 'connection' logic is for the WebSocket protocol
  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    if (!req.url) {
      logger.warn("WebSocket connection attempt without URL. Closing.");
      ws.close();
      return;
    }
    const url = new URL(req.url, `http://${req.headers.host}`);
    const agentPubkey = url.searchParams.get("agent");
    const providerPubkey = url.searchParams.get("provider");

    // [BOUNTY: Visa TAP]
    const visaTapCredential = url.searchParams.get("visa_tap_credential");
    if (!visaTapCredential) {
      logger.warn({ agent: agentPubkey }, "Agent connected without Visa TAP credential. Closing.");
      ws.send(JSON.stringify({ type: "error", message: "Visa TAP credential required." }));
      ws.close();
      return;
    }

    try {
      const decoded = jwt.verify(visaTapCredential, VISA_TAP_JWT_SECRET!);
      logger.info({ agent: agentPubkey, claims: decoded }, "[BOUNTY: Visa TAP] Agent identity verified via JWT credential.");
    } catch (err: any) {
      logger.error({ agent: agentPubkey, error: err.message }, "Invalid Visa TAP credential. Closing.");
      ws.send(JSON.stringify({ type: "error", message: "Invalid Visa TAP credential." }));
      ws.close();
      return;
    }

    if (!agentPubkey || !providerPubkey) {
      logger.warn("Connection attempt without agent or provider pubkey. Closing.");
      ws.close();
      return;
    }

    try {
      new PublicKey(agentPubkey);
      new PublicKey(providerPubkey);
    } catch (e) {
      logger.warn("Connection attempt with invalid pubkey. Closing.");
      ws.close();
      return;
    }

    sessionManager.handleConnect(ws, agentPubkey, providerPubkey);

    ws.on("message", (message: string) => {
      try {
        const data = JSON.parse(message);
        if (data.type === "settlement_signature" && agentPubkey) {
          sessionManager.handleSignature(
            agentPubkey,
            data.amount,
            data.nonce,
            data.signature
          );
        }
      } catch (error) {
        logger.error(error, "Failed to handle message");
      }
    });

    ws.on("close", () => {
      if (agentPubkey) {
        sessionManager.handleDisconnect(agentPubkey);
      }
    });
  });

  server.listen(port, () => {
    logger.info(`x402-Flash MCP Server (WebSocket + HTTP) started on port ${port}`);
  });
}