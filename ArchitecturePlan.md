## x402-Flash on Solana — Detailed (10-Day, Doable) Architecture (Corrected Settlement Flow)

Nice — here’s the full reduced, hackathon-friendly version of the architecture you asked for: same core idea (instant agent payments + batched on-chain settlement) but practical to build in 10 days. I kept it technical and precise so you can implement it immediately.

### Key constraints we follow:

- No Merkle batching / proof verifier (stretch goal).
    
- No complex dispute system — single on-chain FlowVault guarantees provider is paid when agent signs settle.
    
- Single centralized Facilitator (MCP server) for demo.
    
- Streaming ticks simulated (real streaming, but ticks aggregated off-chain).
    
- QUIC is optional — use WebSocket for MVP; upgrade to QUIC if time permits.
    

---

### 1 — High-level components (MVP)

- **FlowVault (Anchor program)** — on-chain escrow with minimal instructions: `create_vault`, `settle_batch`, `withdraw`.
    
- **FlashFlow Facilitator (single node)** — off-chain server: accepts agent connections (WebSocket/QUIC), validates vault existence, streams data instantly, tracks per-agent tab, calls `settle_batch` when threshold hit.
    
- **Flash SDK (TypeScript)** — client helper: create vault, connect to facilitator, stream data, auto-sign settlement messages.
    
- **Provider (API)** — streaming/data server that responds instantly upon facilitator validation.
    
- **Dashboard / CLI logs** for demo: show vault creation, live packets/sec, pending tab, on-chain settlement tx.
    

---

### 2 — Why this variant wins the hackathon

- **Flawless demo**: one short on-chain tx for vault creation + instant high-rate streaming + 1 on-chain `settle_batch` at demo end. Judges see real Solana txs + instant UX.
    
- **Safe & auditable**: FlowVault enforces the settlement transfer; single signed `settle_batch` authorizes transfer.
    
- **Small surface area**: less time spent on cryptography and dispute edge cases; more time polishing UX and reliability.
    

---

### 3 — FlowVault (Anchor) — on-chain design (detailed)

Program name: `flow_vault`

#### Accounts / PDAs

- **GlobalConfig** (`["config"]`): admin pubkey, `settle_threshold`, `fee_bps`, `relayer_pubkey` (optional).
    
- **Vault PDA** (`["vault", agent_pubkey]`): per-agent vault account storing deposit metadata.
    
    - Owner: program
        
    - Fields:
        
        - `agent_pubkey`: Pubkey (32)
            
        - `token_mint`: Pubkey
            
        - `vault_token_account`: Pubkey (SPL token account owned by program)
            
        - `deposit_amount_u64`: u64 (micro-USDC / lamports)
            
        - `total_settled_u64`: u64
            
        - `last_settlement_slot`: u64
            
        - `nonce_u64`: u64 (optional; monotonic counter)
            
- **ServerAccount** (`["server", server_pubkey]`): optionally store provider metadata & withdraw destination.
    

#### Instruction set (minimal)

- `create_vault(agent, deposit_amount)`
    
    - Purpose: create Vault PDA and deposit tokens.
        
    - Flow: Client calls, transfers `deposit_amount` USDC via CPI into vault token account (program-owned). Program initializes Vault PDA with `deposit_amount` and `total_settled = 0`.
        
    - Checks: agent signature, sufficient transfer.
        
- `settle_batch(agent_pubkey, server_pubkey, amount_u64, nonce_u64, agent_sig)`
    
    - Purpose: move `amount_u64` from vault → server (SPL transfer) once authorized.
        
    - **Auth model**: the agent must sign a canonical message authorizing `amount_u64`, `server_pubkey`, `nonce_u64`. That signature (`agent_sig`) is passed into the instruction. The program verifies `agent_sig` matches `agent_pubkey`.
        
    - Flow:
        
        1. Verify Vault exists and `deposit_amount − total_settled >= amount_u64`.
            
        2. Verify `agent_sig` is valid for message `Settle || vault_pubkey || server_pubkey || amount_u64 || nonce_u64`.
            
        3. Perform CPI transfer of `amount_u64` from `vault_token_account` → `server_token_account`.
            
        4. Update `total_settled += amount_u64`, `last_settlement_slot = current_slot`, `nonce_u64++` (or set to nonce_u64).
            
        5. Emit Settlement event.
            
    - Why secure: Program only transfers if agent authorized amount; Facilitator cannot pull funds without that signature.
        
- `withdraw(agent)`
    
    - Purpose: withdraw remaining funds (`deposit_amount − total_settled`).
        
    - Checks: agent signature. Optionally require no active streaming session (for demo you may skip this check).
        

#### Data layout (Vault struct pseudo-Rust)

`#[account] pub struct Vault {   pub agent: Pubkey,   pub token_mint: Pubkey,   pub vault_token_account: Pubkey,   pub deposit_amount: u64,   pub total_settled: u64,   pub last_settlement_slot: u64,   pub nonce: u64, }`

#### Canonical message format for agent signature

`"X402_FLOW_SETTLE" || vault_pubkey || server_pubkey || amount_u64 || nonce_u64 || chain_id`

