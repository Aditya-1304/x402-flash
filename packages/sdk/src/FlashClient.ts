import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
  Keypair,
} from "@solana/web3.js";
import { Program, AnchorProvider, BN, type Wallet } from "@coral-xyz/anchor";
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createSyncNativeInstruction,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import EventEmitter from "eventemitter3";
import WebSocket from "isomorphic-ws";
import { FlowVault } from "./idl/flow_vault";
import idl from "./idl/flow_vault.json";
import {
  FlashClientEvents,
  FlashClientOptions,
  AutonomousSigner,
  SettlementRequest,
  RegisterProviderOptions,
} from "./types";
import { FLOW_VAULT_PROGRAM_ID } from "./constants";
import { findProviderPda, findVaultPda } from "./utils/vault-pda";
import { constructSettlementMessage } from "./utils/signature";

export class FlashClient extends EventEmitter<FlashClientEvents> {
  private connection: Connection;
  private signer: AutonomousSigner;
  private options: FlashClientOptions;
  private program: Program<FlowVault>;
  private provider: AnchorProvider;
  public ws: WebSocket | null = null;

  private vaultPda: PublicKey;
  private providerAuthority: PublicKey | null = null;
  private isConnected = false;

  constructor(
    connection: Connection,
    signer: AutonomousSigner,
    options: FlashClientOptions
  ) {
    super();
    this.connection = connection;
    this.signer = signer;
    this.options = options;

    const readOnlyWallet: Wallet = {
      publicKey: signer.publicKey,
      signTransaction: <T extends Transaction | VersionedTransaction>(
        tx: T
      ): Promise<T> => {
        return Promise.reject(
          new Error(
            "This is a read-only wallet. Use the client's signer object to sign transactions."
          )
        );
      },
      signAllTransactions: <T extends Transaction | VersionedTransaction>(
        txs: T[]
      ): Promise<T[]> => {
        return Promise.reject(
          new Error(
            "This is a read-only wallet. Use the client's signer object to sign transactions."
          )
        );
      },
      payer: Keypair.generate(),
    };

    this.provider = new AnchorProvider(
      this.connection,
      readOnlyWallet,
      AnchorProvider.defaultOptions()
    );

    this.program = new Program<FlowVault>(
      idl as FlowVault,
      this.provider
    );

    [this.vaultPda] = findVaultPda(this.signer.publicKey);
  }

