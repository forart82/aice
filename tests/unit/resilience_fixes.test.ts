import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { didYouMeanSymbol, didYouMeanFile } from "../../src/tools/suggest.js";
import { extractSymbolFromAiceSource, generateContext } from "../../src/tools/context.js";
import { spliceSource } from "../../src/tools/splice.js";
import { isEphemeralWorkspace, recordTelemetryEvent } from "../../src/telemetry/index.js";
import { recordTelemetryError } from "../../src/telemetry/analyze.js";
import { mineProjectIdioms } from "../../src/idioms/idiom-miner.js";
import { resolveWorktreeRoot } from "../../src/config/path-resolver.js";
import {
  auditTranscriptCompliance,
  verifyWorkspaceOnDisk,
  ALL_REAL_AGENT_BENCHMARKS,
} from "../../benchmarks/run-real-agents.js";

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
      const result = extractSymbolFromAiceSource(tsCode, "/nonExistent/", "src/calc.ts");
      expect(result).toContain("// Pattern '/nonExistent/' had 0 matches in src/calc.ts");
      expect(result).toContain("Available symbols: calculateTotal");
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

  describe("AICE 2.0 Hardening & Resilience Regressions", () => {
    let tmpDir: string = "";

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-resilience-"));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    describe("Idiom fast-path bailout", () => {
      it("triggers on non-repeating code and sets zeroIdiomsReason", () => {
        const files = [
          {
            path: "math.ts",
            content: "export function add(a: number, b: number): number { return a + b; }",
          },
          {
            path: "util.ts",
            content: "export const version = '1.0.0';",
          },
        ];
        const res = mineProjectIdioms(files);
        expect(Object.keys(res.idioms).length).toBe(0);
        expect(res.zeroIdiomsReason).toBe("insufficient_repetition");
      });

      it("omits empty idiom headers in generated context on non-repeating projects", async () => {
        const configPath = path.join(tmpDir, "aice.config.json");
        fs.writeFileSync(configPath, JSON.stringify({ enabled: true, idioms: true }, null, 2));

        const targetFile = path.join(tmpDir, "lone.ts");
        fs.writeFileSync(targetFile, "export function uniqueWorker(): string { return 'lone'; }");

        const result = await generateContext(targetFile, { idioms: true, projectRoot: tmpDir });
        expect(result.zeroIdiomsReason).toBe("insufficient_repetition");
        expect(result.formattedBundle).not.toContain("# @idioms available:");
      });
    });

    describe("Fault-tolerant AST decompilation fallback", () => {
      it("degrades gracefully to line slices without throwing or exiting code 1 on broken syntax", async () => {
        const brokenCss = path.join(tmpDir, "broken.css");
        fs.writeFileSync(
          brokenCss,
          "body {\n  color: red;\n  invalid { css syntax error here }}}\n",
        );

        const result = await generateContext(brokenCss, { projectRoot: tmpDir });
        expect(result).toBeDefined();
        expect(result.targetContent).toContain("1│ body {");
        expect(result.targetContent).toContain("2│   color: red;");
      });

      it("gracefully slices line-range on broken syntax without throwing", async () => {
        const brokenFile = path.join(tmpDir, "broken.rs");
        fs.writeFileSync(
          brokenFile,
          'fn main() {\n    let x = ;;; invalid rust\n    println!("hello");\n}\n',
        );

        const result = await generateContext(brokenFile, { symbol: "L1-L3", projectRoot: tmpDir });
        expect(result).toBeDefined();
        expect(result.targetContent).toContain("1│ fn main() {");
        expect(result.targetContent).toContain("2│     let x = ;;; invalid rust");
      });
    });

    describe("Silent Git worktree boundary resolution", () => {
      it("resolves non-git workspace directories without throwing Git exit code 128", () => {
        const nonGitDir = path.join(tmpDir, "sandbox");
        fs.mkdirSync(nonGitDir, { recursive: true });
        fs.writeFileSync(path.join(nonGitDir, "package.json"), JSON.stringify({ name: "sandbox" }));

        // Ensure this directory has no .git
        expect(fs.existsSync(path.join(nonGitDir, ".git"))).toBe(false);

        let resolved: string | undefined;
        expect(() => {
          resolved = resolveWorktreeRoot(nonGitDir);
        }).not.toThrow();

        expect(resolved).toBe(nonGitDir);
      });

      it("resolves nested non-git subdirectory to parent package.json cleanly", () => {
        const projectDir = path.join(tmpDir, "isolated-pkg");
        const subDir = path.join(projectDir, "src", "nested", "deep");
        fs.mkdirSync(subDir, { recursive: true });
        fs.writeFileSync(
          path.join(projectDir, "package.json"),
          JSON.stringify({ name: "isolated-pkg" }),
        );

        let resolved: string | undefined;
        expect(() => {
          resolved = resolveWorktreeRoot(subDir);
        }).not.toThrow();

        expect(resolved).toBe(projectDir);
      });
    });

    describe("Anti-cheat & workaround enforcement gate", () => {
      it("correctly catches forbidden cat << 'EOF' > ... and fails compliance audit", () => {
        const transcriptPath = path.join(tmpDir, "transcript.jsonl");
        const cheatEntry = {
          step_index: 1,
          type: "PLANNER_RESPONSE",
          tool_calls: [
            {
              name: "run_command",
              args: {
                CommandLine: "cat << 'EOF' > src/index.ts\nconsole.log('cheat');\nEOF",
              },
            },
          ],
        };
        fs.writeFileSync(transcriptPath, JSON.stringify(cheatEntry) + "\n");

        const compliance = auditTranscriptCompliance(transcriptPath, "aice_no_idioms");
        expect(compliance.compliant).toBe(false);
        expect(compliance.violations.some((v) => v.includes("Forbidden shell file writer"))).toBe(
          true,
        );
      });

      it("permits canonical AICE heredoc streaming without violation", () => {
        const transcriptPath = path.join(tmpDir, "transcript_valid.jsonl");
        const validEntry = {
          step_index: 1,
          type: "PLANNER_RESPONSE",
          tool_calls: [
            {
              name: "run_command",
              args: {
                CommandLine:
                  "aice splice --stdin << 'EOF'\n=== src/index.ts ===\nexport const ok = 1;\nEOF",
              },
            },
          ],
        };
        fs.writeFileSync(transcriptPath, JSON.stringify(validEntry) + "\n");

        const compliance = auditTranscriptCompliance(transcriptPath, "aice_no_idioms");
        expect(compliance.compliant).toBe(true);
        expect(compliance.violations.length).toBe(0);
      });

      it("disqualifies workspace verification on disk when cheating transcript is detected", () => {
        const workspaceDir = path.join(tmpDir, "mock-run");
        fs.mkdirSync(workspaceDir, { recursive: true });
        const cheatTranscript = path.join(workspaceDir, "transcript.jsonl");
        const cheatEntry = {
          step_index: 2,
          type: "PLANNER_RESPONSE",
          tool_calls: [
            {
              name: "run_command",
              args: {
                CommandLine: "echo 'cheat' > index.js",
              },
            },
          ],
        };
        fs.writeFileSync(cheatTranscript, JSON.stringify(cheatEntry) + "\n");

        const spec = ALL_REAL_AGENT_BENCHMARKS[0];
        const res = verifyWorkspaceOnDisk(
          spec,
          workspaceDir,
          42,
          1,
          cheatTranscript,
          "aice_no_idioms",
        );
        expect(res.verified).toBe(false);
        expect(
          res.details.some((d) => d.includes("DISQUALIFIED: Forbidden workaround detected")),
        ).toBe(true);
      });
    });
  });
});
