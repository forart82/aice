import * as fs from "node:fs";
import * as path from "node:path";

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

function rank(query: string, candidates: Iterable<string>, limit: number): string[] {
  const q = query.toLowerCase();
  const scored: Array<{ c: string; s: number }> = [];
  for (const c of new Set(candidates)) {
    const cl = c.toLowerCase();
    let s = levenshtein(q, cl);
    if (cl.includes(q) || (cl.length >= 3 && q.includes(cl))) s = Math.min(s, 1);
    scored.push({ c, s });
  }
  scored.sort((x, y) => x.s - y.s || x.c.localeCompare(y.c));
  const maxDist = Math.max(3, Math.floor(q.length / 2));
  const close = scored.filter((x) => x.s <= maxDist).slice(0, limit);
  return (close.length > 0 ? close : scored.slice(0, limit)).map((x) => x.c);
}

const DECL_RE =
  /\b(?:(?:public|private|protected|static|async|get|set)\s+)+(?:function\*?\s+)?([A-Za-z_$][\w$.-]*)|(?:\b(?:function\*?|class|interface|enum|type|const|let|var|def|fn|struct|trait|impl|func|label|test|fun|namespace|module)\s+["']?([A-Za-z_$][\w$.-]*))/g;

/** Returns a "\nDid you mean: ..." hint (or "") for a missing symbol/pattern selector. */
export function didYouMeanSymbol(source: string, selector: string): string {
  try {
    const names: string[] = [];
    for (const m of source.matchAll(DECL_RE)) {
      const name = m[1] || m[2];
      if (name) names.push(name);
    }
    if (names.length === 0) return "";
    let q = selector.trim();
    const re = /^\/(.+)\/[gimsuy]*$/.exec(q);
    const isPattern = !!re;
    if (re) q = re[1].replace(/[^\w$.]/g, "");
    const top = q ? rank(q.split(".").pop() || q, names, 5) : names.slice(0, 5);
    const label = isPattern ? "Available symbols" : "Did you mean";
    return `\n${label}: ${top.join(", ")}`;
  } catch {
    return "";
  }
}

/** Returns a "\nDid you mean: ..." hint (or "") for a missing file path. */
export function didYouMeanFile(targetPath: string): string {
  try {
    const abs = path.resolve(targetPath);
    let dir = path.dirname(abs);
    while (dir !== path.dirname(dir) && !fs.existsSync(dir)) dir = path.dirname(dir);
    const base = path.basename(abs);
    const entries = fs.readdirSync(dir).filter((e) => !e.startsWith("."));
    if (entries.length === 0) return "";
    const top = rank(base, entries, 5).map((e) => path.relative(process.cwd(), path.join(dir, e)));
    return `\nDid you mean: ${top.join(", ")}`;
  } catch {
    return "";
  }
}
