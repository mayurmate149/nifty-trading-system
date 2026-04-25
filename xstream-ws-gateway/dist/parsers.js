"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_SUBSCRIPTIONS = void 0;
exports.symbolForToken = symbolForToken;
exports.parse5paisaPayload = parse5paisaPayload;
exports.toGatewayTick = toGatewayTick;
exports.mergeWithDefaultSubscriptions = mergeWithDefaultSubscriptions;
const TOKEN_NIFTY = 999920000;
const TOKEN_BANKNIFTY = 999920005;
const TOKEN_VIX = 999920019;
function symbolForToken(token) {
    if (token === TOKEN_NIFTY)
        return "NIFTY";
    if (token === TOKEN_BANKNIFTY)
        return "BANKNIFTY";
    if (token === TOKEN_VIX)
        return "VIX";
    return undefined;
}
/** Normalize WebSocket text payloads into per-row objects. */
function parse5paisaPayload(raw) {
    const t = raw.trim();
    if (!t)
        return [];
    let parsed;
    try {
        parsed = JSON.parse(t);
    }
    catch {
        return [];
    }
    if (Array.isArray(parsed)) {
        return parsed.filter((x) => x && typeof x === "object");
    }
    if (parsed && typeof parsed === "object") {
        return [parsed];
    }
    return [];
}
function toGatewayTick(row) {
    const token = Number(row.Token ?? NaN);
    if (!Number.isFinite(token))
        return null;
    const label = symbolForToken(token);
    return {
        type: "tick",
        kind: label ? "index" : "option",
        token,
        symbol: label,
        exch: row.Exch,
        exchType: row.ExchType,
        lastRate: Number(row.LastRate ?? 0),
        pClose: Number(row.PClose ?? 0),
        lastQty: Number(row.LastQty ?? 0),
        totalQty: Number(row.TotalQty ?? 0),
        high: Number(row.High ?? 0),
        low: Number(row.Low ?? 0),
        openRate: Number(row.OpenRate ?? 0),
        avgRate: Number(row.AvgRate ?? 0),
        bidRate: Number(row.BidRate ?? 0),
        bidQty: Number(row.BidQty ?? 0),
        offRate: Number(row.OffRate ?? 0),
        offQty: Number(row.OffQty ?? 0),
        chgPcnt: row.ChgPcnt,
        time: row.Time,
        serverTs: Date.now(),
    };
}
exports.DEFAULT_SUBSCRIPTIONS = [
    { Exch: "N", ExchType: "C", ScripCode: TOKEN_NIFTY },
    { Exch: "N", ExchType: "C", ScripCode: TOKEN_BANKNIFTY },
    { Exch: "N", ExchType: "C", ScripCode: TOKEN_VIX },
];
const MAX_MARKET_SUBS = Number(process.env.XSTREAM_MAX_INSTRUMENTS || 175);
const key = (i) => `${i.Exch}|${i.ExchType}|${i.ScripCode}`;
/** Merges index defaults with F&O scrips; caps list for 5paisa WebSocket limits. */
function mergeWithDefaultSubscriptions(extra, max = MAX_MARKET_SUBS) {
    const map = new Map();
    for (const d of exports.DEFAULT_SUBSCRIPTIONS) {
        map.set(key(d), d);
    }
    for (const e of extra) {
        if (map.size >= max)
            break;
        if (e && e.ScripCode > 0 && e.Exch && e.ExchType) {
            const row = { Exch: e.Exch, ExchType: e.ExchType, ScripCode: e.ScripCode };
            if (!map.has(key(row))) {
                map.set(key(row), row);
            }
        }
    }
    return Array.from(map.values());
}
