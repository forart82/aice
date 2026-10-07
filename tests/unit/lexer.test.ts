import { describe, expect, it } from "vitest";
import { tokenizeAil } from "../../src/core/lexer.ts";

describe("AIL Lexer & Scanner", () => {
  it("scans module header and manifest tokens", () => {
    const src = `(@module app/core (* target "typescript" strict true *))`;
    const { tokens } = tokenizeAil(src);

    expect(tokens[0].type).toBe("AT_MODULE");
    expect(tokens[1].value).toBe("app/core");
    expect(tokens[2].type).toBe("LPAREN");
    expect(tokens[3].value).toBe("*");
    expect(tokens[4].value).toBe("target");
    expect(tokens[5].value).toBe("typescript");
    expect(tokens[6].value).toBe("strict");
    expect(tokens[7].value).toBe("true");
    expect(tokens[8].value).toBe("*");
    expect(tokens[9].type).toBe("RPAREN");
    expect(tokens[10].type).toBe("RPAREN");
    expect(tokens[11].type).toBe("EOF");
  });

  it("accurately scans numbers and string literals with escape sequences", () => {
    const src = `"hello \\"world\\"\n" 42 -17.5 3.1415`;
    const { tokens } = tokenizeAil(src);

    expect(tokens[0].type).toBe("STRING");
    expect(tokens[0].value).toBe('hello "world"\n');
    expect(tokens[1].type).toBe("NUMBER");
    expect(tokens[1].value).toBe("42");
    expect(tokens[2].type).toBe("NUMBER");
    expect(tokens[2].value).toBe("-17.5");
    expect(tokens[3].type).toBe("NUMBER");
    expect(tokens[3].value).toBe("3.1415");
  });

  it("scans compound prefixes without prefix ambiguity", () => {
    const src = `(:= a 1) (: T !s) (! fn ()) (# Comp ()) (< div >) (. a 1 .) (& style (. c 1 .)) (== a 1) (? b) (?if c d e) (do a)`;
    const { tokens } = tokenizeAil(src);
    const types = tokens.map((t) => t.type);

    expect(types).toContain("ASSIGN");
    expect(types).toContain("TYPE_DECL");
    expect(types).toContain("FN_DECL");
    expect(types).toContain("COMPONENT_DECL");
    expect(types).toContain("LAYOUT_OPEN");
    expect(types).toContain("LAYOUT_CLOSE");
    expect(types).toContain("ATTRS_OPEN");
    expect(types).toContain("ATTRS_CLOSE");
    expect(types).toContain("STYLE_DECL");
    expect(types).toContain("MATCH");
    expect(types).toContain("TRY_UNPACK");
    expect(types).toContain("IF_EXPR");
    expect(types).toContain("DO_BLOCK");
  });

  it("calculates exact source coordinates (line, col, offset)", () => {
    const src = "line1\n  line2";
    const { tokens } = tokenizeAil(src);

    expect(tokens[0].value).toBe("line1");
    expect(tokens[0].span.start.line).toBe(1);
    expect(tokens[0].span.start.col).toBe(1);

    expect(tokens[1].value).toBe("line2");
    expect(tokens[1].span.start.line).toBe(2);
    expect(tokens[1].span.start.col).toBe(3);
  });
});
