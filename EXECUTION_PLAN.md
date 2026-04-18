# Nifty Trading Assistant — Phase‑Wise Execution Plan

> **Stack:** Node.js + Next.js (App Router) · 5paisa Xstream API · WebSocket · React Query  
> **Target:** Rule‑based options trading assistant for Nifty‑50 / BankNifty via 5paisa  
> **Estimated Timeline:** 10–12 weeks (solo dev) / 6–8 weeks (2‑person team)

---

## Phase 0 — Project Bootstrap & DevOps Foundation *(Week 1)*

### Objectives
- Repo, tooling, CI/CD, and local dev environment ready.

### Tasks
| # | Task | Details | Deliverable |
|---|------|---------|-------------|
| 0.1 | Init monorepo | `npx create-next-app@latest` with TypeScript, ESLint, Tailwind CSS, App Router. | Working Next.js shell |
| 0.2 | Folder structure | Create backend modules (`src/server/`), frontend pages (`src/app/`), shared types (`src/types/`). | Clean module layout |
| 0.3 | Environment config | `.env.local` for 5paisa keys (`APP_NAME`, `APP_SOURCE`, `USER_ID`, `PASSWORD`, `USER_KEY`, `ENCRYPTION_KEY`). `.env.example` committed. | Secure env setup |
| 0.4 | Database setup | JSON file-based storage for dev; swap to PostgreSQL for prod. Schema concepts: `users`, `sessions`, `positions_log`, `order_events`, `backtest_runs`. | `src/server/db/` |
| 0.5 | Logger | Configure `pino` (or `winston`) with daily rotation. | `src/server/logging/` |
| 0.6 | CI pipeline | GitHub Actions: lint → type‑check → test → build. | `.github/workflows/ci.yml` |
| 0.7 | Docker (optional) | `Dockerfile` + `docker-compose.yml` (app + postgres). | Containerized dev env |

### Exit Criteria
- `npm run dev` starts Next.js; `/` renders a placeholder page.
- Logger writes to console + file.

---

## Phase 1 — Auth & SSO with 5paisa *(Week 2)*

### Objectives
- User can sign in via 5paisa and the server securely holds the `accessToken`.

### Tasks
| # | Task | Details | Deliverable |
|---|------|---------|-------------|
| 1.1 | 5paisa OAuth flow | Redirect user to 5paisa login URL → capture `RequestToken` on callback. | `/login` page, `/auth/callback` route |
| 1.2 | Token exchange API | `POST /api/v1/auth/login` — server‑side call to 5paisa `GetAccessToken`. Store token in encrypted HTTP‑only cookie / server session. | `src/server/auth/` module |
| 1.3 | Session middleware | Verify token on every protected API route. Auto‑refresh or re‑auth if expired. | `src/server/middleware/auth.ts` |
| 1.4 | `/api/v1/auth/me` | Return `clientCode`, `name` from session. | Auth context on frontend |
| 1.5 | Frontend auth context | React Context + `useSession` hook. Redirect unauthenticated users to `/login`. | `src/app/providers/AuthProvider.tsx` |
| 1.6 | Logout | Clear session, revoke token. | `POST /api/v1/auth/logout` |

### API Contracts

```
POST /api/v1/auth/login
  → Req: { requestToken, redirectUri }
  → Res: { success, clientCode, expiresAt }
     (accessToken stored server-side only)

GET  /api/v1/auth/me
  → Res: { clientCode, name }
```

### Exit Criteria
- User clicks "Login with 5paisa" → redirected → comes back authenticated.
- `accessToken` is **never** in browser storage or client JS.

---

## Phase 2 — Broker Proxy & Positions *(Week 3)*

### Objectives
- Fetch and display live positions, order book, and margin from 5paisa.

### Tasks
| # | Task | Details | Deliverable |
|---|------|---------|-------------|
| 2.1 | Broker proxy module | Typed wrapper over 5paisa REST APIs: `getPositions`, `getOrderBook`, `getMargin`, `placeOrder`, `modifyOrder`, `cancelOrder`. | `src/server/broker-proxy/` |
| 2.2 | Position normalization | Map 5paisa response → internal `Position` type (see types below). Derivatives only. | `src/types/position.ts` |
| 2.3 | `GET /api/v1/positions` | Returns normalized positions with live P&L, capital deployed. | API route |
| 2.4 | Positions page | Table: symbol, strike, option type, qty, avg price, LTP, P&L (color‑coded), capital deployed. | `src/app/positions/page.tsx` |
| 2.5 | Live polling | `useQuery` with 2‑second refetch interval for positions. | Real‑time feel |
| 2.6 | Order placement helper | `POST /api/v1/orders/place` — pass‑through to broker with validation. | `src/server/broker-proxy/orders.ts` |

### Exit Criteria
- `/positions` shows real 5paisa derivatives positions with live LTP and P&L.

