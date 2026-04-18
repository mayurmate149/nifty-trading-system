# 🎮 Nifty Trading Simulator

A standalone mock server that **fully simulates the 5paisa Xstream API** — both REST and WebSocket — so you can develop and test the trading app without a live brokerage connection.

## Features

| Feature | Description |
|---------|-------------|
| **REST API** | All 5paisa endpoints with exact same URL paths & response shapes |
| **WebSocket** | Live market tick stream at 1-second intervals |
| **Realistic Data** | Nifty/BankNifty spot with random walk, IV smile, theta decay |
| **Positions** | Pre-loaded Iron Condor (4 legs) with live P&L |
| **Order Execution** | Place/Modify/Cancel orders — instantly "executed" |
| **Margin Tracking** | Simulated margin with available/used breakdown |
| **OAuth Mock** | Fake SSO login that auto-redirects with a RequestToken |
| **Admin Panel** | Web UI to trigger scenarios in real-time |
| **Scenario Engine** | Price spikes, crashes, vol crush/expand, trend shifts |

## Quick Start

```bash
# 1. Install simulator dependencies
cd simulator
npm install

# 2. Start the simulator (port 9500)
npm run dev

# 3. In .env.local of the main app, set:
USE_SIMULATOR=true
SIMULATOR_URL=http://localhost:9500

# 4. Start your Next.js app (in a separate terminal)
cd ..
npm run dev
```

## Endpoints

### REST API (same as 5paisa)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/VendorsAPI/Service1.svc/GetAccessToken` | Exchange RequestToken for AccessToken |
| POST | `/VendorsAPI/Service1.svc/V1/NetPositionNetWise` | Get open positions |
| POST | `/VendorsAPI/Service1.svc/V2/OrderBook` | Get order history |
| POST | `/VendorsAPI/Service1.svc/V4/Margin` | Get margin details |
| POST | `/VendorsAPI/Service1.svc/V1/PlaceOrderRequest` | Place a new order |
| POST | `/VendorsAPI/Service1.svc/V1/ModifyOrderRequest` | Modify an order |
| POST | `/VendorsAPI/Service1.svc/V1/CancelOrderRequest` | Cancel an order |
| POST | `/VendorsAPI/Service1.svc/V2/MarketFeed` | Options chain data |
| GET  | `/VendorsAPI/Service1.svc/snapshot` | Market snapshot |

### WebSocket

Connect to `ws://localhost:9500/ws` to receive live ticks:

```json
{
  "type": "tick",
  "data": [
    { "symbol": "NIFTY", "ltp": 22513.45, "volume": 234567, "timestamp": 1713091200000 },
    { "symbol": "NIFTY 2025-04-17 22300 CE", "ltp": 215.50, "oi": 350000, ... }
  ]
}
```

Send subscribe message (optional, simulator broadcasts all by default):
```json
{ "type": "subscribe", "symbols": ["NIFTY", "BANKNIFTY"] }
```

### OAuth Mock

`GET /WebVendorLogin/VLogin/Index?VendorKey=xxx&ResponseURL=http://localhost:3000/auth/callback`

Instantly redirects to your callback with `?RequestToken=SIM_REQ_TOKEN_xxx`

### Admin Control Panel

Open **http://localhost:9500/admin** in your browser for a visual dashboard.

#### Scenario API

```bash
# Spike Nifty up 1%
curl -X POST http://localhost:9500/admin/scenario/spikeUp -H "Content-Type: application/json" -d '{"value": 1}'

# Crash down 2%
curl -X POST http://localhost:9500/admin/scenario/spikeDown -d '{"value": 2}'

# Set bullish trend
curl -X POST http://localhost:9500/admin/scenario/trendBullish

# Volatility crush
curl -X POST http://localhost:9500/admin/scenario/volCrush

# Set exact price
curl -X POST http://localhost:9500/admin/scenario/setPrice -d '{"value": 23000}'

# Speed up ticks (100ms between ticks)
curl -X POST http://localhost:9500/admin/scenario/setTickRate -d '{"value": 100}'

# Reset everything
curl -X POST http://localhost:9500/admin/scenario/reset
```

Available scenarios:
- `spikeUp` / `spikeDown` — instant price move by X%
- `trendBullish` / `trendBearish` / `trendNeutral` — set drift direction
- `volExpand` / `volCrush` / `volNormal` — change IV/VIX
- `fastForward` — simulate time decay (X hours)
- `setPrice` — set exact Nifty price
- `setTickRate` — change tick interval (ms)
- `reset` — reset everything to defaults

## Testing Scenarios

### 1. Auto-Exit Stop Loss Hit
```bash
# Set Nifty to a price that will trigger SL on your sold options
curl -X POST http://localhost:9500/admin/scenario/spikeUp -d '{"value": 3}'
```

### 2. Theta Decay (Expiry Simulation)
```bash
# Fast forward 12 hours
curl -X POST http://localhost:9500/admin/scenario/fastForward -d '{"value": 12}'
```

### 3. Volatility Crush (Post-Event)
```bash
curl -X POST http://localhost:9500/admin/scenario/volCrush
```

### 4. Trend Reversal
```bash
# Start bullish, then reverse
curl -X POST http://localhost:9500/admin/scenario/trendBullish
# Wait a few seconds, then...
curl -X POST http://localhost:9500/admin/scenario/trendBearish
```

## Switching Between Simulator & Live

In `.env.local`:

```bash
# Simulator mode
USE_SIMULATOR=true
SIMULATOR_URL=http://localhost:9500

# Live mode (comment out or set to false)
USE_SIMULATOR=false
```

No code changes needed — the broker-proxy and auth modules auto-detect the mode.

## Architecture

```
simulator/
├── server.js           # Main entry: Express + WebSocket + startup
├── data-generators.js  # Price engines, options pricing, strike generators
├── market-state.js     # Central state manager, positions, scenarios
├── api-routes.js       # 5paisa REST API mock endpoints
├── admin-routes.js     # Admin panel + scenario trigger routes
├── package.json        # Dependencies (express, ws, cors)
└── README.md           # This file
```
