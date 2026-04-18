/**
 * ═══════════════════════════════════════════════════════════════════
 * NIFTY TRADING SIMULATOR — Main Server
 * ═══════════════════════════════════════════════════════════════════
 *
 * A standalone Express + WebSocket server that fully mimics 5paisa APIs.
 *
 * Usage:
 *   cd simulator && npm install && npm run dev
 *
 * Endpoints:
 *   REST (same paths as 5paisa):
 *     POST /VendorsAPI/Service1.svc/GetAccessToken
 *     POST /VendorsAPI/Service1.svc/V1/NetPositionNetWise
 *     POST /VendorsAPI/Service1.svc/V2/OrderBook
 *     POST /VendorsAPI/Service1.svc/V4/Margin
 *     POST /VendorsAPI/Service1.svc/V1/PlaceOrderRequest
 *     POST /VendorsAPI/Service1.svc/V1/ModifyOrderRequest
 *     POST /VendorsAPI/Service1.svc/V1/CancelOrderRequest
 *     POST /VendorsAPI/Service1.svc/V2/MarketFeed
 *     GET  /VendorsAPI/Service1.svc/snapshot
 *
 *   WebSocket:
 *     ws://localhost:PORT/ws — live market tick stream
 *
 *   Admin Control Panel:
 *     GET  /admin              — HTML dashboard
 *     GET  /admin/state        — JSON state
 *     POST /admin/scenario/:n  — trigger a scenario
 *
 *   OAuth (mock):
 *     GET  /WebVendorLogin/VLogin/Index — auto-redirects with fake RequestToken
 */

const express = require("express");
const cors = require("cors");
const http = require("http");
const { WebSocketServer } = require("ws");

const apiRoutes = require("./api-routes");
const adminRoutes = require("./admin-routes");
const {
  state,
  initDefaultPositions,
  startTickLoop,
  broadcastWS,
} = require("./market-state");

const PORT = process.env.SIMULATOR_PORT || 9500;

// ─── Express App ─────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());

// Mount 5paisa API routes under the exact same path
app.use("/VendorsAPI/Service1.svc", apiRoutes);

// Admin control panel
app.use("/admin", adminRoutes);

// ─── OAuth Login Mock ────────────────────────
// Real 5paisa redirects to your callback URL with ?RequestToken=xxx
// Simulator does the same but instantly, with a fake token.
app.get("/WebVendorLogin/VLogin/Index", (req, res) => {
  const responseURL = req.query.ResponseURL;
  const fakeRequestToken = `SIM_REQ_TOKEN_${Date.now()}`;

  console.log(`[SIM OAuth] Login requested. Redirecting to: ${responseURL}`);
  console.log(`[SIM OAuth] RequestToken: ${fakeRequestToken}`);

  if (!responseURL) {
    return res.status(400).send("Missing ResponseURL parameter");
  }

  // Redirect back to app's callback with the fake token
  const separator = responseURL.includes("?") ? "&" : "?";
  res.redirect(`${responseURL}${separator}RequestToken=${fakeRequestToken}`);
});

// ─── Health check ────────────────────────────

app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime(), port: PORT });
});

// ─── Root redirect to admin ──────────────────

app.get("/", (req, res) => {
  res.redirect("/admin");
});

// ─── HTTP Server ─────────────────────────────

const server = http.createServer(app);

// ─── WebSocket Server ────────────────────────
// Clients connect to ws://localhost:PORT/ws
// They receive JSON messages: { type: "tick", data: [...ticks] }
// They can send: { type: "subscribe", symbols: ["NIFTY", "BANKNIFTY"] }

const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
  console.log(`[SIM WS] Client connected (total: ${state.wsClients.size + 1})`);
  state.wsClients.add(ws);

  // Send initial snapshot
  ws.send(
    JSON.stringify({
      type: "connected",
      data: {
        nifty: state.nifty.price,
        bankNifty: state.bankNifty.price,
        vix: state.vix,
        positions: state.positions.length,
        message: "Connected to Nifty Trading Simulator WebSocket",
      },
    })
  );

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      console.log("[SIM WS] Received:", msg);

      if (msg.type === "subscribe") {
        // In a real implementation, filter ticks by symbol
        // For simulator, we broadcast everything
        ws.send(
          JSON.stringify({
            type: "subscribed",
            symbols: msg.symbols || ["NIFTY", "BANKNIFTY"],
          })
        );
      }
    } catch (e) {
      console.error("[SIM WS] Bad message:", e.message);
    }
  });

  ws.on("close", () => {
    state.wsClients.delete(ws);
    console.log(`[SIM WS] Client disconnected (total: ${state.wsClients.size})`);
  });

  ws.on("error", (err) => {
    console.error("[SIM WS] Error:", err.message);
    state.wsClients.delete(ws);
  });
});

// ─── Start ───────────────────────────────────

initDefaultPositions();
startTickLoop();

server.listen(PORT, () => {
  console.log("");
  console.log("  ══════════════════════════════════════════════════");
  console.log("  🎮  NIFTY TRADING SIMULATOR");
  console.log("  ══════════════════════════════════════════════════");
  console.log("");
  console.log(`  REST API:     http://localhost:${PORT}/VendorsAPI/Service1.svc`);
  console.log(`  WebSocket:    ws://localhost:${PORT}/ws`);
  console.log(`  OAuth Mock:   http://localhost:${PORT}/WebVendorLogin/VLogin/Index`);
  console.log(`  Admin Panel:  http://localhost:${PORT}/admin`);
  console.log(`  Health:       http://localhost:${PORT}/health`);
  console.log("");
  console.log(`  Nifty:        ${state.nifty.price}`);
  console.log(`  BankNifty:    ${state.bankNifty.price}`);
  console.log(`  Positions:    ${state.positions.length} (Iron Condor)`);
  console.log(`  Tick Rate:    ${state.tickRate}ms`);
  console.log("");
  console.log("  Ready! Your app should point to this server.");
  console.log("  ══════════════════════════════════════════════════");
  console.log("");
});