---

## Phase 3 — Market Data & WebSocket Feed *(Week 4)*

### Objectives
- Real‑time market data: spot price, VIX, options chain (OI, ΔOI, volume, IV).

### Tasks
| # | Task | Details | Deliverable |
|---|------|---------|-------------|
| 3.1 | Xstream WebSocket client | Connect to 5paisa Xstream WebSocket. Subscribe to Nifty, BankNifty spot + options instruments. | `src/server/market-data/ws-client.ts` |
| 3.2 | Data normalization layer | Parse binary/JSON frames → `MarketTick`, `OptionChainRow` types. | `src/types/market.ts` |
| 3.3 | In‑memory cache | Redis (or Map) for latest OI, LTP, volume per strike. TTL‑based eviction. | `src/server/market-data/cache.ts` |
| 3.4 | REST fallback for OHLC | `GET /api/v1/market/ohlc?symbol=NIFTY&interval=5m&days=5` — 5paisa historical data API. | `src/server/market-data/rest.ts` |
| 3.5 | Options chain API | `GET /api/v1/market/options-chain?symbol=NIFTY&expiry=2025-04-17` | API route |
| 3.6 | Indicators API | `GET /api/v1/market/indicators` → VIX, spot, support, resistance, trend label. | API route |
| 3.7 | SSE / WS to frontend | Server‑Sent Events endpoint or Next.js WebSocket relay so the UI gets ≤500 ms updates. | `src/server/market-data/sse.ts` |

### Exit Criteria
- Browser console shows OI / LTP ticks updating every ~500 ms.
- Options chain API returns full chain for a given expiry.

---

## Phase 4 — Analytics & Market Analysis UI *(Week 5)*

### Objectives
- Full analytics dashboard: options chain, VIX, S/R, PCR, trend label.

### Tasks
| # | Task | Details | Deliverable |
|---|------|---------|-------------|
| 4.1 | Options chain table | Calls on left, puts on right, strikes in center. Highlight max‑OI strikes. Color ΔOI (green = buildup, red = unwinding). | `src/app/analytics/page.tsx` |
| 4.2 | VIX + Spot widget | Large VIX number + Nifty/BankNifty spot with intraday mini‑chart (sparkline). | `src/components/MarketHeader.tsx` |
| 4.3 | Support / Resistance | Compute from last 5 days OHLC (pivot points). Display as horizontal lines on a mini price chart. | `src/server/market-data/support-resistance.ts` |
| 4.4 | PCR calculation | `totalPutOI / totalCallOI` per expiry. Display gauge. | `src/components/PCRGauge.tsx` |
| 4.5 | Trend label | Simple logic: spot > VWAP & rising MAs → "trend‑up"; spot < VWAP → "trend‑down"; else "range‑bound". | `src/server/market-data/trend.ts` |
| 4.6 | Tab layout | Tabs: Options Chain · Indicators · S/R Heatmap. | Analytics page layout |

### Exit Criteria
- `/analytics` shows a live, tabbed dashboard with options chain, VIX, S/R, PCR, trend.

---

## Phase 5 — Auto‑Exit Engine *(Week 6–7)*

### Objectives
- Per‑position trailing‑stop engine that auto‑exits on 1% loss or 2% profit.

### Tasks
| # | Task | Details | Deliverable |
|---|------|---------|-------------|
| 5.1 | Risk parameter model | Per position: `stopLossPercent`, `trailToBreakEvenAt`, `takeProfitPercent`, `currentSL`. | `src/types/risk.ts` |
| 5.2 | Auto‑exit engine loop | Background interval (1 s): for each watched position, fetch LTP, compute MTM P&L %, apply rules. | `src/server/risk/auto-exit-engine.ts` |
| 5.3 | Trailing SL logic | **Rule set:** <br>① If P&L ≤ −1% → EXIT (stop‑loss). <br>② If P&L ≥ +1% → move SL to breakeven (avg price). <br>③ If P&L ≥ +2% → EXIT (take‑profit). <br>④ Once SL is at breakeven and P&L dips to 0% → EXIT. | Core algorithm |
| 5.4 | Order execution | On exit trigger → call `broker-proxy.placeOrder()` (market order). Log event. | Integration |
| 5.5 | `POST /api/v1/positions/:id/auto-exit` | Enable / disable watching for a position. Returns `watchId`. | API route |
| 5.6 | Frontend toggle | "Auto‑Exit" button per position row. Shows SL/TP indicators, trail status. | `src/components/AutoExitToggle.tsx` |
| 5.7 | Risk dashboard | Total capital deployed, aggregate max loss, P&L waterfall. | `src/components/RiskDashboard.tsx` |
| 5.8 | Alert / notification | Toast notification on exit trigger. Optional: push notification / Telegram webhook. | `src/server/risk/notifier.ts` |

