/**
 * Single source for simulator toggle + mock base URL.
 * Simulator is OFF unless explicitly enabled — avoids stray values turning it on.
 */

function envFlagEnabled(raw: string | undefined): boolean {
  const v = raw?.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

/** When true, auth + broker-proxy call local mock server instead of 5paisa. */
export function useSimulatorTrading(): boolean {
  return envFlagEnabled(process.env.USE_SIMULATOR);
}

/**
 * Fully qualified base (no trailing slash). Used only when mock trading is enabled.
 */
export function getSimulatorHttpBase(simulatorActive: boolean): string {
  if (!simulatorActive) {
    return "http://localhost:9500";
  }
  const raw = (process.env.SIMULATOR_URL || "").trim().replace(/\/+$/, "");
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    return raw;
  }
  if (raw.length > 0) {
    console.warn(
      `[ENV] SIMULATOR_URL must start with http:// or https:// (got "${raw.slice(0, 48)}${raw.length > 48 ? "…" : ""}"). Using http://localhost:9500.`,
    );
  }
  return "http://localhost:9500";
}
