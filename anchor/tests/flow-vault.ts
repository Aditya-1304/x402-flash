import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { FlowVault } from "../target/types/flow_vault";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  Ed25519Program,
  SYSVAR_INSTRUCTIONS_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  createAccount,
  mintTo,
  getAccount,
} from "@solana/spl-token";
import { assert } from "chai";
import nacl from "tweetnacl";

describe("flow-vault", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.FlowVault as Program<FlowVault>;
  const payer = provider.wallet as anchor.Wallet;

  let mint: PublicKey;
  let admin: Keypair;
  let agent: Keypair;
  let facilitator: Keypair;
  let providerAuthority: Keypair;

  let agentTokenAccount: PublicKey;
  let providerTokenAccount: PublicKey;

  let globalConfigPda: PublicKey;
  let vaultPda: PublicKey;
  let vaultTokenAccountPda: PublicKey;
  let providerPda: PublicKey;

  const settleThreshold = new BN(100_000); // 0.1 USDC (6 decimals)
  const feeBps = 100; // 1%
  const depositAmount = new BN(2_000_000); // 2 USDC

  before(async () => {
    // Generate keypairs
    admin = Keypair.generate();
    agent = Keypair.generate();
    facilitator = Keypair.generate();
    providerAuthority = Keypair.generate();

    // Airdrop SOL
    const airdropSigs = await Promise.all([
      provider.connection.requestAirdrop(admin.publicKey, 5e9),
      provider.connection.requestAirdrop(agent.publicKey, 5e9),
      provider.connection.requestAirdrop(facilitator.publicKey, 2e9),
      provider.connection.requestAirdrop(providerAuthority.publicKey, 2e9),
    ]);

    // Wait for confirmations
    await Promise.all(
      airdropSigs.map((sig) =>
        provider.connection.confirmTransaction(sig, "confirmed")
      )
    );

    // Create mint (USDC mock with 6 decimals)
    mint = await createMint(
      provider.connection,
      payer.payer,
      admin.publicKey,
      null,
      6
    );

    // Create token accounts
    agentTokenAccount = await createAccount(
      provider.connection,
      payer.payer,
      mint,
      agent.publicKey
    );

    providerTokenAccount = await createAccount(
      provider.connection,
      payer.payer,
      mint,
      providerAuthority.publicKey
    );

    // Mint tokens to agent
    await mintTo(
      provider.connection,
      payer.payer,
      mint,
      agentTokenAccount,
      admin,
      10_000_000 // 10 USDC
    );

    // Derive PDAs
    [globalConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId
    );

    [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), agent.publicKey.toBuffer()],
      program.programId
    );

    [vaultTokenAccountPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_token_account"), agent.publicKey.toBuffer()],
      program.programId
    );

    [providerPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("provider"), providerAuthority.publicKey.toBuffer()],
      program.programId
    );
  });

  it("Initializes global config", async () => {
    const tx = await program.methods
      .initializeConfig(settleThreshold, feeBps)
      .accounts({
        admin: admin.publicKey,
        globalConfig: globalConfigPda,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([admin])
      .rpc();

    console.log("✅ GlobalConfig initialized:", tx);

    const config = await program.account.globalConfig.fetch(globalConfigPda);
    assert.ok(config.admin.equals(admin.publicKey));
    assert.equal(config.settleThreshold.toString(), settleThreshold.toString());
    assert.equal(config.feeBps, feeBps);
  });

  it("Registers a provider", async () => {
    const tx = await program.methods
      .registerProvider()
      .accounts({
        authority: providerAuthority.publicKey,
        provider: providerPda,
        destination: providerTokenAccount,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([providerAuthority])
      .rpc();

    console.log("✅ Provider registered:", tx);

    const provider = await program.account.provider.fetch(providerPda);
    assert.ok(provider.authority.equals(providerAuthority.publicKey));
    assert.ok(provider.destination.equals(providerTokenAccount));
  });

  it("Creates a vault with initial deposit", async () => {
    const tx = await program.methods
      .createVault(depositAmount)
      .accounts({
        agent: agent.publicKey,
        vault: vaultPda,
        vaultTokenAccount: vaultTokenAccountPda,
        agentTokenAccount: agentTokenAccount,
        tokenMint: mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([agent])
      .rpc();

    console.log("✅ Vault created:", tx);

    const vault = await program.account.vault.fetch(vaultPda);
    assert.ok(vault.agent.equals(agent.publicKey));
    assert.ok(vault.tokenMint.equals(mint));
    assert.equal(vault.depositAmount.toString(), depositAmount.toString());
    assert.equal(vault.totalSettled.toString(), "0");
    assert.equal(vault.nonce.toString(), "0");

    // Check token balance
    const vaultTokenAccountInfo = await getAccount(
      provider.connection,
      vaultTokenAccountPda
    );
    assert.equal(
      vaultTokenAccountInfo.amount.toString(),
      depositAmount.toString()
    );
  });

  it("Settles a batch with ed25519 signature", async () => {
    const settleAmount = new BN(350_000); // 0.35 USDC
    const nonce = new BN(1);

    // Build canonical message
    const message = Buffer.concat([
      Buffer.from("X402_FLOW_SETTLE"),
      vaultPda.toBuffer(),
      providerPda.toBuffer(),
      settleAmount.toArrayLike(Buffer, "le", 8),
      nonce.toArrayLike(Buffer, "le", 8),
    ]);

    // Sign with tweetnacl (CommonJS compatible)
    const signature = nacl.sign.detached(message, agent.secretKey);
    const publicKey = agent.publicKey.toBytes();

    // Create ed25519 instruction
    const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
      publicKey,
      message,
      signature,
    });

    // Create settle_batch instruction
    const settleBatchIx = await program.methods
      .settleBatch(settleAmount, nonce)
      .accounts({
        facilitator: facilitator.publicKey,
        agent: agent.publicKey,
        vault: vaultPda,
        vaultTokenAccount: vaultTokenAccountPda,
        globalConfig: globalConfigPda,
        provider: providerPda,
        destination: providerTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      } as any)
      .instruction();

    // Combine into single transaction
    const tx = new Transaction().add(ed25519Ix).add(settleBatchIx);

    const txSig = await provider.sendAndConfirm(tx, [facilitator]);
    console.log("✅ Settlement executed:", txSig);

    // Verify vault state
    const vault = await program.account.vault.fetch(vaultPda);
    assert.equal(vault.totalSettled.toString(), settleAmount.toString());
    assert.equal(vault.nonce.toString(), nonce.toString());

    // Verify provider received tokens
    const providerBalance = await getAccount(
      provider.connection,
      providerTokenAccount
    );
    assert.equal(providerBalance.amount.toString(), settleAmount.toString());
  });

  it("Withdraws remaining funds", async () => {
    const vaultBefore = await program.account.vault.fetch(vaultPda);
    const remainingAmount = vaultBefore.depositAmount.sub(
      vaultBefore.totalSettled
    );

    const tx = await program.methods
      .withdraw()
      .accounts({
        agent: agent.publicKey,
        vault: vaultPda,
        vaultTokenAccount: vaultTokenAccountPda,
        agentTokenAccount: agentTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      } as any)
      .signers([agent])
      .rpc();

    console.log("✅ Withdrawal executed:", tx);

    // Verify vault is closed
    try {
      await program.account.vault.fetch(vaultPda);
      assert.fail("Vault should be closed");
    } catch (err) {
      assert.ok(err.toString().includes("Account does not exist"));
    }

    // Verify agent received tokens back
    const agentBalance = await getAccount(
      provider.connection,
      agentTokenAccount
    );
    const expectedBalance = new BN(10_000_000)
      .sub(depositAmount)
      .add(remainingAmount);
    assert.equal(agentBalance.amount.toString(), expectedBalance.toString());
  });

  it("Tests emergency pause (admin only)", async () => {
    const tx = await program.methods
      .emergencyPause(true)
      .accounts({
        admin: admin.publicKey,
        globalConfig: globalConfigPda,
      } as any)
      .signers([admin])
      .rpc();

    console.log("✅ Emergency pause triggered:", tx);
  });
});