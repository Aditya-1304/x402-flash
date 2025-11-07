import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

export type PaymentProtocol = {
  nativeSpl: {};
} | {
  atxpBridge: {};
};


/**
 * [BOUNTY: Coinbase CDP]
 * A generic interface for a signer.
 * This can be a standard `WalletAdapter` (like Phantom) OR
 * an autonomous `Coinbase CDP Embedded Wallet` that signs without popups.
 */
export interface AutonomousSigner {
  publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(
    tx: T
  ): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(
    txs: T[]
  ): Promise<T[]>;
  /**
   * This is the key function for autonomous settlement.
   * A CDP wallet can be configured to sign these messages automatically.
   */
  signMessage(message: Uint8Array): Promise<Uint8Array>;
}

export interface CoinbaseAgentKitWallet extends AutonomousSigner {
  exportWallet?: () => Promise<{
    seed: string;
    walletId: string;
  }>;
  getDefaultAddress?: () => Promise<string>;
}

export type SupportedWallet = AutonomousSigner | CoinbaseAgentKitWallet;


export interface FlashClientOptions {
  facilitatorUrl: string;
}

export interface SettlementRequest {
  amount: BN;
  nonce: BN;
}

export interface FlashClientEvents {
  connect: () => void;
  disconnect: () => void;
  error: (error: Error) => void;
  settlement_confirmed: (txId: string) => void;
  settlement_failed: (reason?: string) => void;
}

/**
 * [BOUNTY: ATXP & Visa TAP]
 * Options for registering a new provider.
 */
export interface RegisterProviderOptions {
  /** The SPL Token Account to receive payments. */
  destinationTokenAccount: PublicKey;
  /**
   * [BOUNTY: ATXP]
   * The payment protocol this provider accepts.
   */
  protocol: PaymentProtocol;
  /**
   * [BOUNTY: Visa TAP]
   * Optional Visa Trusted Agent Protocol Merchant ID.
   */
  visaMerchantId?: string;
}
