import { pingA } from "./cycle_a.js";

export function pingB(depth: number): number {
  if (depth <= 0) {
    return 0;
  }
  return 1 + pingA(depth - 1);
}
