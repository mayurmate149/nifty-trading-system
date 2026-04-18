/**
 * ═══════════════════════════════════════════════════════════════════
 * NIFTY TRADING SIMULATOR — Admin Control Panel Routes
 * ═══════════════════════════════════════════════════════════════════
 *
 * REST API + HTML UI to trigger market scenarios while testing.
 *
 * Scenarios available:
 *   POST /admin/scenario/:name   — trigger a named scenario
 *   GET  /admin/state             — full simulator state
 *   GET  /admin                   — HTML control panel
 */

const { Router } = require("express");
const { state, scenarios, updatePositionLTPs } = require("./market-state");
const { roundTo } = require("./data-generators");

const router = Router();

// ─── Trigger a scenario ──────────────────────

router.post("/scenario/:name", (req, res) => {
  const { name } = req.params;
  const { value } = req.body || {};

  const fn = scenarios[name];
  if (!fn) {
    return res.status(400).json({
      error: `Unknown scenario: ${name}`,
      available: Object.keys(scenarios),
    });
  }

  const result = fn(value);
  console.log(`[SIM ADMIN] Scenario "${name}" triggered: ${result}`);
  res.json({ success: true, message: result, state: getStateSnapshot() });
});

// ─── Add custom position ─────────────────────

router.post("/add-position", (req, res) => {
  const { scripCode, scripName, symbol, optionType, strike, buySell, qty, avgPrice } = req.body;

  state.positions.push({
    ScripCode: scripCode || 200000 + state.positions.length,
    ScripName: scripName || `NIFTY ${strike} ${optionType}`,
    Symbol: symbol || "NIFTY",
    OptionType: optionType || "CE",
    StrikeRate: strike || 22500,
    BuySell: buySell || "B",
    NetQty: buySell === "S" ? -(qty || 50) : (qty || 50),
    AvgRate: avgPrice || state.nifty.price,
    LTP: 0,
    MTOM: 0,
    ExchOrderID: `SIM${Date.now()}`,
  });

  updatePositionLTPs();
  res.json({ success: true, positionsCount: state.positions.length });
});

// ─── Clear all positions ─────────────────────

router.post("/clear-positions", (req, res) => {
  state.positions = [];
  state.orders = [];
  res.json({ success: true, message: "All positions cleared" });
});

// ─── Get full state ──────────────────────────

router.get("/state", (req, res) => {
  res.json(getStateSnapshot());
});

function getStateSnapshot() {
  const totalPnL = state.positions.reduce((sum, p) => sum + p.MTOM, 0);
  return {
    nifty: state.nifty.price,
    bankNifty: state.bankNifty.price,
    vix: state.vix,
    iv: roundTo(state.baseIV * 100, 1),
    trend: state.nifty.trend,
    positions: state.positions.map((p) => ({
      scripName: p.ScripName,
      netQty: p.NetQty,
      avgPrice: roundTo(p.AvgRate),
      ltp: roundTo(p.LTP),
      pnl: roundTo(p.MTOM),
    })),
    orders: state.orders.length,
    totalPnL: roundTo(totalPnL),
    margin: state.margin,
    wsClients: state.wsClients.size,
    tickRate: state.tickRate,
  };
}

// ─── HTML Control Panel ──────────────────────

