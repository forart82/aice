import { describe, expect, it } from "vitest";
import { tokenizeAil } from "../../src/core/lexer.ts";
import { CstTriviaTable } from "../../src/core/trivia.ts";

describe("AIL CST Trivia Engine", () => {
  it("captures line comments and blank lines without contaminating AST tokens", () => {
    const src = `
      // SPDX-License-Identifier: Apache-2.0
      ;; Core math operations
      # Python style comment

      (@module core/math)
    `;

    const { tokens, trivia } = tokenizeAil(src);

    expect(tokens[0].type).toBe("AT_MODULE");
    expect(tokens[1].value).toBe("core/math");

    expect(trivia.length).toBeGreaterThan(0);
    const lineComments = trivia.filter((t) => t.kind === "LINE_COMMENT");
    expect(lineComments).toHaveLength(3);
    expect(lineComments[0].content).toContain("SPDX-License-Identifier");
    expect(lineComments[1].content).toContain("Core math operations");
    expect(lineComments[2].content).toContain("Python style comment");
  });

  it("captures block comments and docstrings", () => {
    const src = `
      /*
       * Comprehensive block comment
       */
      (@module test)
    `;

    const { trivia } = tokenizeAil(src);
    const blockComments = trivia.filter((t) => t.kind === "BLOCK_COMMENT");

    expect(blockComments).toHaveLength(1);
    expect(blockComments[0].content).toContain("Comprehensive block comment");
  });

  it("associates trivia with node IDs and serializes losslessly to JSON", () => {
    const table = new CstTriviaTable();
    table.addLeadingTrivia("node_0", {
      kind: "LINE_COMMENT",
      content: "// Important invariant",
      span: {
        start: { line: 1, col: 1, offset: 0 },
        end: { line: 1, col: 23, offset: 23 },
      },
    });
    table.setIndentation("node_0", "  ");

    const json = table.toJSON();
    expect(json.node_0.leading).toHaveLength(1);
    expect(json.node_0.indentation).toBe("  ");

    const restored = CstTriviaTable.fromJSON(json);
    expect(restored.getTrivia("node_0")?.leading[0].content).toBe("// Important invariant");
  });
});
