/**
 * Server-side Error Handler Middleware
 *
 * Wraps API route handlers with standardized error handling.
 */

import { NextResponse } from "next/server";
import { createLogger } from "@/server/logging/logger";

const logger = createLogger("error-handler");

export function withErrorHandler(
  handler: (...args: any[]) => Promise<NextResponse>
) {
  return async (...args: any[]): Promise<NextResponse> => {
    try {
      return await handler(...args);
    } catch (error: any) {
      logger.error("Unhandled API error", {
        message: error.message,
        stack: error.stack,
      });

      return NextResponse.json(
        {
          error: "Internal server error",
          message:
            process.env.NODE_ENV === "development"
              ? error.message
              : "Something went wrong",
        },
        { status: 500 }
      );
    }
  };
}
