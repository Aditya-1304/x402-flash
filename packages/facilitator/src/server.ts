import { createServer, IncomingMessage } from "http";
import WebSocket from "ws";
import jwt from "jsonwebtoken";
import { BN } from "@coral-xyz/anchor";
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
  const rateLimiter = new RateLimiter(10, 60000);
  const metricsRegistry = getMetricsRegistry();
  const x402 = new X402Middleware(sessionManager);

  setInterval(() => {
    sessionManager.broadcastMetrics();
  }, 1000);

  const server = createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "http://localhost:3000");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Credentials", "true");

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

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
              cost: 1000,
            })
          );
        } else {
          res.writeHead(404);
          res.end();
        }
      });
      return;
    }

    if (req.url === "/report-usage" && req.method === "POST") {
      try {
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          const { agentId, amount } = JSON.parse(body);
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
    const clientType = url.searchParams.get("type");

    if (clientType === "dashboard") {
      logger.info("Dashboard observer connected");
      activeConnections.inc();
      sessionManager.registerDashboard(ws);

      ws.on("message", async (message: string) => {
        try {
          const data = JSON.parse(message);

          if (data.type === "request_metrics") {
            const sessions = Array.from(sessionManager.sessions.values());
            ws.send(JSON.stringify({
              type: "session_update",
              timestamp: Date.now(),
              sessions: sessions.map(s => ({
                sessionId: s.agent.toBase58().substring(0, 16),
                agentPubkey: s.agent.toBase58(),
                consumed: s.spentOffchain.toNumber(),
                packetsDelivered: Math.floor(s.spentOffchain.toNumber() / 1000),
              })),
            }));
          }
        } catch (e) {
          logger.error(e, "Invalid dashboard message");
        }
      });

      ws.on("close", () => {
        activeConnections.dec();
        logger.info("Dashboard observer disconnected");
      });

      return;
    }

    if (clientType === "provider") {
      const providerPubkey = url.searchParams.get("provider");
      logger.info({ provider: providerPubkey }, "Provider connected to facilitator");

      ws.on("message", async (message: string) => {
        try {
          const data = JSON.parse(message);

          if (data.type === "x402_http_request") {
            logger.info({
              endpoint: data.endpoint,
              vault: data.payment?.vault,
              amount: data.payment?.amount,
            }, "[x402-HTTP] Processing HTTP payment request");

            if (data.payment?.vault && data.payment?.amount) {
              const session = sessionManager.sessions.get(data.payment.vault);

              if (session) {
                session.spentOffchain = session.spentOffchain.add(new BN(data.payment.amount));

                logger.debug(
                  {
                    vault: data.payment.vault,
                    amount: data.payment.amount,
                    totalSpent: session.spentOffchain.toString()
                  },
                  "[x402-HTTP] Usage tracked for settlement"
                );


                if (session.spentOffchain.gte(sessionManager.getSettlementThreshold())) {
                  logger.info({
                    vault: data.payment.vault,
                    spent: session.spentOffchain.toString(),
                  }, "🔥 HTTP request threshold exceeded, triggering settlement");

                  await sessionManager.triggerSettlement(data.payment.vault);
                }
              } else {
                logger.warn(
                  { vault: data.payment.vault },
                  "[x402-HTTP] Received payment for unknown session, creating temporary session"
                );

              }
            }

            sessionManager.broadcastToDashboards({
              type: "x402_http_request",
              endpoint: data.endpoint,
              payment: data.payment,
              timestamp: data.timestamp || Date.now(),
            });

            logger.debug("[x402-HTTP] Request broadcasted to dashboards (ONCE)");

            return;
          }

          if (data.type === "usage_report") {
            const { agentPubkey, amount, packetsDelivered } = data;

            logger.debug({
              agent: agentPubkey,
              amount,
              packets: packetsDelivered
            }, "Received usage report from provider (WebSocket)");

            const agentId = agentPubkey;
            const session = sessionManager.sessions.get(agentId);

            if (session) {
              const reportedAmount = new BN(amount);
              session.spentOffchain = reportedAmount;

              logger.info({
                agent: agentId,
                consumed: session.spentOffchain.toString(),
                packets: packetsDelivered
              }, "WebSocket session updated with usage");

              if (session.spentOffchain.gte(sessionManager.getSettlementThreshold())) {
                logger.info({
                  agent: agentId,
                  spent: session.spentOffchain.toString(),
                }, "🔥 WebSocket threshold exceeded, triggering settlement");

                await sessionManager.triggerSettlement(agentId);
              }
            } else {
              logger.warn({ agent: agentId }, "Usage report for unknown session");
            }

            return;
          }

          if (data.type === "provider_session_start") {
            logger.info(data, "Provider started new session");
            return;
          }

        } catch (e) {
          logger.error(e, "Error handling provider message");
        }
      });

      ws.on("close", () => {
        logger.info({ provider: providerPubkey }, "Provider disconnected");
      });

      return;
    }

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

        if (data.type === "request_metrics") {
          const sessions = Array.from(sessionManager.sessions.values());
          ws.send(JSON.stringify({
            type: "metrics",
            timestamp: Date.now(),
            sessions: sessions.map(s => ({
              sessionId: s.agent.toBase58().substring(0, 16),
              agentPubkey: s.agent.toBase58(),
              consumed: s.spentOffchain.toNumber(),
              packetsDelivered: Math.floor(s.spentOffchain.toNumber() / 1000),
            })),
            packetsPerSec: sessions.length * 10,
          }));
        }

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

  shutdownManager.register(async () => {
    logger.info("Closing WebSocket server...");
    wss.close();
    server.close();
  });
}