/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for CST Trivia Table (Phase 2.1).
 */

import { describe, expect, it } from "vitest";
import { CstTriviaTable } from "../../src/core/trivia.js";

describe("CstTriviaTable", () => {
  it("creates an empty trivia table", () => {
    const table = new CstTriviaTable();
    expect(table.size()).toBe(0);
    expect(table.getTrivia("node:1")).toBeUndefined();
  });

  it("stores and retrieves leading trivia", () => {
    const table = new CstTriviaTable();
    table.addLeadingTrivia("fn:calculate", {
      kind: "DOCSTRING",
      content: "/** Calculates discount */",
    });
    table.addLeadingTrivia("fn:calculate", {
      kind: "LINE_COMMENT",
      content: "// Inline comment",
    });

    const entry = table.getTrivia("fn:calculate");
    expect(entry).toBeDefined();
    expect(entry?.leading).toHaveLength(2);
    expect(entry?.leading[0].kind).toBe("DOCSTRING");
    expect(entry?.leading[1].kind).toBe("LINE_COMMENT");
  });

  it("stores and retrieves trailing trivia", () => {
    const table = new CstTriviaTable();
    table.addTrailingTrivia("stmt:return", {
      kind: "LINE_COMMENT",
      content: "// returns computed total",
    });

    const entry = table.getTrivia("stmt:return");
    expect(entry).toBeDefined();
    expect(entry?.trailing).toHaveLength(1);
    expect(entry?.trailing[0].content).toBe("// returns computed total");
  });

  it("sets indentation and blank lines formatting metadata", () => {
    const table = new CstTriviaTable();
    table.setIndentation("type:User", "    ");
    table.setBlankLinesBefore("type:User", 2);

    const entry = table.getTrivia("type:User");
    expect(entry?.indentation).toBe("    ");
    expect(entry?.blankLinesBefore).toBe(2);
  });

  it("serializes to and deserializes from JSON losslessly", () => {
    const original = new CstTriviaTable();
    original.addLeadingTrivia("type:Product", {
      kind: "BLOCK_COMMENT",
      content: "/* Core Product Domain Entity */",
    });
    original.addTrailingTrivia("type:Product", {
      kind: "LINE_COMMENT",
      content: "// End of Product entity",
    });
    original.setBlankLinesBefore("type:Product", 1);
    original.setIndentation("type:Product", "  ");

    const json = original.toJSON();
    const restored = CstTriviaTable.fromJSON(json);

    expect(restored.size()).toBe(original.size());
    const restoredEntry = restored.getTrivia("type:Product");
    expect(restoredEntry?.leading[0].content).toBe("/* Core Product Domain Entity */");
    expect(restoredEntry?.trailing[0].content).toBe("// End of Product entity");
    expect(restoredEntry?.blankLinesBefore).toBe(1);
    expect(restoredEntry?.indentation).toBe("  ");
  });
});