- Use deterministic serialization (Borsh or fixed-width bytes).
    

---

### 4 — Facilitator (off-chain) — design & responsibilities

Language: Rust (axum/quinn) or Node.js (Hono/Express + ws/quic). Node.js is quicker for hackathon.

#### Core responsibilities

- **Session management**  
    Accept client connections (WebSocket or QUIC). Validate client wallet → check Vault PDA exists (RPC `getAccount`). Start streaming when valid.
    
- **Tab tracking**  
    For each agent: maintain `{ agent, server, deposited, spent_offchain, pending_settle }`.  
    On each tick or request: `spent_offchain += price_per_tick` or `spent_offchain += price_per_request`.
    
- **Instant verification**  
    If `spent_offchain < deposit_amount`, stream continues immediately. If near limit, throttle or ask agent to top up.
    
- **Batch settlement**  
    When timer or threshold triggered (e.g., every 30s or when `spent_offchain − total_settled_on_chain ≥ settle_threshold`):
    
    1. Build message for agent to sign: `amount = spent_offchain − total_settled_on_chain`, `nonce = vault.nonce + 1` or facilitator-tracked nonce.
        
    2. Send sign request to agent SDK → receive `agent_sig`.
        
    3. Build transaction:
        
        - Pre-instruction: `ed25519_verify` (or use Anchor’s built-in) verifying `agent_sig` for message.
            
        - Instruction: `settle_batch` with args `(agent_pubkey, server_pubkey, amount, nonce, agent_sig)`.
            
    4. Submit transaction via Solana RPC.
        
    5. On success: update `total_settled_on_chain += amount`, reset `pending_settle`, continue streaming.
        
- **Provider forwarding (optional)**  
    Forward agent’s requests to API provider with header `X-402-Flash-Voucher` (for demo you can omit).
    
- **Logging & events**  
    Log packets/sec, tabs, settlement tx ids, agent connect/disconnect events.
    

#### Security model

- Facilitator never unilaterally transfers funds — on-chain program enforces that only an agent-signed `settle_batch` results in transfer.
    
- Facilitator tracks state but cannot steal funds.
    
- For demo: trust facilitator for streaming only.
    

---

### 5 — Flash SDK (TypeScript) — API & examples

Purpose: make agent code trivial to show the demo.

#### Core methods

`class FlashClient {   constructor({ wallet, facilitatorUrl, rpcUrl }) {}   async createVault(amount: number)     // calls Anchor to create vault + deposit   async connect()                       // opens websocket to facilitator, proves vault ownership (challenge sign)   async startStream(providerUrl: string, tickRate: number) // e.g., 1000 packets/sec   async signSettle(vaultPubkey: PublicKey, serverPubkey: PublicKey, amount: number, nonce: number): Promise<Uint8Array> // wallet.signMessage(...)   async withdraw()                     // calls Anchor withdraw }`

#### Example usage (demo script)

`const client = new FlashClient({ wallet, facilitatorUrl, rpcUrl }); await client.createVault(2_000_000);        // e.g., 2.0 USDC in micro-units await client.connect(); client.startStream("wss://provider.example.com/stream", 1000);  // 1000 packets/sec // Automatically every 30s: sign & send settle`

#### Implementation notes

- Use `@solana/web3.js` for Anchor / raw transactions.
    
- For signing: `wallet.signMessage(messageBytes)` returns signature.
    
- SDK sends signature to facilitator via WebSocket or REST endpoint (e.g., `/sign-settle`).
    
- Facilitator then builds & sends transaction.
    

---

### 6 — Voucher / Signature scheme (simple, demo-ready)

No Merkle. Use single cumulative voucher pattern.

#### Off-chain state only:

- Facilitator tracks `spent_offchain` for each agent.
    
- Periodically compute `amount_to_settle = spent_offchain − total_settled_on_chain`.
    

#### Agent signature:

- Agent signs canonical message:
    
    `"X402_FLOW_SETTLE" || vault_pubkey || server_pubkey || amount_to_settle || nonce`
    
- `nonce` ensures no replay: Anchor program must store `nonce` and enforce `nonce > previous_nonce`.
    

#### On-chain verification:

- In `settle_batch` instruction: verify `agent_sig` corresponds to the message & agent_pubkey via `ed25519_program`.
    
- Check `amount_to_settle ≤ deposit_amount − total_settled`.
    
- Perform token transfer.
    
- Update `total_settled` and `nonce`.
    

**Note**: This variant (Agent signs message, facilitator submits tx) means the agent does _not_ need to submit the tx themselves — facilitator can submit.  
This matches the corrected plan and gives the continuous streaming feel.

---

### 7 — Streaming ticks & aggregation (behavioral design)

- Choose tick size so total accumulated values are visible but small for demo. E.g., 1 micro-USDC per packet or 100 packets/sec = 0.0001 USDC/sec (or analogous in USDC decimals).
    
- Facilitator increments `spent_offchain` per packet/request.
    
- When `spent_offchain − total_settled_on_chain ≥ settle_threshold`, trigger settlement (agent signs, facilitator submits).
    
