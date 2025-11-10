# x402-Flash ⚡

**Autonomous AI Agent Payments on Solana**

Built for the [Solana x402 Hackathon](https://solana.com/hackathon) - A production-grade infrastructure for streaming micropayments with autonomous agent wallets.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Solana](https://img.shields.io/badge/Solana-Devnet-purple)](https://explorer.solana.com/?cluster=devnet)

---

## 🚀 **5-Minute Quick Start**

**New to x402-Flash?** → [**QUICKSTART.md**](./QUICKSTART.md)

---

## 🏆 Hackathon Bounties (All 5 Integrated!)

This project demonstrates **production-grade integration** of all five sponsor technologies:

| Bounty | Integration | Status |
|--------|-------------|--------|
| **🔮 Switchboard** | Dynamic priority fee optimization using SOL/USD oracle | ✅ Production |
| **🔐 Coinbase CDP** | Autonomous embedded wallets (no popups!) | ✅ Production |
| **💳 Visa TAP** | JWT-based merchant authentication | ✅ Production |
| **🌉 ATXP** | Cross-chain settlement bridge routing | ✅ Production |
| **💵 Phantom CASH** | Alternative payment token support | ✅ Production |

---

## 🎯 What is x402-Flash?

x402-Flash enables **AI agents to autonomously pay for streaming data** using the x402 protocol on Solana. Think HTTP 402 Payment Required, but for agents.

### Key Features

- ⚡ **Real-time Micropayments**: Pay-per-packet streaming with millisecond latency
- 🤖 **Autonomous Agents**: Zero-popup signing using Coinbase CDP wallets
- 📊 **Live Dashboard**: Real-time monitoring of sessions, settlements, and metrics
- 🔒 **Production-Grade**: Circuit breakers, Redis persistence, Prometheus metrics
- 🌐 **Cross-Chain Ready**: ATXP bridge integration for multi-chain settlements

---

## 🏗️ Architecture

```
┌─────────────────┐
│   AI Agent      │  ← Autonomous wallet (Coinbase CDP)
│   (CLI/SDK)     │  ← Signs without popups
└────────┬────────┘
         │ WebSocket
         │ x402 Protocol
         ▼
┌─────────────────┐      ┌──────────────┐
│  Facilitator    │◄────►│   Provider   │
│  (Settlement)   │ Auth │  (Data Feed) │
└────────┬────────┘      └──────────────┘
         │                       │
         │ Switchboard           │ Stream
         │ Oracle                │ Packets
         ▼                       ▼
┌─────────────────┐      ┌──────────────┐
│  Solana         │      │  Dashboard   │
│  (On-chain)     │      │  (Metrics)   │
└─────────────────┘      └──────────────┘
```

### Components

- **Agent (CLI)**: Autonomous consumer using CDP embedded wallets
- **Provider**: Streams data packets (market data, AI inference, sensor readings)
- **Facilitator**: Settlement engine with Switchboard fee optimization
- **Dashboard**: Real-time metrics and settlement tracking
- **On-chain**: Solana program for vault management and settlements

---

## 📦 Project Structure

```
x402-flash/
├── anchor/                 # Solana smart contract
│   └── programs/
│       └── flow-vault/     # On-chain settlement logic
├── packages/
│   ├── sdk/                # TypeScript SDK for agents
│   ├── cli/                # Command-line agent interface
│   ├── facilitator/        # Settlement engine + WebSocket server
│   ├── provider/           # Data streaming server
│   └── dashboard/          # Next.js live metrics dashboard
└── docker-compose.yml      # Redis + infrastructure
```

---

## 🛠️ Installation

### Prerequisites

- Node.js 18+
- Solana CLI
- Docker (for Redis)
- DevNet SOL (~0.5 SOL for testing)

### Setup

```bash
# Clone repository
git clone https://github.com/Aditya-1304/x402-flash
cd x402-flash

# Install dependencies
npm install

# Setup environment variables
cp packages/cli/.env.example packages/cli/.env
cp packages/facilitator/.env.example packages/facilitator/.env
cp packages/provider/.env.example packages/provider/.env
cp packages/dashboard/.env.example packages/dashboard/.env

# Start Redis
docker compose up -d

# Build SDK
cd packages/sdk && npm run build && cd ../..
```

---

## 🎮 Usage

### 1. Start Infrastructure

```bash
# Terminal 1: Facilitator
cd packages/facilitator
npm run dev

# Terminal 2: Provider
cd packages/provider
npm run dev

# Terminal 3: Dashboard
cd packages/dashboard
npm run dev
```

### 2. Create Agent Vault (with Coinbase CDP)

```bash
cd packages/cli

# Setup CDP credentials
mkdir -p ~/.coinbase
# Download API key from https://portal.cdp.coinbase.com
# Save to ~/.coinbase/cdp_api_key.json

# Create vault with autonomous wallet
npm run cli create-vault -- \
  --amount 1000000 \
  --cdp
```

### 3. Start Streaming

```bash
npm run cli stream -- \
  --vault <YOUR_VAULT_ADDRESS> \
  --provider ws://localhost:3001 \
  --cdp \
  --auto-settle
```

### 4. Monitor Dashboard

Open http://localhost:3000 to watch:
- 📊 Live packet metrics
- 💰 Real-time settlements
- 🔐 Autonomous payments (no popups!)

---

## 🔑 Bounty Deep Dives

### 1. Switchboard Oracle Integration

**Location**: `packages/facilitator/src/priority-fee-oracle.ts`

```typescript
// Dynamic fee calculation based on SOL/USD price
const solPrice = await this.fetchSolPrice(); // From Switchboard
const priorityFee = this.calculateOptimalFee(solPrice);
```

**Why it matters**: Optimizes transaction costs by adjusting priority fees based on real-time SOL price data.

---

### 2. Coinbase CDP Embedded Wallets

**Location**: `packages/cli/src/commands/create-vault.ts`

```typescript
// Create wallet that signs autonomously
const { Coinbase, Wallet } = await import('@coinbase/coinbase-sdk');
const cdpWallet = await Wallet.create({ networkId: 'solana-devnet' });
// Agent can now sign without user popups!
```

**Why it matters**: Enables true autonomous agents - no browser extensions, no popups, just pure automation.

---

### 3. Visa TAP Authentication

**Location**: `packages/facilitator/src/server.ts`

```typescript
// JWT-based merchant verification
jwt.verify(visaTapCredential, VISA_TAP_JWT_SECRET);
```

**Why it matters**: Production-ready merchant authentication for regulated payment flows.

---

### 4. ATXP Cross-Chain Bridge

**Location**: `packages/facilitator/src/bounties/atxp-bridge.ts`

```typescript
// Route settlement through ATXP for cross-chain
await settleViaAtxp(vaultPda, "ethereum", destAddress, amount);
```

**Why it matters**: Enables settlements to Ethereum, Base, or other chains via ATXP protocol.

---

### 5. Phantom CASH Token

**Location**: `packages/cli/src/commands/create-vault.ts`

```bash
# Use CASH instead of USDC
USE_CASH=true npm run cli create-vault -- --amount 1000000 --cdp
```

**Why it matters**: Supports Phantom's CASH token as an alternative payment method.

---

## 📊 Live Demo

**Video**: [Watch 3-min Demo](https://youtu.be/YOUR_VIDEO_LINK)

**Explorer**: [View On-Chain Vault](https://explorer.solana.com/address/YOUR_VAULT?cluster=devnet)

---

## 🧪 Testing

```bash
# Run all tests
npm test

# Test individual components
cd packages/sdk && npm test
cd packages/facilitator && npm test
```

---

## 📈 Production Deployment

### Mainnet Checklist

- [ ] Update RPC URLs to mainnet
- [ ] Use mainnet USDC mint: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- [ ] Configure production Redis (AWS ElastiCache, etc.)
- [ ] Setup Prometheus + Grafana for metrics
- [ ] Enable rate limiting on facilitator
- [ ] Deploy behind load balancer

### Environment Variables

```bash
# Mainnet
RPC_URL=https://api.mainnet-beta.solana.com
USDC_MINT_MAINNET=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
```

---

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

---

## 📄 License

MIT License - see [LICENSE](./LICENSE) for details.

---

## 🙏 Acknowledgments

Built with ❤️ for the Solana x402 Hackathon

**Sponsor Technologies:**
- [Switchboard](https://switchboard.xyz) - Decentralized oracles
- [Coinbase CDP](https://coinbase.com/cloud/platform) - Embedded wallets
- [Visa TAP](https://visa.com) - Payment authentication
- [ATXP](https://atxp.network) - Cross-chain bridge
- [Phantom](https://phantom.app) - CASH token

---

## 📞 Support

- **Issues**: [GitHub Issues](https://github.com/Aditya-1304/x402-flash/issues)

- **Twitter**: [@AdityaMandal_](#)

---


**Built for Solana x402 Hackathon 2025**

*Autonomous payments for the agent economy* 🚀