  /**
   * Creates and funds an on-chain FlowVault for the agent.
   * Automatically handles wrapped SOL setup if using native SOL.
   */
  public async createVault(
    depositAmount: BN,
    tokenMint: PublicKey
  ): Promise<string> {
    const agentTokenAccount = await getAssociatedTokenAddress(
      tokenMint,
      this.signer.publicKey
    );

    const accountInfo = await this.connection.getAccountInfo(agentTokenAccount);

    if (!accountInfo) {
      console.log('Creating token account...');

      const createAtaIx = createAssociatedTokenAccountInstruction(
        this.signer.publicKey,
        agentTokenAccount,
        this.signer.publicKey,
        tokenMint
      );

      const createAtaTx = new Transaction().add(createAtaIx);

      if (tokenMint.equals(NATIVE_MINT)) {
        console.log('Setting up wrapped SOL...');

        const transferIx = SystemProgram.transfer({
          fromPubkey: this.signer.publicKey,
          toPubkey: agentTokenAccount,
          lamports: depositAmount.toNumber() + 2039280,
        });

        const syncIx = createSyncNativeInstruction(agentTokenAccount);

        createAtaTx.add(transferIx, syncIx);
      }

      await this.signAndSendTransaction(createAtaTx);

      await new Promise(resolve => setTimeout(resolve, 2000));
    } else if (tokenMint.equals(NATIVE_MINT)) {
      console.log('Wrapped SOL account exists, checking balance...');

      try {
        const tokenAccountInfo = await this.connection.getTokenAccountBalance(agentTokenAccount);
        const currentBalance = new BN(tokenAccountInfo.value.amount);

        if (currentBalance.lt(depositAmount)) {
          console.log('Adding more wrapped SOL...');

          const transferIx = SystemProgram.transfer({
            fromPubkey: this.signer.publicKey,
            toPubkey: agentTokenAccount,
            lamports: depositAmount.sub(currentBalance).toNumber(),
          });

          const syncIx = createSyncNativeInstruction(agentTokenAccount);

          const wrapTx = new Transaction().add(transferIx, syncIx);
          await this.signAndSendTransaction(wrapTx);

          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (error) {
        console.log('Error checking balance, will try to wrap anyway:', error);

        const transferIx = SystemProgram.transfer({
          fromPubkey: this.signer.publicKey,
          toPubkey: agentTokenAccount,
          lamports: depositAmount.toNumber(),
        });

        const syncIx = createSyncNativeInstruction(agentTokenAccount);

        const wrapTx = new Transaction().add(transferIx, syncIx);
        await this.signAndSendTransaction(wrapTx);

        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    const [vaultTokenAccountPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_token_account"), this.signer.publicKey.toBuffer()],
      this.program.programId
    );

    const tx = await this.program.methods
      .createVault(depositAmount)
      .accounts({
        agent: this.signer.publicKey,
        vault: this.vaultPda,
        vaultTokenAccount: vaultTokenAccountPda,
        agentTokenAccount: agentTokenAccount,
        tokenMint: tokenMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .transaction();

    await this.signAndSendTransaction(tx);

    return this.vaultPda.toBase58();
  }

  /**
   * [BOUNTY: ATXP & Visa TAP]
   * Registers the wallet as a Provider on-chain.
   */
  public async registerProvider(
    options: RegisterProviderOptions
  ): Promise<string> {
    const [providerPda] = findProviderPda(this.signer.publicKey);

    const tx = await this.program.methods
      .registerProvider(
        options.visaMerchantId ?? null,
        options.protocol
      )
      .accounts({
        authority: this.signer.publicKey,
        provider: providerPda,
        destination: options.destinationTokenAccount,
        systemProgram: SystemProgram.programId,
      } as any)
      .transaction();

    return this.signAndSendTransaction(tx);
  }

  public async x402Fetch(
    url: string,
    options: RequestInit = {}
  ): Promise<Response> {
    if (!this.vaultPda) {
      throw new Error("Must create a vault before making x402 requests");
    }

    if (!this.providerAuthority) {
      throw new Error("Must call connect() before making x402 requests");
    }

    const pricePerRequest = 1000;

    const headers = {
      ...options.headers,
      "X-402-Vault": this.vaultPda.toBase58(),
      "X-402-Provider": this.providerAuthority.toBase58(),
      "X-402-Price": pricePerRequest.toString(),
    };

    const response = await fetch(url, { ...options, headers });

    if (response.status === 402) {
      const errorData: any = await response.json();
      throw new Error(`Payment Required: ${errorData.message}`);
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response;
  }

  /**
   * Withdraws all remaining funds from the agent's vault.
   */
  public async withdraw(agentTokenAccount: PublicKey): Promise<string> {
    const vaultAccount = await this.program.account.vault.fetch(this.vaultPda);

    const tx = await this.program.methods
      .withdraw()
      .accounts({
        agent: this.signer.publicKey,
        vault: this.vaultPda,
        vaultTokenAccount: vaultAccount.vaultTokenAccount,
        agentTokenAccount: agentTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .transaction();

    return this.signAndSendTransaction(tx);
  }

  /**
   * Connects to the facilitator to begin an autonomous session.
   * [BOUNTY: Visa TAP] - Requires a valid JWT credential.
   */
  public connect(
    providerAuthority: PublicKey,
    visaTapCredentialJwt: string
  ): void {
    if (this.ws) {
      console.warn("FlashClient is already connected or connecting.");
      return;
    }

    this.providerAuthority = providerAuthority;
    const url = new URL(this.options.facilitatorUrl);
    url.searchParams.set("agent", this.signer.publicKey.toBase58());
    url.searchParams.set("provider", providerAuthority.toBase58());
    url.searchParams.set("visa_tap_credential", visaTapCredentialJwt);

    this.ws = new WebSocket(url.toString());

    this.ws.onopen = () => {
      this.isConnected = true;
      this.emit("connect");
    };

    this.ws.onmessage = (event) =>
      this.handleFacilitatorMessage(event.data.toString());

    this.ws.onclose = () => {
      this.isConnected = false;
      this.ws = null;
      this.emit("disconnect");
    };

    this.ws.onerror = (error) => {
      this.emit("error", new Error(error.message));
    };
  }

  public disconnect(): void {
    if (this.ws) {
      this.ws.close();
    }
  }

  /**
   * Handles incoming messages from the facilitator.
   */
  private async handleFacilitatorMessage(message: string): Promise<void> {
    try {
      const data = JSON.parse(message);
      switch (data.type) {
        case "request_signature":
          await this._handleSettlementRequest({
            amount: new BN(data.amount),
            nonce: new BN(data.nonce),
          });
          break;
        case "settlement_confirmed":
          this.emit("settlement_confirmed", data.txId);
          break;
        case "settlement_failed":
          this.emit("settlement_failed", data.message);
          break;
        case "error":
          this.emit("error", new Error(data.message || "Facilitator error"));
          this.disconnect();
          break;
      }
    } catch (error) {
      console.error("Failed to handle facilitator message", error);
    }
  }

  /**
   * Automatically signs and sends a settlement signature.
   */
  private async _handleSettlementRequest(
    request: SettlementRequest
  ): Promise<void> {
    if (!this.ws || !this.providerAuthority) {
      throw new Error("Not connected to facilitator.");
    }

    try {
      const [providerPda] = findProviderPda(this.providerAuthority);
      const message = constructSettlementMessage(
        this.vaultPda,
        providerPda,
        request.amount,
        request.nonce
      );
      const signatureBytes = await this.signer.signMessage(message);
      const payload = {
        type: "settlement_signature",
        amount: request.amount.toString(),
        nonce: request.nonce.toString(),
        signature: Buffer.from(signatureBytes).toString("base64"),
      };
      this.ws.send(JSON.stringify(payload));
    } catch (error: any) {
      this.emit("error", new Error(`Failed to sign settlement: ${error.message}`));
    }
  }

  /**
   * Helper to sign and send a standard transaction.
   */
  private async signAndSendTransaction(tx: Transaction): Promise<string> {
    const { blockhash } = await this.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = this.signer.publicKey;

    const signedTx = await this.signer.signTransaction(tx);
    const txId = await this.connection.sendRawTransaction(signedTx.serialize());
    await this.connection.confirmTransaction(txId, "confirmed");
    return txId;
  }
}