- During streaming, provider responds instantly; no waiting for on-chain confirmation.
    

---

### 8 — Sequence diagram (Mermaid) — simplified, demo-ready (corrected settlement flow)

`sequenceDiagram   participant Agent as Agent (Client)   participant SDK as Flash SDK   participant FAC as Facilitator (Off-chain)   participant PROVIDER as API Provider   participant SOL as Solana FlowVault Program    Agent->>SDK: createVault(deposit)   SDK->>SOL: create_vault tx (agent signs)   SOL-->>SDK: vault PDA created (tx confirmed)    Agent->>SDK: connect() (open ws)   SDK->>FAC: connect + prove vault ownership   FAC->>FAC: validate vault via RPC    loop streaming     Agent->>PROVIDER: data request (via FAC)  // e.g., 1000 req/s     PROVIDER-->>Agent: data packet (instant)     FAC->>FAC: increment spent_offchain   end    FAC->>SDK: request settle signature (every 30s or threshold)   SDK->>Agent: prompt wallet to sign message   Agent->>SDK: returns agent_sig   SDK->>FAC: send agent_sig   FAC->>SOL: submit settle_batch tx (facilitator signs)   SOL-->>FAC: settlement confirmed   FAC->>FAC: reset pending counters and continue streaming`

---

### 9 — Day-by-day implementation plan (actionable with exact deliverables)

|Day|Task|Deliverables|
|---|---|---|
|Day 1 (Nov 1)|Project scaffold|Mono-repo setup: `anchor/`, `packages/sdk/`, `packages/facilitator/`, `packages/provider/`, optional `ui/`; README + architecture diagram.|
|Day 2 (Nov 2)|Anchor basics|Implement `Vault` struct + `create_vault` instruction; local validator deployment; test create flow.|
|Day 3 (Nov 3)|FlowVault settle & withdraw|Implement `settle_batch` (agent signature model) + `withdraw`; write basic Anchor tests.|
|Day 4 (Nov 4)|Facilitator basic|Node.js server with WebSocket endpoint; RPC check for Vault existence; setup basic streaming endpoint.|
|Day 5 (Nov 5)|Provider streaming + SDK basics|Provider: simple WebSocket/HTTP server streaming dummy data. SDK: `createVault()`, `connect()` logic.|
|Day 6 (Nov 6)|Streaming + tab logic|Facilitator streams data, tracks spent_offchain; SDK `startStream()` sends continuous requests, console logs packets/sec and spent counter.|
|Day 7 (Nov 7)|Settlement orchestration|Facilitator triggers settlement when threshold hit; prompts agent SDK for signature; submits `settle_batch` tx; Anchor updates vault.|
|Day 8 (Nov 8)|Polish demo UX & logging|Create demo CLI or script: Terminal 1 (Anchor logs), Terminal 2 (Facilitator logs), Terminal 3 (SDK logs). Optional dashboard.|
|Day 9 (Nov 9)|Testing & edge cases|End-to-end on devnet: vault create → stream → settlement to provider SPL account. Simulate disconnect / reconnection.|
|Day 10 (Nov 10)|Record 3-minute demo, docs, submit|Film demo, write README, prepare hackathon submission.|

---

### 10 — Testing & monitoring (MVP)

**Tests:**

- Anchor unit tests: `create_vault`, `settle_batch`, `withdraw`.
    
- Integration test: local validator full flow (agent → streaming → settlement).
    
- Load test: simulate ~100–1000 req/sec streaming and ensure facilitator keeps pace.
    

**Monitoring:**

- Facilitator logs: `packets/sec`, `spent_offchain`, `next_settle_in`.
    
- On-chain: watch settlement tx signatures, vault balances.
    
- Dashboard could show live state for visual effect (optional).
    

---

### 11 — Security & attack surface (MVP-level mitigations)

**Considered threats:**

- **Facilitator steals funds** — prevented: program only transfers when agent signature provided.
    
- **Agent double-spends** — program enforces `deposit_amount − total_settled ≥ amount_to_settle`, and `nonce` helps prevent replay.
    
- **Provider lies about delivered data** — out of scope for demo; business trust suffices.
    

**Production notes (post-hackathon):**

- Add dispute windows, revocation, or Merkle batching for scale & fraud resistance.
    
- Add relayer multisig for root commits if moving to compression architecture.
    

---

### 12 — Demo script (what judges see)

**Terminal 1 (Anchor / devnet)**

`$ anchor logs Vault created: PDA = 8Ab…xYz, deposit = 2.0 USDC`

**Terminal 2 (Facilitator logs)**

`Agent connected: 7Kd…QwR Streaming: 1000 req/s Pending tab: 0.35 USDC Next settlement in: 8s … Requesting signature from agent… Signature received ✅ Submitting settlement tx… TxID: H9f… Settlement confirmed ✅ Streaming resumed…`

**Terminal 3 (Agent SDK / CLI)**

`> await client.createVault(2_000_000); > await client.connect(); > client.startStream("wss://provider.example.com/stream", 1000); Streaming started -> 1000 packets/sec Spent: 0.35 USDC`

**Optional Dashboard**

- Show vault deposit, live stream rate, settlement history, provider SPL balance increased.
    

