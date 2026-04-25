"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.broadcastToBrowserClients = broadcastToBrowserClients;
exports.getUpstreamState = getUpstreamState;
exports.hasSessionCredentials = hasSessionCredentials;
exports.onUpstreamState = onUpstreamState;
exports.onUpstreamMessage = onUpstreamMessage;
exports.configureAndConnect = configureAndConnect;
exports.stopUpstream = stopUpstream;
const ws_1 = __importDefault(require("ws"));
const feed_host_js_1 = require("./feed-host.js");
const parsers_js_1 = require("./parsers.js");
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 60_000;
let ws = null;
let upstreamState = "unconfigured";
const clientListeners = new Set();
const stateListeners = new Set();
let reconnectTimer = null;
let attempt = 0;
let lastAccess = "";
let lastClientCode = "";
let subOverride = parsers_js_1.DEFAULT_SUBSCRIPTIONS;
function setState(s) {
    if (s === upstreamState)
        return;
    upstreamState = s;
    stateListeners.forEach((fn) => fn(s));
    broadcastToBrowserClients(JSON.stringify({ type: "status", state: s, at: new Date().toISOString() }));
}
/** All browser tabs connected to the gateway receive these messages (ticks, snapshot, status). */
function broadcastToBrowserClients(msg) {
    clientListeners.forEach((fn) => {
        try {
            fn(msg);
        }
        catch {
            // ignore
        }
    });
}
function subscribeMarket(clientCode) {
    if (!ws || ws.readyState !== ws_1.default.OPEN)
        return;
    const payload = {
        Method: "MarketFeedV3",
        Operation: "Subscribe",
        ClientCode: clientCode,
        MarketFeedData: subOverride,
    };
    ws.send(JSON.stringify(payload));
}
function getUpstreamState() {
    return upstreamState;
}
function hasSessionCredentials() {
    return Boolean(lastAccess && lastClientCode);
}
function onUpstreamState(fn) {
    stateListeners.add(fn);
    return () => void stateListeners.delete(fn);
}
function onUpstreamMessage(fn) {
    clientListeners.add(fn);
    return () => void clientListeners.delete(fn);
}
function configureAndConnect(params) {
    if (params.instruments?.length) {
        subOverride = params.instruments;
    }
    else {
        subOverride = parsers_js_1.DEFAULT_SUBSCRIPTIONS;
    }
    const nextToken = params.accessToken.trim();
    const nextCode = params.clientCode.trim();
    if (!nextToken || !nextCode) {
        setState("unconfigured");
        return;
    }
    lastAccess = nextToken;
    lastClientCode = nextCode;
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    connectNow();
}
function connectNow() {
    if (!lastAccess || !lastClientCode) {
        setState("unconfigured");
        return;
    }
    if (ws) {
        try {
            ws.terminate();
        }
        catch {
            // ignore
        }
        ws = null;
    }
    setState("connecting");
    const url = (0, feed_host_js_1.buildXstreamWebSocketUrl)(lastAccess, lastClientCode);
    const socket = new ws_1.default(url, { perMessageDeflate: false });
    ws = socket;
    socket.on("open", () => {
        setState("ready");
        attempt = 0;
        subscribeMarket(lastClientCode);
    });
    socket.on("message", (data) => {
        const raw = data.toString();
        for (const row of (0, parsers_js_1.parse5paisaPayload)(raw)) {
            const t = (0, parsers_js_1.toGatewayTick)(row);
            if (t) {
                broadcastToBrowserClients(JSON.stringify(t));
            }
        }
    });
    socket.on("close", () => {
        setState("disconnected");
        scheduleReconnect();
    });
    socket.on("error", () => {
        setState("error");
    });
}
function scheduleReconnect() {
    if (!lastAccess || !lastClientCode)
        return;
    if (reconnectTimer)
        return;
    attempt += 1;
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.min(attempt, 6));
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectNow();
    }, delay);
}
function stopUpstream() {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }
    lastAccess = "";
    lastClientCode = "";
    if (ws) {
        try {
            ws.removeAllListeners();
            ws.close();
        }
        catch {
            // ignore
        }
        ws = null;
    }
    setState("unconfigured");
}
