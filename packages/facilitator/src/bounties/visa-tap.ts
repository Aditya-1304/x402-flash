import axios from "axios";
import * as jwt from "jsonwebtoken";
import { logger } from "../utils/logger";

const VISA_TAP_API_BASE = process.env.VISA_TAP_API_BASE || "https://sandbox.api.visa.com";
const VISA_TAP_JWT_SECRET = process.env.VISA_TAP_JWT_SECRET!;

export interface VisaTapMerchant {
  merchantId: string;
  name: string;
  status: "active" | "inactive";
}

/**
 * Validates a Visa TAP merchant using JWT authentication
 */
export async function validateVisaTapMerchant(
  merchantId: string,
  jwtToken: string
): Promise<boolean> {
  try {
    const decoded = jwt.verify(jwtToken, VISA_TAP_JWT_SECRET) as {
      merchantId: string;
    };

    if (decoded.merchantId !== merchantId) {
      logger.warn(
        { merchantId, decoded },
        "Merchant ID mismatch in JWT"
      );
      return false;
    }

    const response = await axios.get<VisaTapMerchant>(
      `${VISA_TAP_API_BASE}/tap/v1/merchants/${merchantId}`,
      {
        headers: {
          Authorization: `Bearer ${jwtToken}`,
          "Content-Type": "application/json",
        },
        timeout: 5000,
      }
    );

    if (response.status !== 200) {
      logger.warn(
        { merchantId, status: response.status },
        "Visa TAP merchant validation failed"
      );
      return false;
    }

    const merchant = response.data;

    logger.info(
      { merchantId, name: merchant.name, status: merchant.status },
      "Visa TAP merchant validated"
    );

    return merchant.status === "active";
  } catch (error: any) {
    logger.error(
      { merchantId, error: error.message },
      "Error validating Visa TAP merchant"
    );
    return false;
  }
}

/**
 * Records a Visa TAP transaction (for audit trail)
 */
export async function recordVisaTapTransaction(
  merchantId: string,
  amount: number,
  txId: string
): Promise<void> {
  try {
    await axios.post(
      `${VISA_TAP_API_BASE}/tap/v1/transactions`,
      {
        merchantId,
        amount,
        currency: "USD",
        solanaTransactionId: txId,
        timestamp: new Date().toISOString(),
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.VISA_TAP_API_KEY}`,
        },
        timeout: 5000,
      }
    );

    logger.info({ merchantId, txId, amount }, "Visa TAP transaction recorded");
  } catch (error: any) {
    logger.error(error, "Failed to record Visa TAP transaction");
  }
}