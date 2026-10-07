export interface UserProfile {
  id: string;
  username: string;
  score: number;
}

export function sanitizeUsername(raw: string): string {
  return raw.slice(0, 10);
}

export function computeTotal(base: number, bonus: number): number {
  return base + bonus;
}
