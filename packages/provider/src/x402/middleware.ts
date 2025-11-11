import { Request, Response, NextFunction } from 'express';
import { PublicKey } from '@solana/web3.js';
import * as nacl from 'tweetnacl';
import bs58 from 'bs58';

export interface X402PaymentProof {
  vault: string;
  amount: number;
  nonce: number;
  signature: string;
  publicKey: string;
}

export class X402Middleware {
  constructor(
    private pricePerRequest: number,
    private destinationAccount: string,
    private merchantId: string
  ) { }

  /**
   * Express middleware for x402 payment verification
   */
  requirePayment = (req: Request, res: Response, next: NextFunction) => {
    const paymentHeader = req.headers['x402-payment'] as string;

    if (!paymentHeader) {
      return this.sendPaymentRequired(res);
    }

    try {
      const proof: X402PaymentProof = JSON.parse(paymentHeader);

      if (!this.verifyPaymentProof(proof)) {
        return res.status(402).json({
          error: 'Invalid payment proof',
          message: 'Payment signature verification failed',
        });
      }
      if (proof.amount < this.pricePerRequest) {
        return res.status(402).json({
          error: 'Insufficient payment',
          required: this.pricePerRequest,
          provided: proof.amount,
        });
      }

      (req as any).x402Payment = proof;

      next();
    } catch (error) {
      console.error('Payment proof parsing error:', error);
      return this.sendPaymentRequired(res);
    }
  };

  /**
   * Send HTTP 402 Payment Required with x402 headers
   */
  private sendPaymentRequired(res: Response) {
    res.status(402)
      .set({
        'x402-price': this.pricePerRequest.toString(),
        'x402-accept': 'solana-spl',
        'x402-address': this.destinationAccount,
        'x402-protocol': 'flow-vault-v1',
        'x402-merchant-id': this.merchantId,
        'x402-currency': 'lamports',
      })
      .json({
        error: 'Payment Required',
        message: 'This endpoint requires payment via x402 protocol',
        price: this.pricePerRequest,
        protocol: 'flow-vault-v1',
        documentation: 'https://github.com/yourusername/x402-flash',
        websocketEndpoint: `ws://${process.env.HOST || 'localhost'}:${process.env.PROVIDER_PORT || 3001}`,
      });
  }

  /**
   * Verify payment proof signature
   */
  private verifyPaymentProof(proof: X402PaymentProof): boolean {
    try {
      const message = Buffer.from(
        `${proof.vault}:${proof.amount}:${proof.nonce}`
      );

      const signature = bs58.decode(proof.signature);
      const publicKey = bs58.decode(proof.publicKey);

      return nacl.sign.detached.verify(message, signature, publicKey);
    } catch (error) {
      console.error('Signature verification error:', error);
      return false;
    }
  }

  /**
   * Generate payment proof for client-side use
   */
  static generatePaymentProof(
    vault: string,
    amount: number,
    nonce: number,
    signature: string,
    publicKey: string
  ): string {
    const proof: X402PaymentProof = {
      vault,
      amount,
      nonce,
      signature,
      publicKey,
    };
    return JSON.stringify(proof);
  }
}