### Exit Criteria
- Enable auto‑exit on a test position → engine triggers exit at correct thresholds.
- All triggers are logged with timestamps.

---

## Phase 6 — Trade Suggestion Engine *(Week 7–8)*

### Objectives
- Rule‑based engine that suggests high‑probability options trades (confidence ≥70%).

### Tasks
| # | Task | Details | Deliverable |
|---|------|---------|-------------|
| 6.1 | Strategy definitions | Define entry/exit rules for: Iron Condor, Credit Spread, Directional Buy, Straddle, Strangle. | `src/server/engine/strategies/` |
| 6.2 | Scoring model | **Inputs:** OI buildup, ΔOI direction, PCR, IV percentile, trend label, S/R proximity. <br>**Output:** Confidence score 0–100. | `src/server/engine/scorer.ts` |
| 6.3 | Strike selector | For each strategy, pick optimal strikes based on: max OI, width from ATM, risk‑reward ratio. | `src/server/engine/strike-selector.ts` |
| 6.4 | `POST /api/v1/strategy/suggest` | Accept strategy type + risk params → return ranked suggestions with legs + confidence. | API route |
| 6.5 | Trade suggestions page | Strategy selector dropdown → cards showing suggested trades, legs, confidence bar, R:R ratio. | `src/app/trade-suggestions/page.tsx` |
| 6.6 | "Execute" button | One‑click to place all legs of a suggested trade via broker‑proxy. Confirmation modal. | UI + API integration |

### Scoring Rules (Example)

| Factor | Weight | Condition → Score |
|--------|--------|-------------------|
| OI Buildup (ΔOI > 10%) | 20 | Strong buildup on sell‑side strike → +20 |
| PCR (0.8–1.2 = neutral) | 15 | Neutral PCR for Iron Condor → +15 |
| IV Percentile < 50% | 15 | Low IV for buying strategies → +15 |
| Trend alignment | 20 | Trend‑up + bull call spread → +20 |
| S/R proximity | 15 | Strike near strong resistance (sell) → +15 |
| Volume confirmation | 15 | High volume at strike → +15 |

**Threshold:** confidence ≥ 70 → "High Probability"

### Exit Criteria
- `/trade-suggestions` shows ≥1 suggestion with confidence ≥70% for current market conditions.

---

## Phase 7 — Backtesting Engine *(Week 8–9)*

### Objectives
- Replay historical data against strategy rules; display performance metrics.

### Tasks
| # | Task | Details | Deliverable |
|---|------|---------|-------------|
| 7.1 | Historical data ingestion | Fetch and store daily OHLC + EOD options chain snapshots (OI, IV, volume) via 5paisa or NSE. | `src/server/backtest/data-loader.ts` |
| 7.2 | Backtest runner | For each trading day in range: <br>① Apply entry rules. <br>② Track open positions. <br>③ Apply exit rules (SL/TP/trailing). <br>④ Record trade result. | `src/server/backtest/runner.ts` |
| 7.3 | Metrics calculator | Win rate, avg return/trade, max drawdown, Sharpe‑approx, profit factor. | `src/server/backtest/metrics.ts` |
| 7.4 | `POST /api/v1/backtest/run` | Accept strategy + date range + params → return summary + trade list. | API route |
| 7.5 | Backtest UI | Parameter form (strategy, date range, width, SL%, TP%). Results table + equity‑curve chart (Plotly / Recharts). | `src/app/backtest/page.tsx` |
| 7.6 | Persist results | Save backtest runs to DB for comparison. | `backtest_runs` table |

### Exit Criteria
- User configures Iron Condor backtest for 3 months → sees win rate, drawdown, equity curve.

---

## Phase 8 — Logging, Monitoring & Error Handling *(Week 9–10)*

### Objectives
- Production‑grade observability: structured logs, error tracking, health checks.

### Tasks
| # | Task | Details | Deliverable |
|---|------|---------|-------------|
| 8.1 | Structured logging | Every API call, order trigger, exit event, error → `pino` JSON logs. | `src/server/logging/logger.ts` |
| 8.2 | `POST /api/v1/logs/event` | Client‑side error reporting endpoint. | API route |
| 8.3 | Health check | `GET /api/v1/health` → DB ping, 5paisa API ping, WebSocket status. | Health endpoint |
| 8.4 | Error boundaries | React error boundaries on every page. Global API error handler (Node). | `src/app/error.tsx`, `src/server/middleware/error.ts` |
| 8.5 | Latency tracking | Measure and log: WS tick → UI render, exit trigger → order placed. | Performance metrics |
| 8.6 | Log viewer (optional) | Admin page to view recent logs, filter by type. | `/admin/logs` |

### Exit Criteria
- All key events appear in structured logs.
- `/api/v1/health` returns status of all subsystems.

