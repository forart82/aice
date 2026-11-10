import { describe, expect, it } from "vitest";
import { extractSymbolFromAiceSource } from "../../src/tools/context.js";
import { spliceSource } from "../../src/tools/splice.js";
describe("Self-Healing Line Range Clamping & Tolerant Splicing", () => {
  const shortSource = `line 1
line 2
line 3
line 4
line 5`;

  it("automatically clamps endLine to totalLines when endLine exceeds file length in context", () => {
    const extracted = extractSymbolFromAiceSource(shortSource, "L2-L999", "short.md");
    expect(extracted).toContain("line 2");
    expect(extracted).toContain("line 5");
    expect(extracted).not.toContain("Invalid line range");
    expect(extracted).toBe("line 2\nline 3\nline 4\nline 5");
  });

  it("suggests :eof / :append when startLine exceeds file length in context", () => {
    expect(() => {
      extractSymbolFromAiceSource(shortSource, "L20-L30", "short.md");
    }).toThrow(/:eof|:append/);
  });
  it("automatically clamps endLine to totalLines when splicing a range past EOF", () => {
    const res = spliceSource(
      shortSource,
      "L4-L50",
      "line 4 modified\nline 5 modified",
      false,
      "short.md",
    );
    expect(res.success).toBe(true);
    expect(res.modifiedCode).toBe("line 1\nline 2\nline 3\nline 4 modified\nline 5 modified");
  });

  it("suggests :eof / :append when startLine exceeds file length during splice", () => {
    expect(() => {
      spliceSource(shortSource, "L10-L20", "new line", false, "short.md");
    }).toThrow(/:eof|:append/);
  });
});
