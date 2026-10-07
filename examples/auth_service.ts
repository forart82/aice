export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

export interface UserSession {
  sessionId: string;
  userId: string;
  role: string;
  createdAt: number;
}

export interface AuthRequest {
  username: string;
  password: string;
  rememberMe: boolean;
}

export interface AuthResponse {
  token: string;
  session: UserSession;
}

export function sanitizeUsername(raw: string): string {
  return raw.slice(0, 24);
}

export function validatePassword(password: string): Result<boolean, string> {
  return (password.length < 8 ? { ok: false, error: "Password must be at least 8 characters" } : { ok: true, value: true });
}

export function authenticateUser(req: AuthRequest, currentTimestamp: number): Result<AuthResponse, string> {
  const cleanUsername = sanitizeUsername(req.username);
  const __res_1 = validatePassword(req.password);
  if (!__res_1.ok) return __res_1;
  const isPasswordValid = __res_1.value;
  const session = { sessionId: "sess_" + cleanUsername, userId: cleanUsername, role: "member", createdAt: currentTimestamp };
  return { ok: true, value: { token: "jwt_" + cleanUsername, session: session } };
}