**Narration for Judges:**  
Explain how the FlowVault on Solana ensures the provider gets paid only when the agent allows it, how the facilitator enables ultra-low-latency streaming while batching payments on-chain, and how this enables real-time agent-economic infrastructure.

---

### 13 — Folder structure & minimal code pointers

`/x402-flash-solana/ ├─ anchor/                 # Anchor program │   ├─ programs/flow_vault/ │   ├─ tests/ ├─ packages/ │   ├─ sdk/                 # TypeScript SDK │   ├─ facilitator/         # Node.js Hono/Express + ws │   ├─ provider/            # Demo streaming provider │   └─ ui/                  # Optional Next.js dashboard └─ scripts/    ├─ demo-create-vault.ts    ├─ demo-start-stream.ts    └─ demo-settle.ts`

**Anchor notes:**

- Use `#[derive(Accounts)]` in Anchor for `Vault`, `GlobalConfig`, etc.
    
- Use `#[account(...)]` macros for instructions.
    
- Use `require_signer` for facilitator submitting tx? Actually: facilitator is signer for transaction; agent signature verified via ed25519 or pre-instruction.
    
- Use `system_program` and `token_program` CPIs for transfers.
    

**TS SDK notes:**

- Use `@solana/web3.js` for connections, wallet, transaction building.
    
- Use `wallet.signMessage(messageBytes)` for agent signature.
    
- Use WebSocket (`ws` library) for streaming.
    

**Facilitator notes:**

- Use Node.js with `ws` for WebSocket server; maintain in-memory map of sessions.
    
- Use `@solana/web3.js` for RPC calls: `getAccountInfo`, `sendAndConfirmTransaction`.
    
- Have simple config for `settle_threshold` (e.g., 0.2 USDC).
    

---

### 14 — Stretch goals (only if you finish early)

- Replace WebSocket with QUIC for lower latency.
    
- Implement Merkle bucket compression & on-chain proof verification.
    
- Implement off-chain voucher signing with relayer-submitted verification (Option B).
    
- Add provider reputation & simple dispute window on-chain.



# x402-Flash on Solana — **Final (10-Day, Doable)** Architecture — _with Dynamic Priority Fee_

Perfect — I’ve updated the entire 10-day hackathon architecture to **include Gemini’s production-grade improvement**: dynamic priority fees (ComputeBudget) for every `settle_batch` transaction. That tiny addition makes your settlement tx _robust under congestion_ and gives you a big production-systems signal for judges.

Below is the full, ready-to-save architecture (unchanged MVP scope + the new improvement). It includes where to add the dynamic fee, short code examples (TS/Rust) for adding the compute budget instruction, and exact demo text/logs you can use.

---

# Key constraints (unchanged)

- No Merkle batching / proof verifier (stretch goal).
    
- No complex dispute system — single on-chain FlowVault guarantees provider is paid when agent signs settle.
    
- Single centralized Facilitator (MCP server) for demo.
    
- Streaming ticks simulated (real streaming, but ticks aggregated off-chain).
    
- QUIC optional — use WebSocket for MVP; upgrade to QUIC if time permits.
    
- **New:** dynamic priority fee (ComputeBudget) included in every settlement tx to ensure fast confirmation.
    

---

# 1 — High-level components (MVP)

- **FlowVault (Anchor program)** — on-chain escrow: `create_vault`, `settle_batch`, `withdraw`.
    
- **FlashFlow Facilitator (single node)** — off-chain server: connections, streaming, tab tracking, ask agent to sign off-chain message, submit `settle_batch` tx (with dynamic priority fee).
    
- **Flash SDK (TypeScript)** — client helper: create vault, connect, stream, sign settlement messages.
    
- **Provider (API)** — streaming/data server that responds instantly upon facilitator validation.
    
- **Dashboard / CLI logs** for demo: show vault creation, live packets/sec, pending tab, dynamic fee, on-chain settlement tx.
    

---

# 2 — Why this variant wins (concise)

- Flawless demo: create vault (1 short tx) → continuous stream (100–1000 req/s) → single batched settlement tx that lands fast even under load.
    
- Safe & auditable: FlowVault enforces transfers only when agent signed amount.
    
- Production polish: dynamic priority fees show judges you thought about reliability, not just “it works in dev”.
    

---

# 3 — FlowVault (Anchor) — on-chain design (detailed)

**Program name:** `flow_vault`

## Accounts / PDAs

- `GlobalConfig` (`["config"]`) — admin pubkey, `settle_threshold`, `fee_bps`, optional relayer keys.
    
- `Vault PDA` (`["vault", agent_pubkey]`) — per-agent vault:
    
    - `agent_pubkey: Pubkey`
        
    - `token_mint: Pubkey`
        
    - `vault_token_account: Pubkey` (SPL TA owned by program)
        
    - `deposit_amount_u64: u64` (micro-USDC)
        
    - `total_settled_u64: u64`
        
    - `last_settlement_slot: u64`
        
    - `nonce_u64: u64`
        
- `ServerAccount` (`["server", server_pubkey]`) — provider metadata / withdraw destination.
    

