export interface UserSession {
  sessionId: string;
  userId: string;
  role: string;
  createdAt: number;
}

export function UserSession(sessionId: string, userId: string, role: string, createdAt: number): UserSession {
  return { sessionId, userId, role, createdAt };
}

export interface AuthRequest {
  username: string;
  password: string;
  rememberMe: boolean;
}

export function AuthRequest(username: string, password: string, rememberMe: boolean): AuthRequest {
  return { username, password, rememberMe };
}

export function sanitize(raw: string): string {
  return raw.slice(0, 24);
}

export function validatePassword(pass: string): unknown | unknown {
  if ((pass.length < 8)) {
    return { ok: false, error: "Password too short" };
  }
  return { ok: true, value: true };
}

export function authenticateUser(req: AuthRequest): unknown | unknown {
  const valid = validatePassword(req.password).value;
  const cleanUser = sanitize(req.username);
  const session = { sessionId: ("sess_" + cleanUser), userId: cleanUser, role: "member", createdAt: 1711929600 };
  return { ok: true, value: session };
}
