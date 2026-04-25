import { config as loadEnv } from "dotenv";
import { resolve } from "path";
import http from "http";

const _cwd = process.cwd();
loadEnv({ path: resolve(_cwd, "../.env") });
loadEnv({ path: resolve(_cwd, ".env") });
import express, { type Request, type Response } from "express";
import cors from "cors";
import { WebSocketServer, WebSocket } from "ws";
import {
  configureAndConnect,
  onUpstreamMessage,
  onUpstreamState,
  getUpstreamState,
  hasSessionCredentials,
  stopUpstream,
  applyMarketFeedSubscriptions,
  getLastClientCode,
} from "./xstream-upstream.js";
import { setTradingSessionCookie, stopTradingSnapshotPoll } from "./trading-snapshot-poll.js";

const PORT = Number(process.env.XSTREAM_GATEWAY_PORT || 3333);
const CORS = process.env.XSTREAM_CORS?.split(",") || ["http://localhost:3000", "http://127.0.0.1:3000"];
const SECRET = process.env.XSTREAM_GATEWAY_SECRET || "";

const app = express();
app.use(cors({ origin: CORS, credentials: true }));
app.use(express.json({ limit: "32kb" }));

app.get("/health", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: "xstream-ws-gateway",
    upstream: getUpstreamState(),
    hasCredentials: hasSessionCredentials(),
  });
});

/**
 * Body: { accessToken, clientCode, instruments? }
 * If XSTREAM_GATEWAY_SECRET is set, require header: x-gateway-secret: <secret>
 */
app.post("/configure", (req: Request, res: Response) => {
  if (SECRET) {
    const h = (req.get("x-gateway-secret") || "").trim();
    if (h !== SECRET) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
  }
  const { accessToken, clientCode, instruments, sessionId } = req.body as {
    accessToken?: string;
    clientCode?: string;
    sessionId?: string;
    instruments?: { Exch: string; ExchType: string; ScripCode: number }[];
  };
  if (!accessToken || !clientCode) {
    res.status(400).json({ error: "accessToken and clientCode required" });
    return;
  }
  configureAndConnect({ accessToken, clientCode, instruments });
  setTradingSessionCookie(sessionId?.trim() || null);
  res.json({ ok: true, upstream: getUpstreamState() });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const path = (req.url || "/").split("?")[0] || "/";
  if (path === "/ws" || path === "/") {
    wss.handleUpgrade(req, socket, head, (client) => wss.emit("connection", client, req));
  } else {
    socket.destroy();
  }
});

wss.on("connection", (client) => {
  const send = (data: string) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(data);
      } catch {
        // ignore
      }
    }
  };
  send(
    JSON.stringify({
      type: "status",
      state: getUpstreamState(),
      at: new Date().toISOString(),
    }),
  );
  const remove = onUpstreamMessage(send);
  client.on("message", (raw) => {
    try {
      const msg = JSON.parse(String(raw)) as {
        type?: string;
        instruments?: { Exch?: string; ExchType?: string; ScripCode?: number }[];
      };
      if (msg.type !== "market-feed-subscribe" || !Array.isArray(msg.instruments)) {
        return;
      }
      const inst: { Exch: string; ExchType: string; ScripCode: number }[] = [];
      for (const x of msg.instruments) {
        if (!x || typeof x.ScripCode !== "number" || x.ScripCode <= 0) continue;
        inst.push({
          Exch: (x.Exch ?? "N").toString(),
          ExchType: (x.ExchType ?? "D").toString(),
          ScripCode: x.ScripCode,
        });
      }
      applyMarketFeedSubscriptions(getLastClientCode(), inst);
    } catch {
      // ignore
    }
  });
  client.on("close", remove);
  client.on("error", remove);
});

onUpstreamState(() => {
  const msg = JSON.stringify({
    type: "status",
    state: getUpstreamState(),
    at: new Date().toISOString(),
  });
  wss.clients.forEach((c) => {
    if (c.readyState === WebSocket.OPEN) c.send(msg);
  });
});

const token = process.env.FIVEPAISA_ACCESS_TOKEN?.trim();
const code = process.env.FIVEPAISA_CLIENT_CODE?.trim();
if (token && code) {
  configureAndConnect({ accessToken: token, clientCode: code });
} else {
  // eslint-disable-next-line no-console
  console.log(
    "[xstream-ws-gateway] No FIVEPAISA_ACCESS_TOKEN / FIVEPAISA_CLIENT_CODE in env (checked ../.env and local .env). " +
      "After you log in to the Next app, it will POST /configure with your OAuth session, or set those env vars / call POST /configure yourself.",
  );
}

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[xstream-ws-gateway] http://localhost:${PORT}/health  ws path /ws`);
});

process.on("SIGTERM", () => {
  stopTradingSnapshotPoll();
  stopUpstream();
  server.close();
});