## Instructions (minimal)

### `create_vault(agent, deposit_amount)`

- Transfer tokens (CPI) into program-owned SPL TA, init Vault PDA with deposit.
    

### `settle_batch(agent_pubkey, server_pubkey, amount_u64, nonce_u64, agent_sig)`

- **Auth model:** facilitator submits tx; the program verifies `agent_sig` corresponds to canonical message:
    
    `"X402_FLOW_SETTLE" || vault_pubkey || server_pubkey || amount_u64 || nonce_u64 || chain_id`
    
- Steps:
    
    1. Check `deposit_amount - total_settled >= amount_u64`.
        
    2. Verify signature via `ed25519_program` pre-instruction (or ed25519 syscall).
        
    3. CPI transfer `amount_u64` from `vault_token_account` → `server_token_account`.
        
    4. Update `total_settled += amount_u64`, set `last_settlement_slot`, set `nonce = nonce_u64`.
        
    5. Emit `Settlement` event.
        

### `withdraw(agent)`

- Transfer remaining funds back to agent; optional active session checks.
    

## Vault struct (pseudo-Rust)

`#[account] pub struct Vault {   pub agent: Pubkey,   pub token_mint: Pubkey,   pub vault_token_account: Pubkey,   pub deposit_amount: u64,   pub total_settled: u64,   pub last_settlement_slot: u64,   pub nonce: u64, }`

---

# 4 — Facilitator (off-chain) — design & responsibilities (with dynamic fees)

Language: Node.js (fast for hackathon) or Rust. Node.js + `@solana/web3.js` recommended.

## Core responsibilities

1. **Session management**
    
    - Accept connections (WebSocket or QUIC). Validate client wallet and Vault PDA via RPC (`getAccountInfo`).
        
2. **Tab tracking**
    
    - Per-agent in memory (or Redis): `{ agent, server, deposit_amount, spent_offchain, total_settled_on_chain, pending_settle }`.
        
3. **Instant verification**
    
    - Allow streaming if `spent_offchain < deposit_amount`.
        
4. **Batch settlement (enhanced with dynamic priority fee)**
    
    - Trigger conditions: every N seconds OR when `spent_offchain - total_settled_on_chain >= settle_threshold`.
        
    - Steps:
        
        1. Compute `amount = spent_offchain - total_settled_on_chain`, set `nonce = vault.nonce + 1`.
            
        2. Build canonical message and send to SDK: agent signs via `wallet.signMessage(message)`.
            
        3. Receive `agent_sig` (raw Ed25519 signature bytes).
            
        4. **Fetch dynamic priority fee**:
            
            - Query an RPC provider (Helius / QuickNode) or use a simple heuristic (recent fee histogram) to choose `microLamports_per_CU`.
                
        5. Build transaction:
            
            - Pre-instruction: `ed25519_verify` for `agent_sig` (solana ed25519 program).
                
            - **ComputeBudget Instruction:** set compute unit price (`ComputeBudgetInstruction.set_compute_unit_price(micro_lamports)`), optionally set CU limit.
                
            - `settle_batch` instruction.
                
        6. Submit tx; `sendAndConfirmTransaction`.
            
        7. On success: update local `total_settled_on_chain += amount`, `pending_settle = 0`.
            
5. **Provider forwarding** (optional): attach voucher header `X-402-Flash-Voucher`.
    
6. **Logging & monitoring**: show dynamic fee chosen, tx id, confirmation, packets/sec, pending tab.
    

## Dynamic Priority Fee (where & why)

- Add a `ComputeBudgetInstruction.set_compute_unit_price(microLamports)` _before_ the main instruction instructions.
    
- Choose `microLamports` dynamically by querying an RPC endpoint for recent block compute cost or using a small multiplier (e.g., default 10_000 µLamports/CU). Lower when network idle, increase when busy.
    
- This improves txn propagation and reduces latency on congestion.
    

---

# 5 — Flash SDK (TypeScript) — API & examples

**Class:** `FlashClient`

**Core methods**

`class FlashClient {   constructor({ wallet, facilitatorUrl, rpcUrl }) {}   async createVault(amount: number)       // Anchor create_vault   async connect()                         // WS connect + challenge sign to prove vault control   async startStream(providerUrl, tickRate) // simulate 100–1000 pkts/sec   async signSettle(vaultPubkey, serverPubkey, amount, nonce) // wallet.signMessage(...)   async withdraw() }`

**Demo snippet**

`const client = new FlashClient({ wallet, facilitatorUrl, rpcUrl }); await client.createVault(2_000_000); // 2 USDC in micro units await client.connect(); client.startStream("wss://provider.example/stream", 1000);`

**Notes**

- Send signatures over WebSocket as `{"type":"settle_sig","vault":..., "nonce":..., "sig": base64(...)}`.
    
- Keep UX silent: signing is just `wallet.signMessage` (no tx popups). This preserves autonomy.
    

---

# 6 — Voucher / Signature scheme (simple & secure)

- Message to sign:
    
    `canonical = BorshEncode("X402_FLOW_SETTLE", vault_pubkey, server_pubkey, amount_u64, nonce_u64, chain_id)`
    
