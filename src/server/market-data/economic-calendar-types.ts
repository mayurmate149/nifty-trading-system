export type CalendarImpactLevel = "high" | "medium" | "low" | "holiday";

export type CalendarEventKind = "macro" | "market_holiday";

export interface TraderCalendarEvent {
  id: string;
  date: string;
  timeIst: string | null;
  region: string;
  title: string;
  impact: CalendarImpactLevel;
  kind: CalendarEventKind;
  forecast: string | null;
  previous: string | null;
  actual: string | null;
  source: "finnhub" | "nse";
}

export interface TraderCalendarPayload {
  generatedAt: string;
  from: string;
  to: string;
  events: TraderCalendarEvent[];
  sources: string[];
  notice?: string;
  /** Present when Finnhub was called; helps diagnose empty calendars. */
  finnhubMeta?: { rawRowCount: number; keptRowCount: number };
}
