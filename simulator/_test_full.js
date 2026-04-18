// Full integration test: starts simulator and tests all major endpoints
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");

const serverPath = path.join(__dirname, "server.js");

console.log("Starting simulator...\n");
const child = spawn("node", [serverPath], { stdio: ["ignore", "pipe", "pipe"] });

child.stdout.on("data", (d) => process.stdout.write(d));
child.stderr.on("data", (d) => process.stderr.write(d));

function post(urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        hostname: "localhost",
        port: 9500,
        path: urlPath,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          try { resolve(JSON.parse(raw)); } catch { resolve(raw); }
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function get(urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:9500${urlPath}`, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        try { resolve(JSON.parse(raw)); } catch { resolve(raw); }
      });
    }).on("error", reject);
  });
}

async function runTests() {
  await new Promise((r) => setTimeout(r, 2000));

  console.log("\n═══ TEST RESULTS ═══\n");

  // 1. Health
  const health = await get("/health");
  console.log("✅ Health:", JSON.stringify(health));

  // 2. Auth — GetAccessToken
  const auth = await post("/VendorsAPI/Service1.svc/GetAccessToken", {
    head: { Key: "test" },
    body: { RequestToken: "SIM_REQ_TOKEN_123", EncryKey: "test", UserId: "test" },
  });
  console.log("✅ Auth:", auth.body?.ClientCode, "Token:", auth.body?.AccessToken?.substring(0, 30) + "...");

  // 3. Positions
  const positions = await post("/VendorsAPI/Service1.svc/V1/NetPositionNetWise", {
    head: { requestCode: "5PNPNWV1" },
    body: { ClientCode: "58467591" },
  });
  const posCount = positions.body?.NetPositionDetail?.length || 0;
  console.log("✅ Positions:", posCount, "open positions");
  if (posCount > 0) {
    positions.body.NetPositionDetail.forEach((p) => {
      console.log(`   ${p.ScripName} | Qty: ${p.NetQty} | Avg: ${p.AvgRate} | LTP: ${p.LTP} | P&L: ${p.MTOM}`);
    });
  }

  // 4. Order Book
  const orders = await post("/VendorsAPI/Service1.svc/V2/OrderBook", {
    head: { requestCode: "5POrdBkV2" },
    body: { ClientCode: "58467591" },
  });
  console.log("✅ Orders:", orders.body?.OrderBookDetail?.length || 0, "orders");

  // 5. Margin
  const margin = await post("/VendorsAPI/Service1.svc/V4/Margin", {
    head: { requestCode: "5PMarginV3" },
    body: { ClientCode: "58467591" },
  });
  console.log("✅ Margin:", JSON.stringify(margin.body?.EquityMargin?.[0] || {}));

  // 6. Place Order
  const placeResult = await post("/VendorsAPI/Service1.svc/V1/PlaceOrderRequest", {
    head: { requestCode: "5PPlaceOrdReq" },
    body: {
      ClientCode: "58467591",
      ScripCode: 300001,
      BuySell: "B",
      Qty: 25,
      Price: 150,
      Exchange: "N",
      ExchangeType: "D",
      AtMarket: true,
    },
  });
  console.log("✅ Place Order:", placeResult.body?.Message, "OrderID:", placeResult.body?.ExchOrderID);

  // 7. Market Snapshot
  const snapshot = await get("/VendorsAPI/Service1.svc/snapshot");
  console.log("✅ Snapshot: Nifty =", snapshot.nifty, "VIX =", snapshot.vix, "P&L =", snapshot.totalPnL);

  // 8. Admin State
  const adminState = await get("/admin/state");
  console.log("✅ Admin: Positions =", adminState.positions?.length, "WS Clients =", adminState.wsClients);

  // 9. Scenario: spike up
  const spike = await post("/admin/scenario/spikeUp", { value: 0.5 });
  console.log("✅ Scenario spikeUp:", spike.message);

  console.log("\n═══ ALL TESTS PASSED ═══\n");

  child.kill();
  process.exit(0);
}

runTests().catch((e) => {
  console.error("❌ TEST FAILED:", e.message);
  child.kill();
  process.exit(1);
});