- Agent signs `canonical` via wallet (`signMessage` Ed25519). SDK sends signature to facilitator.
    
- Facilitator uses `ed25519_verify` as pre-instruction to ensure valid signature on-chain before `settle_batch`.
    
- Anchor checks `nonce` monotonicity and `amount` ≤ `deposit - total_settled`.
    

---

# 7 — Streaming ticks & aggregation

- Choose tick size visible for demo (e.g., 10–100 packets/sec at 1–10 micro-USDC each so totals are visible quickly).
    
- `spent_offchain += price_per_pkt` at facilitator on every packet.
    
- Settlement threshold: e.g., 0.2 USDC or every 30s.
    

---

# 8 — Sequence diagram (Mermaid) — final corrected flow with dynamic fee

`sequenceDiagram   participant Agent as Agent (Client)   participant SDK as Flash SDK   participant FAC as Facilitator (Off-chain)   participant PROVIDER as API Provider   participant SOL as Solana FlowVault Program    Agent->>SDK: createVault(deposit)   SDK->>SOL: create_vault tx (agent signs)   SOL-->>SDK: vault PDA created (tx confirmed)    Agent->>SDK: connect() (open ws)   SDK->>FAC: connect + prove vault ownership   FAC->>FAC: validate vault via RPC    loop streaming     Agent->>PROVIDER: data request (via FAC)    // e.g., 1000 req/s     PROVIDER-->>Agent: data packet (instant)     FAC->>FAC: increment spent_offchain   end    FAC->>SDK: request settle signature (every 30s or threshold)   SDK->>Agent: prompt wallet to sign message   Agent->>SDK: returns agent_sig   SDK->>FAC: send agent_sig   FAC->>FAC: query RPC for current priority fee   FAC->>SOL: submit settle_batch tx (pre-ix: ed25519_verify, pre-ix: ComputeBudget.set_compute_unit_price, instruction: settle_batch)   SOL-->>FAC: settlement confirmed   FAC->>FAC: reset pending counters and continue streaming`

---

# 9 — Day-by-day implementation plan (updated: add dynamic fee integration)

|Day|Task|Deliverables|
|---|---|---|
|Day 1 (Nov 1)|Scaffold repo|`anchor/`, `packages/sdk/`, `packages/facilitator/`, `packages/provider/`, README|
|Day 2 (Nov 2)|Anchor: `Vault` + `create_vault`|Local validator tests|
|Day 3 (Nov 3)|Anchor: `settle_batch` + `withdraw` (sig verification via ed25519 pre-ix)|Anchor unit tests|
|Day 4 (Nov 4)|Facilitator basic (WS + session mgmt)|RPC checks for Vault|
|Day 5 (Nov 5)|Provider + SDK basics|WS stream provider; SDK `createVault` & `connect`|
|Day 6 (Nov 6)|Streaming & tab logic|Facilitator counts spent_offchain; SDK `startStream()`|
|Day 7 (Nov 7)|Settlement orchestration + priority fee|Facilitator prompts signature, fetch dynamic fee, builds tx (ComputeBudget + ed25519 + settle_batch), submit|
|Day 8 (Nov 8)|Polish UX & logs|Terminal logs show dynamic fee, tx id, confirm time|
|Day 9 (Nov 9)|End-to-end devnet test & resilience|Simulate disconnects, load test 100–1000 req/s|
|Day10 (Nov10)|Record demo, finalize README, deploy|3-min video + submission assets|

---

# 10 — How to implement Dynamic Priority Fee — quick code examples

### TypeScript (`@solana/web3.js`) — building the tx with ComputeBudget

`import { Transaction, ComputeBudgetProgram } from "@solana/web3.js";  // 1) Create compute budget instruction (dynamic fee chosen earlier) const microLamports = await chooseDynamicFee(); // e.g., 10_000 const feeIx = ComputeBudgetProgram.setComputeUnitPrice({ microLamports });  // 2) ed25519 verify pre-instruction — create bytes according to ed25519 program format // you'll build the ed25519 verify instruction bytes (or use solana-web3 helper libs)  // 3) settle_batch_ix: your Anchor instruction built with Anchor's IDL or raw instruction  const tx = new Transaction(); tx.add(feeIx); tx.add(ed25519VerifyIx); // pre-ix verifying agent_sig for the message tx.add(settleBatchIx);  tx.recentBlockhash = (await connection.getRecentBlockhash()).blockhash; tx.feePayer = facilitatorKeypair.publicKey;  const signed = await facilitatorKeypair.signTransaction(tx); const txid = await connection.sendRawTransaction(signed.serialize()); await connection.confirmTransaction(txid, "confirmed");`

### Rust (programmatic builder) — compute budget instruction

`use solana_program::compute_budget::compute_budget_instruction::set_compute_unit_price; let fee_ix = set_compute_unit_price(10_000); // micro lamports // then build ed25519 pre-ix and your settle_batch ix, sign & send`

### How to pick `microLamports`

- Simple approach: call your RPC provider (Helius/QuickNode) for recent block stats or use a fixed conservative value like `10_000` µLamports/CU for demo.
    
