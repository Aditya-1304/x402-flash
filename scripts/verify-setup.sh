#!/bin/bash
# filepath: /home/aditya/Solana/Projects/x402-flash/scripts/verify-setup.sh

echo "🔍 Verifying x402-Flash Setup..."
echo ""

# 1. Check Node.js version
echo "📦 Checking Node.js..."
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "❌ Node.js 18+ required (found v$NODE_VERSION)"
  exit 1
fi
echo "✅ Node.js $(node -v)"
echo ""

# 2. Check Rust/Anchor
echo "🦀 Checking Rust/Anchor..."
if ! command -v anchor &> /dev/null; then
  echo "❌ Anchor not installed"
  exit 1
fi
echo "✅ Anchor $(anchor --version)"
echo ""

# 3. Check builds
echo "🏗️  Checking builds..."

if [ ! -d "packages/sdk/dist" ]; then
  echo "❌ SDK not built"
  echo "   Run: cd packages/sdk && npm run build"
  exit 1
fi
echo "✅ SDK built"

if [ ! -d "packages/facilitator/dist" ]; then
  echo "❌ Facilitator not built"
  echo "   Run: cd packages/facilitator && npm run build"
  exit 1
fi
echo "✅ Facilitator built"

if [ ! -f "anchor/target/deploy/flow_vault.so" ]; then
  echo "❌ Anchor program not built"
  echo "   Run: cd anchor && anchor build"
  exit 1
fi
echo "✅ Anchor program built"
echo ""

# 4. Check Redis (Docker or local)
echo "💾 Checking Redis..."

# First check if Docker container is running
if docker ps --format '{{.Names}}' | grep -q "x402-redis"; then
  # Container exists, check if it's healthy
  if docker exec x402-redis redis-cli ping > /dev/null 2>&1; then
    echo "✅ Redis running (Docker container: x402-redis)"
  else
    echo "⚠️  Redis container exists but not responding"
    echo "   Run: docker compose restart redis"
  fi
elif redis-cli ping > /dev/null 2>&1; then
  # Check local Redis
  echo "✅ Redis running (local instance)"
else
  echo "❌ Redis not running"
  echo "   Run: docker compose up -d redis"
  echo "   Or:  redis-server"
  exit 1
fi
echo ""

# 5. Check facilitator health
echo "🏥 Checking facilitator..."
HEALTH_RESPONSE=$(curl -s http://localhost:8080/health 2>/dev/null || echo "failed")
if [[ $HEALTH_RESPONSE == *"healthy"* ]]; then
  echo "✅ Facilitator healthy"
else
  echo "⚠️  Facilitator not running"
  echo "   Run: npm run dev:facilitator"
fi
echo ""

# 6. Check wallet setup
echo "👛 Checking wallets..."
if [ ! -f "$HOME/.config/solana/facilitator-keypair.json" ]; then
  echo "⚠️  Facilitator keypair not found"
  echo "   Run: solana-keygen new -o ~/.config/solana/facilitator-keypair.json"
else
  echo "✅ Facilitator keypair exists"
fi

if [ ! -f "$HOME/.config/solana/id.json" ]; then
  echo "⚠️  Admin keypair not found"
  echo "   Run: solana-keygen new"
else
  echo "✅ Admin keypair exists"
fi
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎉 Verification complete!"
echo ""
echo "✨ Ready to run:"
echo "   npm run example:phantom"
echo "   npm run example:x402"
echo "   npm run example:mcp"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"