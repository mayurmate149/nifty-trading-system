import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/server/middleware/auth";
import {
  listJournalForClient,
  TRADE_JOURNAL_COLLECTION,
} from "@/server/journal/trade-journal-store";
import { isMongoConfigured } from "@/server/db/mongo-client";

/** JSON-safe journal row — strips Mongo `_id` to hex string */
function sanitizeRecord(doc: Record<string, unknown>): Record<string, unknown> {
  const { _id, ...rest } = doc;
  return {
    ...rest,
    id: typeof _id === "object" && _id && "toString" in _id ? String(_id) : undefined,
  };
}

/**
 * GET /api/v1/journal?limit=100
 */
export async function GET(request: NextRequest) {
  return withAuth(request, async (_req, session) => {
    try {
      if (!isMongoConfigured()) {
        return NextResponse.json({
          mongoConfigured: false,
          collection: TRADE_JOURNAL_COLLECTION,
          records: [],
          message:
            "Set MONGODB_URI and optionally MONGODB_DB_NAME in the environment to enable the trade journal.",
        });
      }
      const rawLimit = request.nextUrl.searchParams.get("limit");
      const limit =
        typeof rawLimit === "string"
          ? Math.min(500, Math.max(1, parseInt(rawLimit, 10) || 100))
          : 100;

      const { records, mongoConfigured } = await listJournalForClient(
        session.clientCode,
        limit,
      );
      return NextResponse.json({
        mongoConfigured,
        records: records.map((r) => sanitizeRecord(r as Record<string, unknown>)),
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "journal list failed";
      console.error("[JOURNAL] GET /journal failed:", msg);
      return NextResponse.json(
        { error: msg, message: msg },
        { status: 500 },
      );
    }
  });
}
