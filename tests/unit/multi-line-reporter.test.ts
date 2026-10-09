/**
 * Unit tests for Multi-Line Terminal Reporter / TUI Engine (Step 2).
 */

import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  attachReporterToPool,
  ConcurrencyPool,
  createPoolReporterCallbacks,
  MultiLineReporter,
  type TaskItem,
} from "../../src/runner/index.js";

function createMockStream(isTTY = false) {
  const stream = new PassThrough();
  (stream as unknown as { isTTY: boolean }).isTTY = isTTY;
  let output = "";
  stream.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf-8");
  });
  return {
    stream,
    getOutput: () => output,
    clear: () => {
      output = "";
    },
  };
}

describe("AIL 2.0 Multi-Line Terminal Reporter / TUI", () => {
  describe("TTY Interactive Mode", () => {
    it("emits ANSI cursor hide on start and show on finish", () => {
      const mock = createMockStream(true);
      const reporter = new MultiLineReporter({
        concurrency: 2,
        stream: mock.stream,
        isTTY: true,
        throttleMs: 0,
      });

      reporter.start("Compile Phase", 5);
      expect(mock.getOutput()).toContain("\x1b[?25l"); // hide cursor

      mock.clear();
      reporter.finish();
      expect(mock.getOutput()).toContain("\x1b[?25h"); // show cursor
    });

    it("renders box framing with header, worker lines, separator, progress, metrics, and footer", () => {
      const mock = createMockStream(true);
      const width = 68;
      const reporter = new MultiLineReporter({
        concurrency: 3,
        stream: mock.stream,
        isTTY: true,
        throttleMs: 0,
        width,
      });

      reporter.start("Universal Transpiler", 10);
      const output = mock.getOutput();

      // Check box boundary characters
      expect(output).toContain("┌─ Universal Transpiler [Concurrency: 3 Workers]");
      expect(output).toContain("Worker 0: [IDLE]");
      expect(output).toContain("Worker 1: [IDLE]");
      expect(output).toContain("Worker 2: [IDLE]");
      expect(output).toContain(
        "├──────────────────────────────────────────────────────────────────┤",
      );
      expect(output).toContain("Progress:   [░░░░░░░░░░░░] 0.0% (0/10 files)");
      expect(output).toContain("Throughput: 0 files/sec");
      expect(output).toContain("Tokens: 0.0%");
      expect(output).toContain(
        "└──────────────────────────────────────────────────────────────────┘",
      );

      // Verify line widths match exactly
      const boxLines = reporter.formatBox();
      expect(boxLines.length).toBe(1 + 3 + 1 + 1 + 1 + 1); // 8 lines
      for (const line of boxLines) {
        expect(line.length).toBe(width);
      }
    });

    it("emits ANSI cursor up and clear line codes on worker updates", () => {
      const mock = createMockStream(true);
      const reporter = new MultiLineReporter({
        concurrency: 2,
        stream: mock.stream,
        isTTY: true,
        throttleMs: 0,
      });

      reporter.start("Test Phase", 4);
      mock.clear();

      reporter.updateWorker(0, "COMPILING", "src/Boss.ts");
      const out1 = mock.getOutput();

      // Should move cursor up by previous line count
      expect(out1).toContain("\x1b[7A");
      // Should clear line and carriage return
      expect(out1).toContain("\r\x1b[2K");
      expect(out1).toContain("Worker 0: [COMPILING] src/Boss.ts");

      mock.clear();
      reporter.updateWorker(1, "DECOMPILING", "src/Player.ts");
      const out2 = mock.getOutput();
      expect(out2).toContain("\x1b[7A");
      expect(out2).toContain("Worker 1: [DECOMPILING] src/Player.ts");
    });

    it("normalizes absolute paths to relative paths in worker lines", () => {
      const mock = createMockStream(true);
      const reporter = new MultiLineReporter({
        concurrency: 2,
        stream: mock.stream,
        isTTY: true,
        throttleMs: 0,
      });

      reporter.start("Normalizer", 2);
      const cwd = process.cwd();
      reporter.updateWorker(0, "SHADOWING", `${cwd}/src/core/parser.ts`);

      const box = reporter.formatBox();
      const worker0Line = box.find((line) => line.includes("Worker 0:"));
      expect(worker0Line).toBeDefined();
      expect(worker0Line).toContain("Worker 0: [SHADOWING] src/core/parser.ts");
      expect(worker0Line).not.toContain(cwd);
    });
  });

  describe("Non-TTY (CI / Piped) Mode", () => {
    it("does not emit cursor jump or clear ANSI escape codes during execution", () => {
      const mock = createMockStream(false);
      const reporter = new MultiLineReporter({
        concurrency: 2,
        stream: mock.stream,
        isTTY: false,
      });

      reporter.start("CI Build", 4);
      reporter.updateWorker(0, "COMPILING", "Boss.ts");
      reporter.updateWorker(1, "COMPILING", "Player.ts");
      reporter.taskCompleted(0, "Boss.ts");
      reporter.taskCompleted(1, "Player.ts");

      const output = mock.getOutput();
      expect(output).not.toContain("\x1b[?25l");
      expect(output).not.toContain("\x1b[?25h");
      expect(output).not.toContain("\x1b[2K");
      expect(output).not.toContain("\r");
      expect(output).not.toContain("\x1b[");
    });

    it("streams clean progress logs on worker updates and failures", () => {
      const mock = createMockStream(false);
      const reporter = new MultiLineReporter({
        concurrency: 2,
        stream: mock.stream,
        isTTY: false,
      });

      reporter.start("CI Pipeline", 5);
      reporter.updateWorker(0, "COMPILING", "src/core/ast.ts");
      reporter.updateWorker(1, "DECOMPILING", "src/emitters/ts.ts");
      reporter.taskFailed(0, "src/core/ast.ts", "Syntax error on line 42");

      const output = mock.getOutput();
      expect(output).toContain("[AIL] (1/5) Compiling src/core/ast.ts...\n");
      expect(output).toContain("[AIL] (2/5) Decompiling src/emitters/ts.ts...\n");
      expect(output).toContain("[AIL] ERROR (src/core/ast.ts): Syntax error on line 42\n");
    });

    it("emits the final summary box on completion without cursor jump codes", () => {
      const mock = createMockStream(false);
      const reporter = new MultiLineReporter({
        concurrency: 2,
        stream: mock.stream,
        isTTY: false,
      });

      reporter.start("AIL Batch", 2);
      reporter.taskCompleted(0, "A.ts");
      reporter.taskCompleted(1, "B.ts");
      mock.clear();

      reporter.finish("Successfully compiled 2 files");
      const finishOutput = mock.getOutput();

      expect(finishOutput).toContain("┌─ AIL Batch [Concurrency: 2 Workers]");
      expect(finishOutput).toContain("Summary:    Successfully compiled 2 files");
      expect(finishOutput).toContain("Progress:   [████████████] 100.0% (2/2 files)");
      expect(finishOutput).toContain(
        "└──────────────────────────────────────────────────────────────────┘",
      );
      expect(finishOutput).not.toContain("\x1b[");
    });
  });

  describe("Progress Bar & Metric Calculations", () => {
    it("computes exact progress bar matching 65.0% (13/20 files) specification", () => {
      const reporter = new MultiLineReporter({
        concurrency: 4,
        stream: new PassThrough(),
        barWidth: 12,
        throttleMs: 0,
      });

      reporter.start("Progress Test", 20);
      for (let i = 0; i < 13; i++) {
        reporter.taskCompleted(i % 4, `file-${i}.ts`);
      }

      const box = reporter.formatBox();
      const progressLine = box.find((line) => line.includes("Progress:"));
      expect(progressLine).toBeDefined();
      expect(progressLine).toContain("Progress:   [████████░░░░] 65.0% (13/20 files)");
    });

    it("computes token reduction percentage matching specification (-28.4%)", () => {
      const reporter = new MultiLineReporter({
        concurrency: 2,
        stream: new PassThrough(),
        throttleMs: 0,
      });

      reporter.start("Tokenomics", 2);
      // target: 1000 tokens, ail: 716 tokens -> -28.4%
      reporter.taskCompleted(0, "A.ts", { targetTokens: 500, ailTokens: 358 });
      reporter.taskCompleted(1, "B.ts", { targetTokens: 500, ailTokens: 358 });

      expect(reporter.totalTargetTokens).toBe(1000);
      expect(reporter.totalAilTokens).toBe(716);
      expect(reporter.tokenSavingsPct).toBeCloseTo(28.4, 1);

      const box = reporter.formatBox();
      const metricsLine = box.find((line) => line.includes("Throughput:"));
      expect(metricsLine).toBeDefined();
      expect(metricsLine).toContain("Tokens: -28.4%");
    });

    it("handles token expansion correctly (+15.0%)", () => {
      const reporter = new MultiLineReporter({
        concurrency: 1,
        stream: new PassThrough(),
        throttleMs: 0,
      });

      reporter.start("Token Expansion", 1);
      reporter.taskCompleted(0, "Exp.ts", { targetTokens: 100, ailTokens: 115 });

      const box = reporter.formatBox();
      const metricsLine = box.find((line) => line.includes("Tokens:"));
      expect(metricsLine).toContain("Tokens: +15.0%");
    });

    it("transitions active workers to DONE on finish", () => {
      const reporter = new MultiLineReporter({
        concurrency: 3,
        stream: new PassThrough(),
        throttleMs: 0,
      });

      reporter.start("Teardown", 3);
      reporter.updateWorker(0, "COMPILING", "A.ts");
      reporter.updateWorker(1, "SHADOWING", "B.ts");
      reporter.updateWorker(2, "ERROR", "C.ts");

      reporter.finish();

      expect(reporter.getWorker(0)?.status).toBe("DONE");
      expect(reporter.getWorker(1)?.status).toBe("DONE");
      expect(reporter.getWorker(2)?.status).toBe("ERROR"); // retains error
    });
  });

  describe("ConcurrencyPool Integration", () => {
    it("seamlessly integrates via pool.attachReporter", async () => {
      const mock = createMockStream(false);
      const reporter = new MultiLineReporter({
        concurrency: 2,
        stream: mock.stream,
        isTTY: false,
      });

      const pool = new ConcurrencyPool<
        string,
        { metrics: { targetTokens: number; ailTokens: number } }
      >({
        concurrency: 2,
      });

      pool.attachReporter(reporter);
      reporter.start("Pool Integration", 4);

      const tasks: TaskItem<string, { metrics: { targetTokens: number; ailTokens: number } }>[] = [
        {
          id: "t1",
          data: "src/Foo.ts",
          run: async () => {
            await new Promise((r) => setTimeout(r, 10));
            return { metrics: { targetTokens: 100, ailTokens: 80 } };
          },
        },
        {
          id: "t2",
          data: "src/Bar.ts",
          run: async () => {
            await new Promise((r) => setTimeout(r, 10));
            return { metrics: { targetTokens: 100, ailTokens: 70 } };
          },
        },
      ];

      const results = await pool.runAll(tasks);
      reporter.finish("Finished pool run");

      expect(results.length).toBe(2);
      expect(reporter.completedTasks).toBe(2);
      expect(reporter.failedTasks).toBe(0);
      expect(reporter.totalTargetTokens).toBe(200);
      expect(reporter.totalAilTokens).toBe(150);
      expect(reporter.tokenSavingsPct).toBe(25);
    });

    it("integrates via reporter.attachToPool and attachReporterToPool helper", async () => {
      const mock = createMockStream(false);
      const reporter = new MultiLineReporter({
        concurrency: 2,
        stream: mock.stream,
        isTTY: false,
      });

      const pool = new ConcurrencyPool<number, number>({ concurrency: 2 });
      attachReporterToPool(reporter, pool, {
        getFile: (task) => `file-${task.data}.ts`,
        getStatus: () => "DECOMPILING",
      });

      reporter.start("Helper Integration", 2);

      const tasks: TaskItem<number, number>[] = [
        {
          id: "1",
          data: 1,
          run: async () => 10,
        },
        {
          id: "2",
          data: 2,
          run: async () => 20,
        },
      ];

      await pool.runAll(tasks);
      reporter.finish();

      expect(reporter.completedTasks).toBe(2);
      const allWorkers = reporter.getAllWorkers();
      expect(allWorkers.length).toBe(2);
      expect(allWorkers.every((w) => w.status === "DONE")).toBe(true);
    });

    it("captures task errors correctly through ConcurrencyPool", async () => {
      const mock = createMockStream(false);
      const reporter = new MultiLineReporter({
        concurrency: 2,
        stream: mock.stream,
        isTTY: false,
      });

      const pool = new ConcurrencyPool<string, void>({ concurrency: 2 });
      reporter.attachToPool(pool);
      reporter.start("Error Tracking", 2);

      const tasks: TaskItem<string, void>[] = [
        {
          id: "t1",
          data: "good.ts",
          run: async () => {},
        },
        {
          id: "t2",
          data: "bad.ts",
          run: async () => {
            throw new Error("Compilation crashed");
          },
        },
      ];

      await pool.runAll(tasks);
      reporter.finish();

      expect(reporter.completedTasks).toBe(1);
      expect(reporter.failedTasks).toBe(1);
      expect(mock.getOutput()).toContain("[AIL] ERROR (bad.ts): Compilation crashed");
    });

    it("supports createPoolReporterCallbacks directly in pool constructor options", async () => {
      const reporter = new MultiLineReporter({
        concurrency: 2,
        stream: new PassThrough(),
        throttleMs: 0,
      });

      reporter.start("Callbacks Test", 2);
      const pool = new ConcurrencyPool<string, void>({
        concurrency: 2,
        ...createPoolReporterCallbacks(reporter),
      });

      const tasks: TaskItem<string, void>[] = [
        {
          id: "t1",
          data: "item1.ts",
          run: async () => {},
        },
        {
          id: "t2",
          data: "item2.ts",
          run: async () => {},
        },
      ];

      await pool.runAll(tasks);
      reporter.finish();

      expect(reporter.completedTasks).toBe(2);
    });
  });

  describe("Render Throttling & Performance", () => {
    it("throttles rapid sequential updates when throttleMs > 0", async () => {
      const mock = createMockStream(true);
      const reporter = new MultiLineReporter({
        concurrency: 2,
        stream: mock.stream,
        isTTY: true,
        throttleMs: 50,
      });

      reporter.start("Throttle Test", 100);
      mock.clear();

      // Trigger 10 rapid updates synchronously
      for (let i = 0; i < 10; i++) {
        reporter.updateWorker(0, "COMPILING", `file-${i}.ts`);
      }

      // In the same tick, at most 1 render should have occurred
      const chunkCountBefore = mock.getOutput().split("\x1b[7A").length - 1;
      expect(chunkCountBefore).toBeLessThanOrEqual(1);

      // Finish should immediately flush the final state
      mock.clear();
      reporter.finish("Done");
      expect(mock.getOutput()).toContain("Done");
      expect(mock.getOutput()).toContain("\x1b[?25h");
    });
  });

  describe("Reporter Stats Telemetry", () => {
    it("returns accurate structured stats via getStats()", () => {
      const reporter = new MultiLineReporter({
        concurrency: 4,
        stream: new PassThrough(),
        throttleMs: 0,
      });

      reporter.start("Telemetry Run", 10);
      reporter.taskCompleted(0, "a.ts", { targetTokens: 200, ailTokens: 140 });
      reporter.taskCompleted(1, "b.ts", { targetTokens: 100, ailTokens: 70 });
      reporter.taskFailed(2, "c.ts", "File not found");

      const stats = reporter.getStats();
      expect(stats.title).toBe("Telemetry Run");
      expect(stats.concurrency).toBe(4);
      expect(stats.totalTasks).toBe(10);
      expect(stats.completedTasks).toBe(2);
      expect(stats.failedTasks).toBe(1);
      expect(stats.totalTargetTokens).toBe(300);
      expect(stats.totalAilTokens).toBe(210);
      expect(stats.tokenSavingsPct).toBeCloseTo(30.0, 1);
    });
  });
});
