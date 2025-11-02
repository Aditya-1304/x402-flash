import * as anchor from "@coral-xyz/anchor";
import { Program, BN, AnchorError } from "@coral-xyz/anchor";
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


async function assertRejects(
  promise: Promise<any>,
  errorCode: string,
  message?: string
) {
  try {
    await promise;
    assert.fail(
      `Expected promise to reject with ${errorCode}, but it succeeded.`
    );
  } catch (err) {

    if (err instanceof AnchorError) {
      assert.strictEqual(
        err.error.errorCode.code,
        errorCode,
        message || `Expected error code ${errorCode}, but got ${err.error.errorCode.code}`
      );
    }
    else if (err.logs || err.transactionLogs) {
      const logs = err.logs || err.transactionLogs;

      const errorLine = logs.find((log: string) => log.includes("Error Code:"));
      if (errorLine) {
        const match = errorLine.match(/Error Code: (\w+)\./);
        if (match && match[1]) {
          assert.strictEqual(
            match[1],
            errorCode,
            message || `Expected error code ${errorCode}, but got ${match[1]}`
          );
          return;
        }
      }

      const txErrorLine = err.message || err.transactionMessage || "";
      const txMatch = txErrorLine.match(/custom program error: 0x(\w+)/);
      if (txMatch && txMatch[1]) {
        if (txMatch[1] === "2" && errorCode === "InvalidSignature") {
          assert.ok(
            true,
            "Correctly failed in ed25519 program (0x2) as expected for invalid signature"
          );
          return;
        }
      }

      if (err.message && err.message.includes(errorCode)) {
        assert.ok(true, `Correctly failed with constraint: ${errorCode}`);
        return;
      }

      console.error("Could not parse error code from logs:", logs);
      assert.fail("Could not parse Anchor error code from logs.");
    }
    else {
      console.error(err);
      assert.fail(`Expected AnchorError, but got ${err.constructor.name}`);
    }
  }
}