router.get("/", (req, res) => {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>🎮 Trading Simulator Control Panel</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', system-ui, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      padding: 24px;
    }
    h1 { color: #38bdf8; margin-bottom: 8px; }
    h2 { color: #94a3b8; font-size: 14px; margin-bottom: 24px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
    .card {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 20px;
    }
    .card h3 { color: #38bdf8; margin-bottom: 12px; font-size: 16px; }
    .btn {
      display: inline-block;
      padding: 8px 16px;
      margin: 4px;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      color: white;
      transition: opacity 0.2s;
    }
    .btn:hover { opacity: 0.8; }
    .btn-green { background: #059669; }
    .btn-red { background: #dc2626; }
    .btn-blue { background: #2563eb; }
    .btn-yellow { background: #d97706; }
    .btn-purple { background: #7c3aed; }
    .btn-gray { background: #475569; }
    #status {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 12px;
      padding: 20px;
      margin-top: 16px;
      font-family: 'Cascadia Code', 'Fira Code', monospace;
      font-size: 13px;
      white-space: pre-wrap;
      max-height: 400px;
      overflow-y: auto;
      line-height: 1.6;
    }
    .live-data {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 8px;
      margin-bottom: 16px;
    }
    .live-item {
      background: #0f172a;
      padding: 12px;
      border-radius: 8px;
      text-align: center;
    }
    .live-item .label { font-size: 11px; color: #64748b; text-transform: uppercase; }
    .live-item .value { font-size: 20px; font-weight: 700; color: #f8fafc; margin-top: 4px; }
    .live-item .value.green { color: #34d399; }
    .live-item .value.red { color: #f87171; }
    input[type="number"] {
      background: #0f172a;
      border: 1px solid #475569;
      color: #e2e8f0;
      padding: 6px 10px;
      border-radius: 6px;
      width: 80px;
      margin: 0 4px;
    }
    .log-entry { border-bottom: 1px solid #334155; padding: 4px 0; }
    .positions-table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
    .positions-table th { text-align: left; color: #64748b; padding: 4px 8px; border-bottom: 1px solid #334155; }
    .positions-table td { padding: 4px 8px; }
    .positions-table .pnl-positive { color: #34d399; }
    .positions-table .pnl-negative { color: #f87171; }
  </style>
</head>
<body>
  <h1>🎮 Nifty Trading Simulator</h1>
  <h2>Control Panel — Trigger scenarios to test your trading app</h2>

  <div class="live-data" id="liveData">
    <div class="live-item"><div class="label">Nifty</div><div class="value" id="niftyPrice">—</div></div>
    <div class="live-item"><div class="label">BankNifty</div><div class="value" id="bankNiftyPrice">—</div></div>
    <div class="live-item"><div class="label">VIX</div><div class="value" id="vixValue">—</div></div>
    <div class="live-item"><div class="label">IV</div><div class="value" id="ivValue">—</div></div>
    <div class="live-item"><div class="label">Total P&L</div><div class="value" id="totalPnl">—</div></div>
    <div class="live-item"><div class="label">WS Clients</div><div class="value" id="wsClients">—</div></div>
  </div>

  <div class="grid">
    <div class="card">
      <h3>📈 Price Scenarios</h3>
      <button class="btn btn-green" onclick="trigger('spikeUp', 1)">Spike Up +1%</button>
      <button class="btn btn-green" onclick="trigger('spikeUp', 2)">Spike Up +2%</button>
      <button class="btn btn-red" onclick="trigger('spikeDown', 1)">Crash -1%</button>
      <button class="btn btn-red" onclick="trigger('spikeDown', 2)">Crash -2%</button>
      <br/>
      <label>Custom %: <input type="number" id="customSpike" value="0.5" step="0.1" /></label>
      <button class="btn btn-green" onclick="trigger('spikeUp', val('customSpike'))">↑ Up</button>
      <button class="btn btn-red" onclick="trigger('spikeDown', val('customSpike'))">↓ Down</button>
      <br/><br/>
      <label>Set Price: <input type="number" id="setPrice" value="22500" step="50" /></label>
      <button class="btn btn-blue" onclick="trigger('setPrice', val('setPrice'))">Set</button>
    </div>

    <div class="card">
      <h3>📊 Trend</h3>
      <button class="btn btn-green" onclick="trigger('trendBullish')">🐂 Bullish</button>
      <button class="btn btn-gray" onclick="trigger('trendNeutral')">➡️ Neutral</button>
      <button class="btn btn-red" onclick="trigger('trendBearish')">🐻 Bearish</button>
    </div>

    <div class="card">
      <h3>🌊 Volatility</h3>
      <button class="btn btn-red" onclick="trigger('volExpand')">Vol Expand (IV↑ VIX↑)</button>
      <button class="btn btn-blue" onclick="trigger('volNormal')">Vol Normal</button>
      <button class="btn btn-green" onclick="trigger('volCrush')">Vol Crush (IV↓ VIX↓)</button>
    </div>

    <div class="card">
      <h3>⏰ Time & Speed</h3>
      <label>Fast Forward: <input type="number" id="ffHours" value="6" step="1" />h</label>
      <button class="btn btn-yellow" onclick="trigger('fastForward', val('ffHours'))">⏩ Forward</button>
      <br/><br/>
      <label>Tick Rate: <input type="number" id="tickMs" value="1000" step="100" />ms</label>
      <button class="btn btn-blue" onclick="trigger('setTickRate', val('tickMs'))">Set Speed</button>
    </div>

    <div class="card">
      <h3>🔧 Management</h3>
      <button class="btn btn-purple" onclick="trigger('reset')">🔄 Reset Everything</button>
      <button class="btn btn-red" onclick="clearPositions()">🗑️ Clear Positions</button>
    </div>
  </div>

  <h3 style="margin-top: 20px; color: #94a3b8;">Positions</h3>
  <table class="positions-table" id="posTable">
    <thead><tr><th>Scrip</th><th>Qty</th><th>Avg</th><th>LTP</th><th>P&L</th></tr></thead>
    <tbody></tbody>
  </table>

  <h3 style="margin-top: 20px; color: #94a3b8;">Event Log</h3>
  <div id="status">Ready. Polling state every 1s...</div>

  <script>
    const BASE = window.location.origin;

    function val(id) { return parseFloat(document.getElementById(id).value); }

    async function trigger(name, value) {
      try {
        const r = await fetch(BASE + '/admin/scenario/' + name, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value }),
        });
        const d = await r.json();
        log('✅ ' + name + ': ' + d.message);
      } catch (e) {
        log('❌ ' + name + ': ' + e.message);
      }
    }

    async function clearPositions() {
      const r = await fetch(BASE + '/admin/clear-positions', { method: 'POST' });
      const d = await r.json();
      log('🗑️ ' + d.message);
    }

    function log(msg) {
      const el = document.getElementById('status');
      const ts = new Date().toLocaleTimeString();
      el.innerHTML = '<div class="log-entry">[' + ts + '] ' + msg + '</div>' + el.innerHTML;
    }

    // ── Live polling ──
    async function pollState() {
      try {
        const r = await fetch(BASE + '/admin/state');
        const s = await r.json();

        document.getElementById('niftyPrice').textContent = s.nifty?.toFixed(2) || '—';
        document.getElementById('bankNiftyPrice').textContent = s.bankNifty?.toFixed(2) || '—';
        document.getElementById('vixValue').textContent = s.vix?.toFixed(2) || '—';
        document.getElementById('ivValue').textContent = s.iv?.toFixed(1) + '%';
        document.getElementById('wsClients').textContent = s.wsClients || 0;

        const pnlEl = document.getElementById('totalPnl');
        pnlEl.textContent = '₹' + (s.totalPnL || 0).toFixed(0);
        pnlEl.className = 'value ' + (s.totalPnL >= 0 ? 'green' : 'red');

        // Update positions table
        const tbody = document.querySelector('#posTable tbody');
        tbody.innerHTML = (s.positions || []).map(p =>
          '<tr><td>' + p.scripName + '</td><td>' + p.netQty + '</td><td>' +
          p.avgPrice + '</td><td>' + p.ltp + '</td><td class="' +
          (p.pnl >= 0 ? 'pnl-positive' : 'pnl-negative') + '">' +
          p.pnl.toFixed(2) + '</td></tr>'
        ).join('');
      } catch (e) {
        // server may not be ready yet
      }
    }

    setInterval(pollState, 1000);
    pollState();
  </script>
</body>
</html>`;

  res.type("html").send(html);
});

module.exports = router;
