import axios from "axios";
import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { logger } from "../utils/logger";

const ATXP_BRIDGE_URL = process.env.ATXP_BRIDGE_URL || "https://atxp-bridge.example.com";

export interface AtxpSettlementRequest {
  sourceChain: "solana";
  destinationChain: string;
  amount: string;
  recipient: string;
  solanaVault: string;
  signature: string;
}

export interface AtxpSettlementResponse {
  txId: string;
  destinationTxHash?: string;
  status: "pending" | "completed" | "failed";
}

/**
 * Executes a cross-chain settlement using ATXP bridge
 */
export async function settleViaAtxp(
  vaultPda: PublicKey,
  destinationChain: string,
  destinationAddress: string,
  amount: BN,
  signature: Buffer
): Promise<AtxpSettlementResponse> {
  try {
    const request: AtxpSettlementRequest = {
      sourceChain: "solana",
      destinationChain,
      amount: amount.toString(),
      recipient: destinationAddress,
      solanaVault: vaultPda.toBase58(),
      signature: signature.toString("base64"),
    };

    logger.info(
      { request },
      "Initiating ATXP cross-chain settlement"
    );

    const response = await axios.post<AtxpSettlementResponse>(
      `${ATXP_BRIDGE_URL}/api/v1/settle`,
      request,
      {
        headers: {
          "Content-Type": "application/json",
          "X-ATXP-API-Key": process.env.ATXP_API_KEY || "demo-key",
        },
        timeout: 30000,
      }
    );

    logger.info(
      { txId: response.data.txId, status: response.data.status },
      "ATXP settlement response received"
    );

    return response.data;
  } catch (error: any) {
    logger.error(error, "ATXP settlement failed");
    throw new Error(`ATXP bridge error: ${error.message}`);
  }
}

/**
 * Checks the status of an ATXP settlement
 */
export async function checkAtxpStatus(txId: string): Promise<AtxpSettlementResponse> {
  try {
    const response = await axios.get<AtxpSettlementResponse>(
      `${ATXP_BRIDGE_URL}/api/v1/status/${txId}`,
      {
        headers: {
          "X-ATXP-API-Key": process.env.ATXP_API_KEY || "demo-key",
        },
        timeout: 10000,
      }
    );

    return response.data;
  } catch (error: any) {
    logger.error({ txId, error: error.message }, "Failed to check ATXP status");
    throw error;
  }
}