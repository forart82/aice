import { pingB } from "./cycle_b.js";

export function pingA(depth: number): number {
  if (depth <= 0) {
    return 0;
  }
  return 1 + pingB(depth - 1);
}