describe("flow-vault", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.FlowVault as Program<FlowVault>;
  const payer = provider.wallet as anchor.Wallet;

  // Helper for the PaymentProtocol enum
  const paymentProtocol = {
    nativeSpl: { nativeSpl: {} },
    atxpBridge: { atxpBridge: {} },
  };

  let mint: PublicKey;
  let admin: Keypair;
  let agent: Keypair;
  let facilitator: Keypair;
  let providerAuthority: Keypair;
  let randomUser: Keypair;

  let agentTokenAccount: PublicKey;
  let providerTokenAccount: PublicKey;
  let randomUserTokenAccount: PublicKey;

  let globalConfigPda: PublicKey;
  let vaultPda: PublicKey;
  let vaultTokenAccountPda: PublicKey;
  let providerPda: PublicKey;

  const settleThreshold = new BN(100_000); // This value is now set on-chain
  const feeBps = 100;
  const depositAmount = new BN(2_000_000);
  const visaMerchantId = "visa-merchant-x402";

  before(async () => {

    admin = Keypair.generate();
    agent = Keypair.generate();
    facilitator = Keypair.generate();
    providerAuthority = Keypair.generate();
    randomUser = Keypair.generate();

    const airdropSigs = await Promise.all([
      provider.connection.requestAirdrop(admin.publicKey, 5e9),
      provider.connection.requestAirdrop(agent.publicKey, 5e9),
      provider.connection.requestAirdrop(facilitator.publicKey, 2e9),
      provider.connection.requestAirdrop(providerAuthority.publicKey, 2e9),
      provider.connection.requestAirdrop(randomUser.publicKey, 2e9),
    ]);

    await Promise.all(
      airdropSigs.map((sig) =>
        provider.connection.confirmTransaction(sig, "confirmed")
      )
    );

    mint = await createMint(
      provider.connection,
      payer.payer,
      admin.publicKey,
      null,
      6
    );

    [agentTokenAccount, providerTokenAccount, randomUserTokenAccount] =
      await Promise.all([
        createAccount(provider.connection, payer.payer, mint, agent.publicKey),
        createAccount(
          provider.connection,
          payer.payer,
          mint,
          providerAuthority.publicKey
        ),
        createAccount(
          provider.connection,
          payer.payer,
          mint,
          randomUser.publicKey
        ),
      ]);


    await mintTo(
      provider.connection,
      payer.payer,
      mint,
      agentTokenAccount,
      admin,
      10_000_000
    );


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


    await program.methods
      .initializeConfig(settleThreshold, feeBps) // Updated: settleThreshold removed
      .accounts({
        admin: admin.publicKey,
        globalConfig: globalConfigPda,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([admin])
      .rpc();

    await program.methods
      // Updated: new arguments for bounty features
      .registerProvider(visaMerchantId, paymentProtocol.nativeSpl)
      .accounts({
        authority: providerAuthority.publicKey,
        provider: providerPda,
        destination: providerTokenAccount,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([providerAuthority])
      .rpc();

    await program.methods
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
  });

  describe("Initialization Tests", () => {
    it("Initializes global config correctly", async () => {
      const config = await program.account.globalConfig.fetch(globalConfigPda);
      assert.ok(config.admin.equals(admin.publicKey));
      // Assuming the on-chain program now sets a default/constant settle_threshold
      assert.equal(
        config.settleThreshold.toString(),
        settleThreshold.toString()
      );
      assert.equal(config.feeBps, feeBps);
      console.log("✅ GlobalConfig verified");
    });

    it("Registers provider correctly with bounty data", async () => {
      const providerAccount = await program.account.provider.fetch(providerPda);
      assert.ok(providerAccount.authority.equals(providerAuthority.publicKey));
      assert.ok(providerAccount.destination.equals(providerTokenAccount));
      // Assert new bounty fields
      assert.equal(providerAccount.visaMerchantId, visaMerchantId);
      assert.deepStrictEqual(providerAccount.protocol, paymentProtocol.nativeSpl);
      console.log("✅ Provider registered with bounty data");
    });

    it("Creates vault with initial deposit correctly", async () => {
      const vault = await program.account.vault.fetch(vaultPda);
      assert.ok(vault.agent.equals(agent.publicKey));
      assert.ok(vault.tokenMint.equals(mint));
      assert.equal(vault.depositAmount.toString(), depositAmount.toString());
      assert.equal(vault.totalSettled.toString(), "0");
      assert.equal(vault.nonce.toString(), "0");

      const vaultTokenAccountInfo = await getAccount(
        provider.connection,
        vaultTokenAccountPda
      );
      assert.equal(
        vaultTokenAccountInfo.amount.toString(),
        depositAmount.toString()
      );
      console.log("✅ Vault created and funded");
    });
  });

  describe("Settlement Tests", () => {
    it("Settles first batch and emits correct event", async () => {
      const settleAmount = new BN(350_000);
      const nonce = new BN(1);

      const message = Buffer.concat([
        Buffer.from("X402_FLOW_SETTLE"),
        vaultPda.toBuffer(),
        providerPda.toBuffer(),
        settleAmount.toArrayLike(Buffer, "le", 8),
        nonce.toArrayLike(Buffer, "le", 8),
      ]);

      const signature = nacl.sign.detached(message, agent.secretKey);
      const publicKey = agent.publicKey.toBytes();

      const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
        publicKey,
        message,
        signature,
      });

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

      const tx = new Transaction().add(ed25519Ix).add(settleBatchIx);

      // Listen for the settlement event
      let listener = null;
      let [event, slot] = await new Promise<[any, number]>((resolve, reject) => {
        listener = program.addEventListener("settlement", (event, slot) => {
          resolve([event, slot]);
        });
        provider.sendAndConfirm(tx, [facilitator]).catch(reject);
      });
      await program.removeEventListener(listener);

      console.log("✅ Settlement 1 executed");

      // Assert event data
      assert.equal(event.amount.toString(), settleAmount.toString());
      assert.equal(event.nonce.toString(), nonce.toString());
      assert.ok(event.vault.equals(vaultPda));
      assert.equal(event.visaMerchantId, visaMerchantId);
      console.log("✅ Settlement event verified");

      // Assert on-chain state
      const vault = await program.account.vault.fetch(vaultPda);
      assert.equal(vault.totalSettled.toString(), settleAmount.toString());
      assert.equal(vault.nonce.toString(), nonce.toString());

      const providerBalance = await getAccount(
        provider.connection,
        providerTokenAccount
      );
      assert.equal(providerBalance.amount.toString(), settleAmount.toString());
      console.log("✅ On-chain state verified");
    });

    it("Settles second batch with incremented nonce", async () => {
      const settleAmount = new BN(200_000);
      const nonce = new BN(2);

      const message = Buffer.concat([
        Buffer.from("X402_FLOW_SETTLE"),
        vaultPda.toBuffer(),
        providerPda.toBuffer(),
        settleAmount.toArrayLike(Buffer, "le", 8),
        nonce.toArrayLike(Buffer, "le", 8),
      ]);

      const signature = nacl.sign.detached(message, agent.secretKey);
      const publicKey = agent.publicKey.toBytes();

      const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
        publicKey,
        message,
        signature,
      });

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

      const tx = new Transaction().add(ed25519Ix).add(settleBatchIx);
      const txSig = await provider.sendAndConfirm(tx, [facilitator]);
      console.log("✅ Settlement 2 executed:", txSig);

      const vault = await program.account.vault.fetch(vaultPda);
      const expectedTotal = new BN(350_000).add(new BN(200_000));
      assert.equal(vault.totalSettled.toString(), expectedTotal.toString());
      assert.equal(vault.nonce.toString(), nonce.toString());
    });

    it("Settles third batch at threshold minimum", async () => {
      const config = await program.account.globalConfig.fetch(globalConfigPda);
      const settleAmount = config.settleThreshold;
      const nonce = new BN(3);

      const message = Buffer.concat([
        Buffer.from("X402_FLOW_SETTLE"),
        vaultPda.toBuffer(),
        providerPda.toBuffer(),
        settleAmount.toArrayLike(Buffer, "le", 8),
        nonce.toArrayLike(Buffer, "le", 8),
      ]);

      const signature = nacl.sign.detached(message, agent.secretKey);
      const publicKey = agent.publicKey.toBytes();

      const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
        publicKey,
        message,
        signature,
      });

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

      const tx = new Transaction().add(ed25519Ix).add(settleBatchIx);
      const txSig = await provider.sendAndConfirm(tx, [facilitator]);
      console.log("✅ Settlement 3 executed (threshold):", txSig);

      const vault = await program.account.vault.fetch(vaultPda);
      assert.equal(vault.nonce.toString(), nonce.toString());
    });
  });

  describe("Security & Attack Prevention Tests", () => {
    it("Fails: Replay attack (same nonce)", async () => {
      const settleAmount = new BN(100_000);
      const nonce = new BN(3);
      const message = Buffer.concat([
        Buffer.from("X402_FLOW_SETTLE"),
        vaultPda.toBuffer(),
        providerPda.toBuffer(),
        settleAmount.toArrayLike(Buffer, "le", 8),
        nonce.toArrayLike(Buffer, "le", 8),
      ]);

      const signature = nacl.sign.detached(message, agent.secretKey);
      const publicKey = agent.publicKey.toBytes();

      const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
        publicKey,
        message,
        signature,
      });

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

      const tx = new Transaction().add(ed25519Ix).add(settleBatchIx);
      const promise = provider.sendAndConfirm(tx, [facilitator]);

      await assertRejects(
        promise,
        "InvalidNonce",
        "Should reject replay attack"
      );
      console.log("✅ Replay attack prevented");
    });

    it("Fails: Invalid signature (wrong signer)", async () => {
      const settleAmount = new BN(100_000);
      const nonce = new BN(4);

      const message = Buffer.concat([
        Buffer.from("X402_FLOW_SETTLE"),
        vaultPda.toBuffer(),
        providerPda.toBuffer(),
        settleAmount.toArrayLike(Buffer, "le", 8),
        nonce.toArrayLike(Buffer, "le", 8),
      ]);

      const signature = nacl.sign.detached(message, facilitator.secretKey);
      const publicKey = agent.publicKey.toBytes();

      const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
        publicKey,
        message,
        signature,
      });

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

      const tx = new Transaction().add(ed25519Ix).add(settleBatchIx);
      const promise = provider.sendAndConfirm(tx, [facilitator]);

      await assertRejects(
        promise,
        "InvalidSignature",
        "Should reject invalid signature"
      );
      console.log("✅ Invalid signature rejected");
    });

    it("Fails: Insufficient funds", async () => {
      const vault = await program.account.vault.fetch(vaultPda);
      const remainingBalance = vault.depositAmount.sub(vault.totalSettled);
      const settleAmount = remainingBalance.add(new BN(1));
      const nonce = new BN(4);

      const message = Buffer.concat([
        Buffer.from("X402_FLOW_SETTLE"),
        vaultPda.toBuffer(),
        providerPda.toBuffer(),
        settleAmount.toArrayLike(Buffer, "le", 8),
        nonce.toArrayLike(Buffer, "le", 8),
      ]);

      const signature = nacl.sign.detached(message, agent.secretKey);
      const publicKey = agent.publicKey.toBytes();

      const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
        publicKey,
        message,
        signature,
      });

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

      const tx = new Transaction().add(ed25519Ix).add(settleBatchIx);
      const promise = provider.sendAndConfirm(tx, [facilitator]);

      await assertRejects(
        promise,
        "InsufficientFunds",
        "Should reject overdraft"
      );
      console.log("✅ Overdraft prevented");
    });

    it("Fails: Settlement below threshold", async () => {
      const config = await program.account.globalConfig.fetch(globalConfigPda);
      const settleAmount = config.settleThreshold.sub(new BN(1));
      const nonce = new BN(4);

      const message = Buffer.concat([
        Buffer.from("X402_FLOW_SETTLE"),
        vaultPda.toBuffer(),
        providerPda.toBuffer(),
        settleAmount.toArrayLike(Buffer, "le", 8),
        nonce.toArrayLike(Buffer, "le", 8),
      ]);

      const signature = nacl.sign.detached(message, agent.secretKey);
      const publicKey = agent.publicKey.toBytes();

      const ed25519Ix = Ed25519Program.createInstructionWithPublicKey({
        publicKey,
        message,
        signature,
      });

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

      const tx = new Transaction().add(ed25519Ix).add(settleBatchIx);
      const promise = provider.sendAndConfirm(tx, [facilitator]);

      await assertRejects(
        promise,
        "ZeroAmount",
        "Should reject amount below threshold"
      );
      console.log("✅ Below threshold rejected");
    });
  });

  describe("Withdrawal Tests", () => {
    it("Fails: Wrong user tries to withdraw", async () => {
      const promise = program.methods
        .withdraw()
        .accounts({
          agent: randomUser.publicKey,
          vault: vaultPda,
          vaultTokenAccount: vaultTokenAccountPda,
          agentTokenAccount: randomUserTokenAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
        } as any)
        .signers([randomUser])
        .rpc();

      await assertRejects(
        promise,
        "ConstraintSeeds",
        "Should reject unauthorized withdrawal"
      );
      console.log("✅ Unauthorized withdrawal prevented");
    });

    it("Withdraws remaining funds successfully", async () => {
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

      // Vault should be closed
      try {
        await program.account.vault.fetch(vaultPda);
        assert.fail("Vault should be closed");
      } catch (err) {
        assert.ok(err.toString().includes("Account does not exist"));
      }

      // Check final balance
      const agentBalance = await getAccount(
        provider.connection,
        agentTokenAccount
      );
      const expectedBalance = new BN(10_000_000)
        .sub(depositAmount)
        .add(remainingAmount);
      assert.equal(agentBalance.amount.toString(), expectedBalance.toString());
      console.log("✅ Final balance verified");
    });
  });

  describe("Admin Tests", () => {
    it("Fails: Non-admin tries emergency pause", async () => {
      const promise = program.methods
        .emergencyPause(true)
        .accounts({
          admin: agent.publicKey,
          globalConfig: globalConfigPda,
        } as any)
        .signers([agent])
        .rpc();

      await assertRejects(
        promise,
        "ConstraintHasOne",
        "Should reject non-admin pause"
      );
      console.log("✅ Non-admin pause rejected");
    });

    it("Admin triggers emergency pause successfully", async () => {
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
});