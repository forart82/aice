import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { didYouMeanSymbol, didYouMeanFile } from "../../src/tools/suggest.js";
import { extractSymbolFromAiceSource } from "../../src/tools/context.js";
import { spliceSource } from "../../src/tools/splice.js";
import { isEphemeralWorkspace, recordTelemetryEvent } from "../../src/telemetry/index.js";
import { recordTelemetryError } from "../../src/telemetry/analyze.js";

describe("Resilience & Suggestion Engine", () => {
  describe("didYouMeanSymbol", () => {
    const tsCode = `
export class UserService {
  public getUserById(id: string): User {
    return { id, name: "Alice" };
  }
  public saveUserProfile(profile: Profile): void {}
}
export function calculateTax(amount: number): number {
  return amount * 0.2;
}
`;

    it("suggests closest matching symbol for typos", () => {
      const hint = didYouMeanSymbol(tsCode, "getUserId");
      expect(hint).toContain("Did you mean: getUserById");
    });

    it("lists available symbols when regex pattern misses", () => {
      const hint = didYouMeanSymbol(tsCode, "/nonExistentPattern/");
      expect(hint).toContain("Available symbols");
      expect(hint).toContain("UserService");
    });

    it("returns empty string when no symbols found in empty code", () => {
      expect(didYouMeanSymbol("// empty comment only", "foo")).toBe("");
    });
  });

  describe("didYouMeanFile", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-suggest-test-"));
      fs.writeFileSync(path.join(tmpDir, "database_connection.ts"), "export const db = 1;");
      fs.writeFileSync(path.join(tmpDir, "user_controller.ts"), "export const user = 2;");
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("suggests closest existing files when target does not exist", () => {
      const nonExistent = path.join(tmpDir, "database_conection.ts");
      const hint = didYouMeanFile(nonExistent);
      expect(hint).toContain("Did you mean:");
      expect(hint).toContain("database_connection.ts");
    });
  });

  describe("Integration in context and splice errors", () => {
    const tsCode = `
export function calculateTotal(price: number, tax: number): number {
  return price + tax;
}
`;

    it("provides did-you-mean hint when extractSymbolFromAiceSource misses symbol", () => {
      expect(() => {
        extractSymbolFromAiceSource(tsCode, "calcTotal", "src/calc.ts");
      }).toThrowError(/Symbol 'calcTotal' not found[\s\S]*Did you mean: calculateTotal/);
    });

    it("provides available-symbols hint when extractSymbolFromAiceSource regex misses", () => {
      expect(() => {
        extractSymbolFromAiceSource(tsCode, "/nonExistent/", "src/calc.ts");
      }).toThrowError(/Pattern '\/nonExistent\/' not found[\s\S]*Available symbols: calculateTotal/);
    });

    it("provides did-you-mean hint when spliceSource misses symbol", () => {
      const aiceCode = `fn calculateTotal(price: int, tax: int) -> int:\n  return price + tax\n`;
      expect(() => {
        spliceSource(aiceCode, { symbol: "calcTotal", body: "return 42" }, "src/calc.aice");
      }).toThrowError(/Symbol 'calcTotal' not found[\s\S]*Did you mean: calculateTotal/);
    });
  });

  describe("Telemetry Ephemeral Workspace Filtering", () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      delete process.env.AICE_TELEMETRY_PATH;
      delete process.env.AICE_TELEMETRY_ERRORS_PATH;
      delete process.env.AICE_HOME;
    });

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it("identifies /tmp and /var/tmp as ephemeral", () => {
      expect(isEphemeralWorkspace("/tmp/my-sandbox")).toBe(true);
      expect(isEphemeralWorkspace("/tmp")).toBe(true);
      expect(isEphemeralWorkspace("/var/tmp/run-123")).toBe(true);
    });

    it("identifies swarm-* directories as ephemeral", () => {
      expect(isEphemeralWorkspace("/home/user/dev/swarm-worker-1")).toBe(true);
      expect(isEphemeralWorkspace("/opt/swarm-temp/repo")).toBe(true);
    });

    it("allows standard permanent project workspaces", () => {
      expect(isEphemeralWorkspace("/home/user/dev/my-project")).toBe(false);
      expect(isEphemeralWorkspace("/workspace/app")).toBe(false);
    });

    it("does not treat path as ephemeral if explicit telemetry path is provided", () => {
      expect(isEphemeralWorkspace("/tmp/my-sandbox", "/custom/telemetry.jsonl")).toBe(false);
    });

    it("does not treat path as ephemeral if AICE_HOME is set", () => {
      process.env.AICE_HOME = "/custom/home";
      expect(isEphemeralWorkspace("/tmp/my-sandbox")).toBe(false);
    });

    it("suppresses recordTelemetryEvent when in ephemeral workspace", () => {
      const origCwd = process.cwd();
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-telemetry-test-"));
      try {
        process.chdir(tmpDir);
        const event = recordTelemetryEvent({
          targetPath: "sample.ts",
          operation: "context",
          nativeText: "let a = 1;",
          aiceText: "a=1",
        });
        expect(event).toBeNull();
      } finally {
        process.chdir(origCwd);
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it("suppresses recordTelemetryError when in ephemeral workspace", () => {
      const origCwd = process.cwd();
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-telemetry-err-"));
      try {
        process.chdir(tmpDir);
        const errEvent = recordTelemetryError({
          operation: "splice",
          errorMessage: "Sample test error",
        });
        expect(errEvent).toBeNull();
      } finally {
        process.chdir(origCwd);
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });

  describe("ReferenceError Regression Verification", () => {
    it("ensures extractSymbolFromAiceSource and spliceSource do not throw ReferenceError", () => {
      const sample = `
export class OrderProcessor {
  processOrder(id: string): boolean {
    return true;
  }
}
`;
      try {
        extractSymbolFromAiceSource(sample, "processOrder", "sample.ts");
      } catch (err: any) {
        expect(err.name).not.toBe("ReferenceError");
      }

      try {
        spliceSource(sample, { symbol: "processOrder", code: "return false;" }, "sample.ts");
      } catch (err: any) {
        expect(err.name).not.toBe("ReferenceError");
      }
    });
  });
});
