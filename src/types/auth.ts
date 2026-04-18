// ─── Auth Types ──────────────────────────────

export interface LoginRequest {
  requestToken: string;
  redirectUri: string;
}

export interface LoginResponse {
  success: boolean;
  clientCode: string;
  expiresAt: string; // ISO8601
}

export interface UserInfo {
  clientCode: string;
  name: string;
}

export interface AuthSession {
  userId: string;
  clientCode: string;
  accessToken: string; // server-side only, never sent to client
  expiresAt: Date;
}
