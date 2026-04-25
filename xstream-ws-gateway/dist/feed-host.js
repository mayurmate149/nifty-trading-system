"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveOpenfeedHostFromAccessToken = resolveOpenfeedHostFromAccessToken;
exports.buildXstreamWebSocketUrl = buildXstreamWebSocketUrl;
/**
 * Resolves 5paisa openfeed host from JWT RedirectServer (see Xstream order-tracking WebSocket docs).
 * C → openfeed, A → aopenfeed, B → bopenfeed.
 */
function resolveOpenfeedHostFromAccessToken(accessToken) {
    try {
        const parts = accessToken.split(".");
        if (parts.length < 2)
            return "openfeed.5paisa.com";
        let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const pad = b64.length % 4;
        if (pad)
            b64 += "=".repeat(4 - pad);
        const json = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
        const s = (json.RedirectServer ?? "C").toUpperCase();
        if (s === "A")
            return "aopenfeed.5paisa.com";
        if (s === "B")
            return "bopenfeed.5paisa.com";
        return "openfeed.5paisa.com";
    }
    catch {
        return "openfeed.5paisa.com";
    }
}
function buildXstreamWebSocketUrl(accessToken, clientCode) {
    const host = resolveOpenfeedHostFromAccessToken(accessToken);
    const value1 = `${accessToken}|${clientCode}`;
    return `wss://${host}/feeds/api/chat?Value1=${encodeURIComponent(value1)}`;
}
