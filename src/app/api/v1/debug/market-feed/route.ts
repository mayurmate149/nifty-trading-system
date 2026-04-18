import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/server/middleware/auth";

const BASE_URL = "https://Openapi.5paisa.com/VendorsAPI/Service1.svc";

function buildHead(requestCode: string) {
  return {
    appName: process.env.FIVEPAISA_APP_NAME || "",
    appVer: "1.0",
    key: process.env.FIVEPAISA_APP_KEY || "",
    osName: "WEB",
    requestCode,
    userId: process.env.FIVEPAISA_USER_ID || "",
    password: process.env.FIVEPAISA_USER_PASSWORD || "",
  };
}

async function post(url: string, payload: any, token: string) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: res.ok ? await res.json() : await res.text() };
}

/**
 * GET /api/v1/debug/market-feed
 * Diagnostic: dumps raw 5paisa API responses.
 * DELETE after debugging.
 */
export async function GET(request: NextRequest) {
  return withAuth(request, async (_req, session) => {
    const results: Record<string, any> = {};

    // ──── 1: V1/MarketFeed (Nifty + BankNifty + VIX by ScripCode) ────
    try {
      const r = await post(`${BASE_URL}/V1/MarketFeed`, {
        head: { key: process.env.FIVEPAISA_APP_KEY || "" },
        body: {
          MarketFeedData: [
            { Exch: "N", ExchType: "C", ScripCode: "999920000" },
            { Exch: "N", ExchType: "C", ScripCode: "999920005" },
            { Exch: "N", ExchType: "C", ScripCode: "999920019" },
          ],
          LastRequestTime: "/Date(0)/",
          RefreshRate: "H",
        },
      }, session.accessToken);
      results.v1MarketFeed = r;
    } catch (e: any) {
      results.v1MarketFeed = { error: e.message };
    }

    // ──── 2: GetExpiryForSymbolOptions ────
    try {
      const r = await post(`${BASE_URL}/V2/GetExpiryForSymbolOptions`, {
        head: buildHead(""),
        body: {
          ClientCode: session.clientCode || "",
          Exch: "N",
          Symbol: "NIFTY",
        },
      }, session.accessToken);
      results.getExpiry = r;
    } catch (e: any) {
      results.getExpiry = { error: e.message };
    }

    // ──── 3: GetOptionsForSymbol (using nearest expiry timestamp) ────
    try {
      // Compute next Thursday as ms timestamp
      const d = new Date();
      const day = d.getDay();
      const diff = (4 - day + 7) % 7 || 7;
      d.setDate(d.getDate() + diff);
      d.setHours(0, 0, 0, 0);
      const expiryTs = d.getTime();

      const r = await post(`${BASE_URL}/GetOptionsForSymbol`, {
        head: buildHead(""),
        body: {
          ClientCode: session.clientCode || "",
          Exch: "N",
          Symbol: "NIFTY",
          ExpiryDate: `/Date(${expiryTs})/`,
        },
      }, session.accessToken);

      // Show first item in full for field discovery
      if (r.body?.body?.Data && Array.isArray(r.body.body.Data)) {
        results.getOptionsChain = {
          status: r.status,
          totalItems: r.body.body.Data.length,
          message: r.body.body.Message,
          firstItemAllFields: r.body.body.Data.length > 0 ? r.body.body.Data[0] : null,
          expiryUsed: expiryTs,
        };
      } else {
        results.getOptionsChain = {
          status: r.status,
          body: typeof r.body === "string" ? r.body.slice(0, 500) : r.body,
          expiryUsed: expiryTs,
        };
      }
    } catch (e: any) {
      results.getOptionsChain = { error: e.message };
    }

    // ──── 4: MarketSnapshot (full snapshot with OI) ────
    try {
      const r = await post(`${BASE_URL}/MarketSnapshot`, {
        head: buildHead(""),
        body: {
          ClientCode: session.clientCode || "",
          Data: [
            { Exchange: "N", ExchangeType: "C", ScripCode: "999920000" },
            { Exchange: "N", ExchangeType: "C", ScripCode: "999920019" },
          ],
        },
      }, session.accessToken);
      results.marketSnapshot = r;
    } catch (e: any) {
      results.marketSnapshot = { error: e.message };
    }

    // ──── 5: Today's actual expiry test ────
    // Try 0 days from now (today if Thursday), else next Thursday
    try {
      const today = new Date();
      const dayOfWeek = today.getDay();
      // If today IS Thursday, use today
      let expiryDate: Date;
      if (dayOfWeek === 4) {
        expiryDate = new Date(today);
      } else {
        const diff2 = (4 - dayOfWeek + 7) % 7 || 7;
        expiryDate = new Date(today);
        expiryDate.setDate(today.getDate() + diff2);
      }
      expiryDate.setHours(0, 0, 0, 0);
      const expiryTs2 = expiryDate.getTime();

      results.expiryDebug = {
        todayDay: dayOfWeek,
        todayDate: today.toISOString(),
        expiryDate: expiryDate.toISOString(),
        expiryTimestamp: expiryTs2,
      };

      const r2 = await post(`${BASE_URL}/GetOptionsForSymbol`, {
        head: buildHead(""),
        body: {
          ClientCode: session.clientCode || "",
          Exch: "N",
          Symbol: "NIFTY",
          ExpiryDate: `/Date(${expiryTs2})/`,
        },
      }, session.accessToken);

      if (r2.body?.body?.Data && Array.isArray(r2.body.body.Data)) {
        const data = r2.body.body.Data;
        results.getOptionsChainToday = {
          status: r2.status,
          totalItems: data.length,
          message: r2.body.body.Message,
          // Show ALL fields of first item for field discovery
          firstItemAllFields: data.length > 0 ? data[0] : null,
          secondItemAllFields: data.length > 1 ? data[1] : null,
          expiryUsed: expiryTs2,
        };
      } else {
        results.getOptionsChainToday = {
          status: r2.status,
          body: typeof r2.body === "string" ? r2.body.slice(0, 1000) : r2.body,
          expiryUsed: expiryTs2,
        };
      }
    } catch (e: any) {
      results.getOptionsChainToday = { error: e.message };
    }

    return NextResponse.json(results, { status: 200 });
  });
}
