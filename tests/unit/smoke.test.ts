import { describe, expect, it } from "vitest";
import { AIL_EXTENSION, AIL_VERSION } from "../../src/index.ts";

describe("AIL Compiler Smoke Test", () => {
  it("exports correct version and extension constants", () => {
    expect(AIL_VERSION).toBe("0.1.0");
    expect(AIL_EXTENSION).toBe(".ail");
  });
});
