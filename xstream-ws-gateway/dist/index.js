"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = require("dotenv");
const path_1 = require("path");
const http_1 = __importDefault(require("http"));
const _cwd = process.cwd();
(0, dotenv_1.config)({ path: (0, path_1.resolve)(_cwd, "../.env") });
(0, dotenv_1.config)({ path: (0, path_1.resolve)(_cwd, ".env") });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const ws_1 = require("ws");
const xstream_upstream_js_1 = require("./xstream-upstream.js");
const trading_snapshot_poll_js_1 = require("./trading-snapshot-poll.js");
const PORT = Number(process.env.XSTREAM_GATEWAY_PORT || 3333);
const CORS = process.env.XSTREAM_CORS?.split(",") || ["http://localhost:3000", "http://127.0.0.1:3000"];
const SECRET = process.env.XSTREAM_GATEWAY_SECRET || "";
const app = (0, express_1.default)();
app.use((0, cors_1.default)({ origin: CORS, credentials: true }));
app.use(express_1.default.json({ limit: "32kb" }));
app.get("/health", (_req, res) => {
    res.json({
        ok: true,
        service: "xstream-ws-gateway",
        upstream: (0, xstream_upstream_js_1.getUpstreamState)(),
        hasCredentials: (0, xstream_upstream_js_1.hasSessionCredentials)(),
    });
});
/**
 * Body: { accessToken, clientCode, instruments? }
 * If XSTREAM_GATEWAY_SECRET is set, require header: x-gateway-secret: <secret>
 */
app.post("/configure", (req, res) => {
    if (SECRET) {
        const h = (req.get("x-gateway-secret") || "").trim();
        if (h !== SECRET) {
            res.status(401).json({ error: "unauthorized" });
            return;
        }
    }
    const { accessToken, clientCode, instruments, sessionId } = req.body;
    if (!accessToken || !clientCode) {
        res.status(400).json({ error: "accessToken and clientCode required" });
        return;
    }
    (0, xstream_upstream_js_1.configureAndConnect)({ accessToken, clientCode, instruments });
    (0, trading_snapshot_poll_js_1.setTradingSessionCookie)(sessionId?.trim() || null);
    res.json({ ok: true, upstream: (0, xstream_upstream_js_1.getUpstreamState)() });
});
const server = http_1.default.createServer(app);
const wss = new ws_1.WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
    const path = (req.url || "/").split("?")[0] || "/";
    if (path === "/ws" || path === "/") {
        wss.handleUpgrade(req, socket, head, (client) => wss.emit("connection", client, req));
    }
    else {
        socket.destroy();
    }
});
wss.on("connection", (client) => {
    const send = (data) => {
        if (client.readyState === ws_1.WebSocket.OPEN) {
            try {
                client.send(data);
            }
            catch {
                // ignore
            }
        }
    };
    send(JSON.stringify({
        type: "status",
        state: (0, xstream_upstream_js_1.getUpstreamState)(),
        at: new Date().toISOString(),
    }));
    const remove = (0, xstream_upstream_js_1.onUpstreamMessage)(send);
    client.on("close", remove);
    client.on("error", remove);
});
(0, xstream_upstream_js_1.onUpstreamState)(() => {
    const msg = JSON.stringify({
        type: "status",
        state: (0, xstream_upstream_js_1.getUpstreamState)(),
        at: new Date().toISOString(),
    });
    wss.clients.forEach((c) => {
        if (c.readyState === ws_1.WebSocket.OPEN)
            c.send(msg);
    });
});
const token = process.env.FIVEPAISA_ACCESS_TOKEN?.trim();
const code = process.env.FIVEPAISA_CLIENT_CODE?.trim();
if (token && code) {
    (0, xstream_upstream_js_1.configureAndConnect)({ accessToken: token, clientCode: code });
}
else {
    // eslint-disable-next-line no-console
    console.log("[xstream-ws-gateway] No FIVEPAISA_ACCESS_TOKEN / FIVEPAISA_CLIENT_CODE in env (checked ../.env and local .env). " +
        "After you log in to the Next app, it will POST /configure with your OAuth session, or set those env vars / call POST /configure yourself.");
}
server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`[xstream-ws-gateway] http://localhost:${PORT}/health  ws path /ws`);
});
process.on("SIGTERM", () => {
    (0, trading_snapshot_poll_js_1.stopTradingSnapshotPoll)();
    (0, xstream_upstream_js_1.stopUpstream)();
    server.close();
});
