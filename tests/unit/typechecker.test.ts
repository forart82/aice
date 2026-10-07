import { describe, expect, it } from "vitest";
import { parseAil } from "../../src/core/parser.ts";
import { typecheckAil } from "../../src/typechecker/checker.ts";

function check(src: string) {
  const { document } = parseAil(src);
  if (!document) throw new Error("Document failed to parse");
  return typecheckAil(document);
}

describe("AIL Sound Type & Invariant Checker (Pillars 1, 3, 4)", () => {
  it("typechecks valid strongly-typed modules", () => {
    const src = `
      (@module test/valid
        (: User (% id !s age !i active !b))
        (! getUserId (-> (u User) !s)
          "user-123"
        )
      )
    `;

    const result = check(src);
    expect(result.valid).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("Pillar 3: Rejects implicit type coercion on arithmetic operations", () => {
    const src = `
      (@module test/coercion
        (! badAdd (-> (a !s b !i) !s)
          (+ a b)
        )
      )
    `;

    const result = check(src);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    const diag = result.diagnostics[0];
    expect(diag.violation.code).toBe("AIL_E2002_IMPLICIT_COERCION_FORBIDDEN");
    expect(diag.invariant_correction_rule).toContain("str:concat");
    expect(diag.candidate_fix).toBeDefined();
  });

  it("detects return type mismatches", () => {
    const src = `
      (@module test/mismatch
        (! getCount (-> () !s)
          42
        )
      )
    `;

    const result = check(src);
    expect(result.valid).toBe(false);
    const diag = result.diagnostics.find(
      (d) => d.violation.code === "AIL_E2001_RETURN_TYPE_MISMATCH",
    );
    expect(diag).toBeDefined();
    expect(diag?.violation.message).toContain(
      "declares return type '!s', but body evaluates to '!i'",
    );
  });

  it("validates fallible Result types and (? ...) unpack", () => {
    const src = `
      (@module test/result
        (: Account (% id !s balance !f))
        (! fetchAccount (-> (id !s) Result[Account, !s])
          (% ok true value (% id "acc-1" balance 100.0))
        )
        (! processAccount (-> (id !s) Account)
          (do
            (:= acc (? (fetchAccount id)))
            acc
          )
        )
      )
    `;

    const result = check(src);
    expect(result.valid).toBe(true);
  });

  it("flags invalid (? ...) unpack on non-Result types", () => {
    const src = `
      (@module test/invalid-unpack
        (! getNumber (-> () !i) 42)
        (! test (-> () !i)
          (? (getNumber))
        )
      )
    `;

    const result = check(src);
    expect(result.valid).toBe(false);
    const diag = result.diagnostics.find(
      (d) => d.violation.code === "AIL_E1005_INVALID_TRY_UNPACK",
    );
    expect(diag).toBeDefined();
  });

  it("Pillar 1: Typechecks canonical string and collection primitives", () => {
    const src = `
      (@module test/canonical
        (! testSlice (-> (text !s) !s)
          (str:slice text 0 5)
        )
        (! testLen (-> (text !s) !i)
          (str:len text)
        )
      )
    `;

    const result = check(src);
    expect(result.valid).toBe(true);
  });

  it("Pillar 4: Produces structured machine-readable JSON error telemetry", () => {
    const src = `
      (@module test/telemetry
        (! badCondition (-> () !i)
          (?if "not-a-bool" 1 2)
        )
      )
    `;

    const result = check(src);
    expect(result.valid).toBe(false);
    const diag = result.diagnostics[0];

    expect(diag.status).toBe("REJECTED");
    expect(diag.error_phase).toBe("TYPECHECKING");
    expect(diag.span?.line).toBeDefined();
    expect(diag.violation.code).toBe("AIL_E2003_NON_BOOLEAN_CONDITION");
    expect(diag.invariant_correction_rule).toBeDefined();
  });
});
