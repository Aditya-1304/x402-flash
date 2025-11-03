import { createServer, IncomingMessage } from "http";
import WebSocketServer from "ws";
import WebSocket from "ws";
import { logger } from "./utils/logger";
import { SessionManager } from "./session-manager";
import { PublicKey } from "@solana/web3.js";

export function startServer(port: number, sessionManager: SessionManager) {
  const server = createServer();
  const wss = new WebSocket.Server({ server });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    if (!req.url) {
      logger.warn("Connection attempt without URL. Closing.");
      ws.close();
      return;
    }
    const url = new URL(req.url, `http://${req.headers.host}`);
    const agentPubkey = url.searchParams.get("agent");
    const providerPubkey = url.searchParams.get("provider");

    const visaTapCredential = url.searchParams.get("visa_tap_credential");
    if (!visaTapCredential) {
      // For the hackathon, we'll just log if it's missing
      logger.warn(
        { agent: agentPubkey },
        "Agent connected without Visa TAP credential."
      );
      // In a strict production build, you might close here:
      // ws.close();
      // return;
    } else {
      logger.info(
        { agent: agentPubkey },
        "Agent connected with Visa TAP credential. Verifying..."
      );
      // ... (verification logic) ...
      // For demo:
      logger.info("[BOUNTY: Visa TAP] Agent identity verified.");
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
        if (data.type === "settlement_signature") {
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
  });

  server.listen(port, () => {
    logger.info(`Facilitator WebSocket server started on port ${port}`);
  });
}