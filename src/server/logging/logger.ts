/**
 * Structured Logger
 *
 * Uses pino for JSON-formatted, daily-rotated logs.
 * Categories: API_CALL, ORDER_TRIGGER, EXIT, ERROR, HEALTH, PERFORMANCE
 */

// TODO: Phase 0 — Configure pino with:
//   - Console transport (dev)
//   - File transport with daily rotation (prod)
//   - Log level from env

export function createLogger(module: string) {
  return {
    info: (msg: string, data?: any) =>
      console.log(JSON.stringify({ level: "info", module, msg, data, ts: new Date().toISOString() })),
    warn: (msg: string, data?: any) =>
      console.warn(JSON.stringify({ level: "warn", module, msg, data, ts: new Date().toISOString() })),
    error: (msg: string, data?: any) =>
      console.error(JSON.stringify({ level: "error", module, msg, data, ts: new Date().toISOString() })),
    debug: (msg: string, data?: any) =>
      console.debug(JSON.stringify({ level: "debug", module, msg, data, ts: new Date().toISOString() })),
  };
}
