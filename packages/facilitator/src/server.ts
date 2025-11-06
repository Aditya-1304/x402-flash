import { createServer, IncomingMessage } from "http";
import WebSocket from "ws";
import jwt from "jsonwebtoken";
import { logger } from "./utils/logger";
import { SessionManager } from "./session-manager";
import config from "config";
import { RateLimiter } from "./utils/rate-limiter";
import { getHealthStatus } from "./utils/health";
import { getMetricsRegistry, activeConnections } from "./utils/metrics";
import { shutdownManager } from "./utils/shutdown";
import { X402Middleware } from "./middleware/x402-middleware";

const VISA_TAP_JWT_SECRET = process.env.VISA_TAP_JWT_SECRET;
if (!VISA_TAP_JWT_SECRET) {
  logger.error("FATAL: VISA_TAP_JWT_SECRET is not set in the environment.");
  process.exit(1);
}

export function startServer(port: number, sessionManager: SessionManager) {
  const rateLimiter = new RateLimiter(10, 60000); // 10 requests per minute
  const metricsRegistry = getMetricsRegistry();
  const x402 = new X402Middleware(sessionManager);

  const server = createServer(async (req, res) => {
    // CORS headers for all responses
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    // Health check endpoint
    if (req.url === "/health" && req.method === "GET") {
      try {
        const health = await getHealthStatus();
        const statusCode = health.status === "healthy" ? 200 : 503;
        res.writeHead(statusCode, { "Content-Type": "application/json" });
        res.end(JSON.stringify(health));
      } catch (error: any) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: error.message }));
      }
      return;
    }

    // Metrics endpoint
    if (req.url === "/metrics" && req.method === "GET") {
      try {
        res.setHeader("Content-Type", metricsRegistry.contentType);
        res.end(await metricsRegistry.metrics());
      } catch (error: any) {
        res.writeHead(500);
        res.end(error.message);
      }
      return;
    }

    if (req.url?.startsWith("/api/") && req.method === "GET") {
      await x402.handle(req, res, () => {
        // Protected endpoint logic
        if (req.url === "/api/stream") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              data: "Protected streaming data chunk",
              timestamp: Date.now(),
            })
          );
        } else if (req.url === "/api/data") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              message: "Protected API data",
              cost: 1000, // 0.001 USDC
            })
          );
        } else {
          res.writeHead(404);
          res.end();
        }
      });
      return;
    }

    // Usage reporting endpoint
    if (req.url === "/report-usage" && req.method === "POST") {
      try {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          const { agentId, amount } = JSON.parse(body);
          const BN = require("@coral-xyz/anchor").BN;
          sessionManager.reportUsage(agentId, new BN(amount));
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        });
      } catch (error: any) {
        logger.error(error, "Error handling /report-usage");
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: error.message }));
      }
      return;
    }

    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocket.Server({ server });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const clientIp = req.socket.remoteAddress || "unknown";

    // Rate limiting
    if (!rateLimiter.isAllowed(clientIp)) {
      logger.warn({ ip: clientIp }, "Rate limit exceeded for IP");
      ws.send(JSON.stringify({ type: "error", message: "Rate limit exceeded" }));
      ws.close();
      return;
    }

    if (!req.url) {
      logger.warn("WebSocket connection attempt without URL. Closing.");
      ws.close();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const agentPubkey = url.searchParams.get("agent");
    const providerPubkey = url.searchParams.get("provider");
    const visaTapCredential = url.searchParams.get("visa_tap_credential");

    if (!visaTapCredential) {
      logger.warn({ agent: agentPubkey }, "Agent connected without Visa TAP credential.");
      ws.send(JSON.stringify({ type: "error", message: "Visa TAP credential required." }));
      ws.close();
      return;
    }

    try {
      jwt.verify(visaTapCredential, VISA_TAP_JWT_SECRET!);
      logger.info({ agent: agentPubkey }, "[BOUNTY: Visa TAP] Agent verified");
    } catch (err: any) {
      logger.error({ agent: agentPubkey, error: err.message }, "Invalid Visa TAP credential");
      ws.send(JSON.stringify({ type: "error", message: "Invalid credential" }));
      ws.close();
      return;
    }

    if (!agentPubkey || !providerPubkey) {
      logger.warn("Missing agent or provider parameter");
      ws.close();
      return;
    }

    activeConnections.inc();
    sessionManager.handleConnect(ws, agentPubkey, providerPubkey);

    ws.on("message", (message: string) => {
      try {
        const data = JSON.parse(message);
        if (data.type === "settlement_signature") {
          sessionManager.handleSignature(
            agentPubkey,
            data.amount,
            data.nonce,
            data.signature
          );
        }
      } catch (e) {
        logger.error(e, "Invalid WebSocket message");
      }
    });

    ws.on("close", () => {
      activeConnections.dec();
      sessionManager.handleDisconnect(agentPubkey);
    });
  });

  server.listen(port, () => {
    logger.info(`x402-Flash Server running on port ${port}`);
    logger.info(`Health: http://localhost:${port}/health`);
    logger.info(`Metrics: http://localhost:${port}/metrics`);
  });

  // Register graceful shutdown
  shutdownManager.register(async () => {
    logger.info("Closing WebSocket server...");
    wss.close();
    server.close();
  });
}