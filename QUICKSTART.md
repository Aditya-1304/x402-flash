# x402-Flash Quick Start Guide

Get up and running with autonomous AI agent payments in **5 minutes**.

## Prerequisites

- Node.js 18+
- Solana CLI installed
- DevNet SOL (~0.5 SOL for testing)

## Step 1: Install Dependencies

```bash
# Clone and install
git clone https://github.com/Aditya-1304/x402-flash
cd x402-flash
npm install

# Setup environment
cp packages/cli/.env.example packages/cli/.env
cp packages/facilitator/.env.example packages/facilitator/.env
cp packages/provider/.env.example packages/provider/.env
```

## Step 2: Configure Coinbase CDP (Optional but Recommended)

```bash
# Get CDP credentials from https://portal.cdp.coinbase.com
mkdir -p ~/.coinbase
# Save your API key JSON to ~/.coinbase/cdp_api_key.json

# Update .env
echo "CDP_API_KEY_PATH=~/.coinbase/cdp_api_key.json" >> packages/cli/.env
```

## Step 3: Start the Infrastructure

```bash
# Terminal 1: Start Redis (required)
docker compose up

# Terminal 2: Start Facilitator
cd packages/facilitator
npm run dev

# Terminal 3: Start Provider
cd packages/provider
npm run dev

# Terminal 4: Start Dashboard
cd packages/dashboard
npm run dev
```

## Step 4: Create Your Agent Vault

### Option A: Using Coinbase CDP (Autonomous)
```bash
cd packages/cli
npm run cli create-vault -- \
  --amount 1000000 \
  --cdp
```

**💡 This creates a wallet that signs autonomously - no popups!**

### Option B: Using Local Wallet
```bash
# Generate a keypair
solana-keygen new -o agent-keypair.json

# Fund it with devnet SOL
solana airdrop 1 agent-keypair.json --url devnet

# Create vault
npm run cli create-vault -- \
  --amount 1000000 \
  --wallet agent-keypair.json
```

## Step 5: Start Streaming Data

```bash
npm run cli stream -- \
  --vault <YOUR_VAULT_ADDRESS> \
  --provider ws://localhost:3001 \
  --cdp \
  --auto-settle
```

## Step 6: Watch the Magic ✨

Open http://localhost:3000 to see:
- ⚡ Real-time packet streaming
- 💰 Automatic settlements (powered by Switchboard)
- 🔐 Zero-popup autonomous payments (Coinbase CDP)
- 🌍 Cross-chain ready (ATXP)
- 💳 Visa TAP merchant authentication

## Bounty Checklist

Your installation covers ALL 5 bounties:

- ✅ **Switchboard**: Dynamic priority fees based on SOL/USD
- ✅ **Coinbase CDP**: Autonomous embedded wallets
- ✅ **Visa TAP**: JWT merchant authentication
- ✅ **ATXP**: Cross-chain settlement routing
- ✅ **Phantom CASH**: Alternative payment token

## Troubleshooting

### "Vault has insufficient balance"
```bash
# Check your vault balance
npm run cli stats -- --vault <VAULT_ADDRESS>

# Top up if needed (send USDC to vault token account)
```

### "Connection refused to facilitator"
```bash
# Make sure Redis is running
docker ps | grep redis

# Check facilitator logs
cd packages/facilitator && npm run dev
```

### Dashboard shows no data
```bash
# Ensure all services are running
# Facilitator should log: "Dashboard observer connected"
# Provider should log: "Provider registered on-chain"
```

## Architecture Overview

```
┌─────────────┐      WebSocket       ┌──────────────┐
│   Agent     │◄────────────────────►│ Facilitator  │
│   (CLI)     │   Settlement Sigs    │  (Redis)     │
└─────────────┘                       └──────────────┘
       │                                     │
       │ x402 Protocol                       │ Switchboard
       │                                     │ Oracle
       ▼                                     ▼
┌─────────────┐                       ┌──────────────┐
│  Provider   │                       │   Solana     │
│  (Streams)  │                       │  (On-chain)  │
└─────────────┘                       └──────────────┘
       │
       │ WebSocket
       ▼
┌─────────────┐
│  Dashboard  │  ← You are here!
│ (localhost) │
└─────────────┘
```

## Next Steps

1. **Customize the Provider**: Edit `packages/provider/src/data-generator.ts` for your use case
2. **Deploy to Production**: Update RPC URLs and use mainnet tokens
3. **Scale with Clusters**: Run multiple facilitators behind a load balancer
4. **Monitor**: Export metrics to Prometheus/Grafana

## Support

- Discord: [Join our community]
- Issues: [GitHub Issues]
- Docs: [Full Documentation]

**Happy Building! 🚀**