---

## Phase 9 — UI Polish, Testing & Security Hardening *(Week 10–11)*

### Objectives
- Professional UI, comprehensive tests, security audit.

### Tasks
| # | Task | Details | Deliverable |
|---|------|---------|-------------|
| 9.1 | UI/UX polish | Consistent design system (Tailwind). Dark mode. Responsive (mobile‑friendly for quick checks). Loading skeletons. | Polished UI |
| 9.2 | Unit tests | Jest/Vitest for: scoring model, trailing SL logic, S/R calculation, backtest metrics. | ≥80% coverage on core logic |
| 9.3 | Integration tests | Supertest for API routes. Mock 5paisa responses. | API test suite |
| 9.4 | E2E tests | Playwright: login flow, positions page, auto‑exit toggle, analytics tabs. | E2E suite |
| 9.5 | Security audit | OWASP checklist: CSRF tokens, rate limiting, input validation (Zod), HTTP headers (helmet). | Security hardened |
| 9.6 | Token security | Ensure `accessToken` never in client bundle. Audit all API routes for auth middleware. | Security verified |

### Exit Criteria
- All tests pass. No critical security findings.

---

## Phase 10 — Deployment & Go‑Live *(Week 11–12)*

### Objectives
- Deploy to production, monitor, and iterate.

### Tasks
| # | Task | Details | Deliverable |
|---|------|---------|-------------|
| 10.1 | Production build | `next build` + optimize bundle. Environment variables for prod. | Build artifact |
| 10.2 | Hosting | Deploy on Vercel (frontend) + Railway/Render (Node API + DB) or VPS with Docker. | Live URL |
| 10.3 | Database setup | Set up production database and run migrations. | Production DB |
| 10.4 | SSL & domain | Custom domain + HTTPS. | Secure access |
| 10.5 | Monitoring | Uptime monitor (UptimeRobot). Error tracking (Sentry). | Monitoring active |
| 10.6 | Trading‑day smoke test | Full flow on a real trading day: login → positions → auto‑exit → analytics. | Verified in production |
| 10.7 | User documentation | README, in‑app tooltips, quick‑start guide. | Docs |

### Exit Criteria
- App is live, monitored, and survives a full trading session (09:15–15:30 IST).

---

## Summary Timeline

```
Week  1  ██████ Phase 0: Bootstrap & DevOps
Week  2  ██████ Phase 1: Auth & SSO
Week  3  ██████ Phase 2: Broker Proxy & Positions
Week  4  ██████ Phase 3: Market Data & WebSocket
Week  5  ██████ Phase 4: Analytics UI
Week 6-7 ████████████ Phase 5: Auto‑Exit Engine
Week 7-8 ████████████ Phase 6: Trade Suggestions
Week 8-9 ████████████ Phase 7: Backtesting
Week 9-10 ████████████ Phase 8: Logging & Monitoring
Week10-11 ████████████ Phase 9: Testing & Security
Week11-12 ████████████ Phase 10: Deployment & Go‑Live
```

---

## Dependency Graph

```
Phase 0 (Bootstrap)
  └──► Phase 1 (Auth)
         └──► Phase 2 (Positions) ──► Phase 5 (Auto‑Exit)
         └──► Phase 3 (Market Data)
                └──► Phase 4 (Analytics UI)
                └──► Phase 6 (Trade Suggestions)
                └──► Phase 7 (Backtesting)
  Phase 8 (Logging) ← runs in parallel from Phase 2 onward
  Phase 9 (Testing) ← runs after Phases 5–7
  Phase 10 (Deploy) ← final
```

---

## Tech Stack Summary

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14+ (App Router, TypeScript) |
| Styling | Tailwind CSS + shadcn/ui |
| State / Fetching | React Query (TanStack Query) |
| Backend | Next.js API Routes + standalone Node service for engine |
| Database | PostgreSQL (or JSON file storage for dev) |
| Real‑time | 5paisa Xstream WebSocket → SSE to frontend |
| Charts | Recharts or Plotly.js |
| Logging | Pino (structured JSON) |
| Testing | Vitest + Playwright |
| CI/CD | GitHub Actions |
| Deployment | Vercel + Railway (or Docker on VPS) |

---

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|-----------|
| 5paisa API rate limits | Market data gaps | Cache aggressively; fallback to REST polling |
| WebSocket disconnects | Missed ticks | Auto‑reconnect with exponential backoff; heartbeat monitoring |
| Token expiry mid‑session | Auth failure | Background token refresh; graceful re‑auth prompt |
| Backtest data quality | Wrong signals | Validate against NSE bhavcopy; flag data gaps |
| Auto‑exit latency > 2s | Slippage | Dedicated engine process; prioritize exit orders |
| Regulatory changes | API changes | Abstract broker layer; swap‑able adapter pattern |