- Polished approach: query recent transactions priority hints or use `getRecentPerformanceSamples` to detect congestion then scale.
    

---

# 11 — Monitoring & demo logs (include dynamic fee messages)

**Facilitator log example (for demo):**

`[Facilitator] Agent connected: 7Kd…QwR [Facilitator] Streaming: 1000 req/s [Facilitator] Pending tab: 0.35 USDC [Facilitator] Threshold reached → preparing settlement: 0.35 USDC [Facilitator] Querying RPC for priority fee... [Facilitator] Network load detected — setting compute unit price: 10,000 µLamports/CU [Facilitator] Submitting settlement tx (ed25519 pre-ix + compute budget + settle_batch)... [Facilitator] Tx submitted: H9f... (confirmed in 420ms) [Facilitator] Settlement complete — total_settled updated`

Show this exact log in your Terminal 2 — judges will notice.

---

# 12 — Security & production notes (MVP + one small polish)

- **Ed25519 verification**: use `ed25519_program` pre-instruction to ensure signature validity in the same tx (prevents race). Anchor has patterns for including pre-instructions.
    
- **Nonce**: always increment and persist on chain to avoid replay. Use the `nonce` field in Vault.
    
- **Priority fee limits**: cap the max microLamports to avoid runaway spend. Log chosen fee for audit.
    
- **Facilitator trust**: facilitator cannot withdraw on its own — program enforces agent signature. For production add multisig or relayer trust model later.
    

---

# 13 — Demo script (final, with dynamic fee lines)

**Terminal 1 — Anchor / devnet**

`$ anchor logs Vault created: PDA = 8Ab…xYz, deposit = 2.0 USDC`

**Terminal 2 — Facilitator logs**

`Agent connected: 7Kd…QwR Streaming: 1000 req/s Pending tab: 0.35 USDC Next settlement in: 8s Requesting agent signature... Signature received ✅ Querying RPC for dynamic priority fee... Setting compute unit price: 10,000 µLamports/CU Submitting settlement tx... TxID: H9f... Settlement confirmed ✅ (420 ms) Streaming resumed...`

**Terminal 3 — Agent SDK**

`> await client.createVault(2_000_000); > await client.connect(); > client.startStream("wss://provider.example.com/stream", 1000); Streaming started -> 1000 packets/sec Spent: 0.35 USDC`

Narration: mention the dynamic fee line — judges like the small production detail.

---

# 14 — Final checklist (essentials)

-  Anchor program deployed on devnet; `create_vault` works.
    
-  Provider streaming endpoint working (WebSocket).
    
-  Facilitator streams and tracks spent_offchain.
    
-  Agent signs off-chain message; facilitator submits `settle_batch` with ed25519 pre-ix and **ComputeBudget instruction**.
    
-  Demo script/logs ready, showing dynamic fee and confirmation times.



# Revised Architecture for Multi-Bounty Success
Here is the updated plan that integrates Phantom, Switchboard, Coinbase, Visa, and ATXP.

1. Phantom CASH Integration (Easy Win)
Strategy: Your program already uses a generic token_mint. We just need to ensure the system can be configured to use the Phantom CASH mint address instead of USDC.
On-Chain Changes (Anchor):
None. Your Vault struct is already generic over token_mint. This is perfect.
Off-Chain Changes (Facilitator/SDK):
The FlashSDK's createVault method will take an optional mint address.
Your demo will instantiate two vaults: one with USDC, one with CASH, to show it works with both.
Demo Narrative: "Our system is payment-agnostic. Here, we're creating a vault funded with Phantom CASH, showing how any SPL token can be used for high-speed micropayments."
2. Switchboard Oracle Integration (Elegant Enhancement)
Strategy: Replace the "query RPC for priority fee" step with a more robust Switchboard data feed that tracks network fees or congestion. This is a massive upgrade to your dynamic fee logic.
On-Chain Changes (Anchor):
The settle_batch instruction will now accept a Switchboard account to prove the fee data is recent and trusted. This prevents the facilitator from using stale data.

- **Off-Chain Changes (Facilitator):**
    
    - Instead of calling `getRecentPerformanceSamples` from the RPC, the facilitator will read the price from a Switchboard feed (e.g., a SOL/USD price feed, or a custom gas price feed).
    
- **Demo Narrative:** "To ensure our settlement transactions land instantly, we don't guess the priority fee. We use a decentralized **Switchboard oracle** to fetch real-time network congestion data, making our system robust even during peak traffic."

#### **3. Coinbase CDP Embedded Wallets (SDK-Level Integration)**

