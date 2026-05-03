import { NextRequest, NextResponse } from "next/server";
import { withAuth } from "@/server/middleware/auth";
import { deleteJournalRecord } from "@/server/journal/trade-journal-store";
import { isMongoConfigured } from "@/server/db/mongo-client";

/**
 * DELETE /api/v1/journal/:id
 *
 * Permanently removes a single journal record (OPEN_ENTRY or PORTFOLIO_EXIT) for the
 * authenticated client. The store layer scopes deletes by `clientCode`, so a user
 * can only delete rows they own.
 *
 * Returns 200 on success, 404 if the record is not found, 400 on a bad id, or 503 if
 * MongoDB is not configured.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  return withAuth(request, async (_req, session) => {
    try {
      if (!isMongoConfigured()) {
        return NextResponse.json(
          {
            ok: false,
            mongoConfigured: false,
            message:
              "MongoDB is not configured. Set MONGODB_URI in the environment to enable journal writes.",
          },
          { status: 503 },
        );
      }

      const id = params.id;
      const r = await deleteJournalRecord(session.clientCode, id);

      if (r.ok) {
        return NextResponse.json({ ok: true, id, deleted: 1 });
      }

      if (r.reason === "invalid-id") {
        return NextResponse.json(
          { ok: false, message: "Invalid journal id." },
          { status: 400 },
        );
      }
      if (r.reason === "not-found") {
        return NextResponse.json(
          { ok: false, message: "Journal record not found (or not yours)." },
          { status: 404 },
        );
      }
      return NextResponse.json(
        { ok: false, message: "MongoDB is not configured." },
        { status: 503 },
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "delete failed";
      console.error("[JOURNAL] DELETE failed:", msg);
      return NextResponse.json(
        { ok: false, error: msg, message: msg },
        { status: 500 },
      );
    }
  });
}
