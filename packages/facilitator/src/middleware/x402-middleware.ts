import { IncomingMessage, ServerResponse } from "http";
import { SessionManager } from "../session-manager";
import { BN } from "@coral-xyz/anchor";
import { logger } from "../utils/logger";

const X402_PRICE_HEADER = "x-402-price";
const X402_VAULT_HEADER = "x-402-vault";
const X402_PROVIDER_HEADER = "x-402-provider";

export interface X402Request extends IncomingMessage {
  vault?: string;
  provider?: string;
  price?: BN;
}

export class X402Middleware {
  constructor(private sessionManager: SessionManager) { }

  /**
   * Intercepts HTTP requests and enforces x402 payment protocol
   */
  public async handle(
    req: X402Request,
    res: ServerResponse,
    next: () => void
  ): Promise<void> {
    const vault = req.headers[X402_VAULT_HEADER] as string | undefined;
    const provider = req.headers[X402_PROVIDER_HEADER] as string | undefined;
    const priceStr = req.headers[X402_PRICE_HEADER] as string | undefined;

    if (!vault || !provider || !priceStr) {
      logger.warn(
        { url: req.url, headers: req.headers },
        "Missing x402 payment headers"
      );

      res.writeHead(402, {
        "Content-Type": "application/json",
        "WWW-Authenticate": 'x402 realm="x402-flash-facilitator"',
      });
      res.end(
        JSON.stringify({
          error: "Payment Required",
          message: "Include X-402-Vault, X-402-Provider, and X-402-Price headers",
          facilitatorUrl: process.env.FACILITATOR_URL || "ws://localhost:8080",
          requiredHeaders: {
            "X-402-Vault": "Base58-encoded vault PDA",
            "X-402-Provider": "Base58-encoded provider authority",
            "X-402-Price": "Amount in lamports",
          },
        })
      );
      return;
    }

    try {
      const price = new BN(priceStr);

      req.vault = vault;
      req.provider = provider;
      req.price = price;

      await this.sessionManager.reportUsage(vault, price);

      logger.info(
        { vault, provider, price: price.toString(), url: req.url },
        "x402 payment accepted"
      );

      next();
    } catch (error) {
      logger.error(error, "Error processing x402 payment");
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid payment headers" }));
    }
  }
}