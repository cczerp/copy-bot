# Polygon Arbitrage Monitor & Simulator

**100% Legal Research-Grade DeFi Arbitrage Tool**

A comprehensive transaction monitoring and arbitrage simulation engine for Polygon mainnet. Detects cross-DEX price inefficiencies, oracle mispricings, and profitable trading opportunities using only public data streams and on-chain simulation.

## ⚖️ Compliance & Legality

This tool is **entirely compliant** with DeFi protocols, blockchain networks, and financial regulations:

### What It Does (✅ Legal & Ethical)
- **Monitor public transaction streams** from legal sources (bloXroute, Eden Network, Manifold Finance)
- **Simulate opportunities** using isolated fork environments (Tenderly, Anvil)
- **Detect market inefficiencies**: cross-DEX price divergence, oracle mispricings, liquidity imbalances
- **Execute only profitable, isolated trades** that create value without affecting other users
- **Use official transaction relays** with standard priority fees (no MEV extraction)
- **Maintain complete audit trail** for research transparency

### What It Never Does (🚫 Not Supported)
- **Frontrunning**: Never includes third-party pending transactions in execution
- **Sandwich attacks**: Never extracts MEV from user transactions
- **Price manipulation**: Only trades against genuine market inefficiencies
- **Oracle manipulation**: Operates independent of price oracle states
- **Exclusive order flow**: Uses only officially supported, transparent relays

## 🏗️ Architecture

### Core Components

```
src/
├── listeners/        # Transaction stream listeners (bloXroute, Eden, Manifold)
├── decoders/         # Calldata parsing and transaction analysis
├── analyzers/        # Pool state analysis and opportunity detection
├── simulator/        # Simulation engine (Tenderly/Anvil fork)
├── executor/         # Arbitrage execution (flashloans, swaps)
├── relays/           # Private relay bundle submission
├── safety/           # Safety checks and audit logging
└── types/            # Core type definitions
```

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- npm or yarn
- Polygon RPC endpoint
- Optional: Tenderly API for advanced simulation
- Optional: Executor wallet for execution mode

### Installation

```bash
npm install
npm run build
cp .env.example .env
# Edit .env with your configuration
```

### Running

```bash
# Development mode (hot reload)
npm run dev

# Production (dry run by default)
npm start

# With execution enabled
ENABLE_EXECUTION=true npm start
```

## 📊 Opportunity Types

1. **Cross-DEX Arbitrage**: Buy cheap on one DEX, sell expensive on another
2. **TWAP Oracle Arbitrage**: Exploit oracle lag with flashloans
3. **Triangular Cycles**: Multi-hop paths that profit from intermediate pricing
4. **JIT Liquidity**: Profit from liquidity provision mechanics

## 🛡️ Safety Mechanisms

✅ **Mandatory Simulation**: All opportunities simulated before submission
✅ **Revert-On-Deviation**: Built-in protection against sandwich attacks
✅ **Audit Trail**: Complete logging of all opportunities and executions
✅ **No Third-Party Impact**: Never sandwiches or frontuns other users
✅ **Official Relays Only**: Uses Manifold, Eden, or transparent relays

## 💰 Profitability Requirements

- Minimum profit: 0.8% after all costs (gas, flashloan fees)
- Maximum slippage: 1% on swaps
- All opportunities simulated before execution

## 📈 Configuration

See `.env.example` for all configuration options:
- `MIN_PROFIT_BPS`: Minimum profit threshold (80 = 0.8%)
- `MAX_SLIPPAGE_BPS`: Maximum slippage tolerance (100 = 1%)
- `ENABLE_EXECUTION`: Set to `true` only after thorough testing
- `BUNDLE_RELAY_TYPE`: Choice of `manifold`, `eden`, or `custom`

## 📚 Documentation

- Full API documentation in `src/types/`
- Configuration guide in `.env.example`
- Safety mechanisms detailed in `src/safety/`
- Audit trail written to `logs/audit.json`

## 📜 License

MIT

---

**Important**: This is research software for academic purposes. Always test on testnets first. Full compliance with DeFi protocols is required. Never sandwich or frontrun other users.