- **Strategy:** The "Agent" in your system is the perfect candidate for a Coinbase Embedded Wallet. This requires no on-chain changes, only client-side integration.
- **On-Chain Changes (Anchor):**
    - **None.** The program just sees a valid signer ([agent](vscode-file://vscode-app/opt/visual-studio-code/resources/app/out/vs/code/electron-browser/workbench/workbench.html)), it doesn't care how the keys are managed.
- **Off-Chain Changes (SDK/Demo App):**
    - Your demo UI/CLI will use the Coinbase Wallet SDK to create and manage the agent's wallet.
    - The [wallet.signMessage()](vscode-file://vscode-app/opt/visual-studio-code/resources/app/out/vs/code/electron-browser/workbench/workbench.html) call in your SDK will trigger the Coinbase wallet interface.
- **Demo Narrative:** "To make onboarding seamless for users, our agent is powered by a **Coinbase Embedded Wallet**. Users can create a vault and sign for settlements with a simple, familiar login, abstracting away complex key management."

#### **4. Visa TAP Compatibility (Metadata Integration)**

- **Strategy:** We make your providers "TAP-compatible" by adding Visa-specific metadata. This signals readiness for a deeper integration without requiring the full implementation.
- **On-Chain Changes (Anchor):**
    
    - Update the `Provider` account to include optional Visa metadata.
    - Emit this metadata in the `Settlement` event for off-chain indexers.

- **Off-Chain Changes (Facilitator):**
    - When settling, the facilitator reads the `visa_merchant_id` from the provider account and includes it in the emitted event.
- **Demo Narrative:** "Our protocol is designed for enterprise adoption. Providers can register a **Visa Trusted Agent Protocol (TAP) Merchant ID** on-chain. Every settlement event includes this ID, creating an auditable trail compatible with Visa's payment ecosystem."

#### **5. ATXP Multi-Protocol Adapter (Facilitator-Level Logic)**

- **Strategy:** Position your facilitator as a multi-protocol bridge. For certain providers, it can settle via ATXP instead of a direct SPL transfer. This is an off-chain routing decision.
- **On-Chain Changes (Anchor):**
    
    - Add a `protocol` enum to the `Provider` account.

- **Off-Chain Changes (Facilitator):**
    - The settlement logic now has a switch:
        - If [provider.protocol == NativeSpl](vscode-file://vscode-app/opt/visual-studio-code/resources/app/out/vs/code/electron-browser/workbench/workbench.html), it calls the `settle_batch` instruction as before.
        - If [provider.protocol == AtxpBridge](vscode-file://vscode-app/opt/visual-studio-code/resources/app/out/vs/code/electron-browser/workbench/workbench.html), it calls the ATXP API with the settlement details (agent, amount, etc.) instead of sending an on-chain transaction.
- **Demo Narrative:** "x402-Flash is also a bridge. For this provider, registered as a **Multi-Protocol Agent via ATXP**, our facilitator intelligently routes the payment through the ATXP network, demonstrating how we connect the Solana ecosystem to other payment standards."

---

### **Revised 10-Day Hackathon Plan**

**Day 1-2: Core Anchor (Bounty-Ready)**

- **Task:** Scaffold repo. Implement `GlobalConfig`, `Provider` (with Visa/ATXP fields), and `Vault`.
- **Deliverable:** `create_vault` and `register_provider` instructions working in tests.

**Day 3: Advanced Anchor (Bounty-Ready)**

- **Task:** Implement `settle_batch` (with Switchboard account placeholder) and [withdraw](vscode-file://vscode-app/opt/visual-studio-code/resources/app/out/vs/code/electron-browser/workbench/workbench.html). Finalize ed25519 signature verification.
- **Deliverable:** Full Anchor unit test suite passing for all instructions.

**Day 4-5: Facilitator & SDK Foundation**

- **Task:** Build basic Facilitator (WS, session management) and SDK ([createVault](vscode-file://vscode-app/opt/visual-studio-code/resources/app/out/vs/code/electron-browser/workbench/workbench.html), `connect`).
- **Deliverable:** Client can create a vault and connect to the facilitator.

**Day 6: Core Logic + Coinbase & Phantom Integration**

- **Task:** Implement streaming/tab logic in Facilitator. Integrate **Coinbase Embedded Wallet** into the SDK/demo app. Test [createVault](vscode-file://vscode-app/opt/visual-studio-code/resources/app/out/vs/code/electron-browser/workbench/workbench.html) with both USDC and **Phantom CASH**.
- **Deliverable:** A user with a Coinbase wallet can create a CASH-funded vault and stream data.

**Day 7: Settlement Orchestration + Switchboard**

- **Task:** Implement the full settlement flow. Facilitator requests signature. **Integrate Switchboard oracle** to read a data feed for the dynamic priority fee calculation.
- **Deliverable:** First successful end-to-end settlement on devnet using a fee derived from Switchboard.

**Day 8: Multi-Protocol Logic (ATXP & Visa)**

- **Task:** Implement the ATXP/Visa logic. Facilitator reads provider metadata. If ATXP, log "Routing to ATXP API". If Visa, ensure `visa_merchant_id` is logged.
- **Deliverable:** Demo logs clearly show the system handling different provider types.

**Day 9: Polish & Demo Prep**

- **Task:** Refine all terminal logs for the demo script. Ensure every bounty is explicitly mentioned in the output. Build a simple CLI or UI for the demo.
- **Deliverable:** End-to-end devnet test is flawless.

**Day 10: Record & Submit**

- **Task:** Record the 3-minute video, finalize the README, and submit.
- **Deliverable:** A winning submission that clearly demonstrates a powerful core product enhanced by five different sponsor technologies.