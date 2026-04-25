/** Auto-exit engine log line (UI + WebSocket; mirrors server notifier shape). */
export interface AutoExitStreamEvent {
  type: string;
  positionId: string;
  message: string;
  timestamp: number;
  data?: Record<string, unknown>;
}
