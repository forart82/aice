/**
 * Unit tests for Async Concurrency Worker Pool (Step 1).
 */

import os from "node:os";
import { describe, expect, it } from "vitest";
import { ConcurrencyPool, type TaskItem } from "../../src/runner/index.js";

describe("AIL 2.0 Async Concurrency Worker Pool", () => {
  describe("Concurrency Bounding", () => {
    it("ensures no more than N tasks run simultaneously", async () => {
      const concurrency = 3;
      let activeWorkers = 0;
      let maxActiveWorkers = 0;

      const tasks: TaskItem<number, number>[] = Array.from({ length: 15 }, (_, i) => ({
        id: `task-${i}`,
        data: i,
        run: async (_workerId: number) => {
          activeWorkers++;
          maxActiveWorkers = Math.max(maxActiveWorkers, activeWorkers);
          // Simulate variable async work
          await new Promise((resolve) => setTimeout(resolve, 15));
          activeWorkers--;
          return i * 2;
        },
      }));

      const pool = new ConcurrencyPool<number, number>({ concurrency });
      const results = await pool.runAll(tasks);

      expect(results.length).toBe(15);
      expect(maxActiveWorkers).toBeLessThanOrEqual(concurrency);
      expect(maxActiveWorkers).toBeGreaterThanOrEqual(2);
      expect(pool.completedTasks).toBe(15);
      expect(pool.failedTasks).toBe(0);
    });

    it("enforces strict sequential execution when concurrency is 1", async () => {
      let activeWorkers = 0;
      let maxActiveWorkers = 0;

      const tasks: TaskItem<number, number>[] = Array.from({ length: 6 }, (_, i) => ({
        id: `seq-${i}`,
        data: i,
        run: async () => {
          activeWorkers++;
          maxActiveWorkers = Math.max(maxActiveWorkers, activeWorkers);
          await new Promise((resolve) => setTimeout(resolve, 10));
          activeWorkers--;
          return i;
        },
      }));

      const pool = new ConcurrencyPool<number, number>({ concurrency: 1 });
      const results = await pool.runAll(tasks);

      expect(results.length).toBe(6);
      expect(maxActiveWorkers).toBe(1);
      expect(pool.completedTasks).toBe(6);
    });

    it("defaults concurrency to os.cpus().length or 4 if omitted", () => {
      const pool = new ConcurrencyPool();
      const expectedCpus = os.cpus?.().length ? os.cpus().length : 4;
      expect(pool.concurrency).toBe(expectedCpus);
      expect(pool.freeWorkerIds.size).toBe(expectedCpus);
    });
  });

  describe("Worker ID Recycling & Constraints", () => {
    it("ensures worker IDs are in range [0, concurrency - 1] and recycled across tasks", async () => {
      const concurrency = 4;
      const totalTasks = 20;
      const workerIdUsage = new Map<number, number>();
      const currentlyAssignedWorkers = new Set<number>();

      const tasks: TaskItem<number, number>[] = Array.from({ length: totalTasks }, (_, i) => ({
        id: `recycle-${i}`,
        data: i,
        run: async (workerId: number) => {
          expect(workerId).toBeGreaterThanOrEqual(0);
          expect(workerId).toBeLessThan(concurrency);

          // Invariant: no two concurrent tasks should ever share the same workerId
          expect(currentlyAssignedWorkers.has(workerId)).toBe(false);
          currentlyAssignedWorkers.add(workerId);

          workerIdUsage.set(workerId, (workerIdUsage.get(workerId) ?? 0) + 1);

          await new Promise((resolve) => setTimeout(resolve, 5));
          currentlyAssignedWorkers.delete(workerId);
          return workerId;
        },
      }));

      const pool = new ConcurrencyPool<number, number>({ concurrency });
      const results = await pool.runAll(tasks);

      expect(results.length).toBe(totalTasks);

      // Verify every worker slot was recycled multiple times
      for (let wid = 0; wid < concurrency; wid++) {
        expect(workerIdUsage.get(wid)).toBeGreaterThan(1);
      }

      // Verify task result workerId fields
      for (const res of results) {
        expect(res.workerId).toBeGreaterThanOrEqual(0);
        expect(res.workerId).toBeLessThan(concurrency);
        expect(res.success).toBe(true);
      }
    });
  });

  describe("Error Isolation & Resilience", () => {
    it("captures task failures without crashing pool or affecting other tasks", async () => {
      const tasks: TaskItem<number, string>[] = [
        {
          id: "task-0",
          data: 0,
          run: async () => "success-0",
        },
        {
          id: "task-1",
          data: 1,
          run: async () => {
            throw new Error("Transpilation syntax error in module 1");
          },
        },
        {
          id: "task-2",
          data: 2,
          run: async () => "success-2",
        },
        {
          id: "task-3",
          data: 3,
          run: async () => {
            throw new Error("Transpilation type error in module 3");
          },
        },
        {
          id: "task-4",
          data: 4,
          run: async () => "success-4",
        },
      ];

      const pool = new ConcurrencyPool<number, string>({ concurrency: 2 });
      const results = await pool.runAll(tasks);

      expect(results.length).toBe(5);

      expect(results[0]?.success).toBe(true);
      expect(results[0]?.result).toBe("success-0");
      expect(results[0]?.error).toBeUndefined();

      expect(results[1]?.success).toBe(false);
      expect(results[1]?.error?.message).toContain("Transpilation syntax error in module 1");
      expect(results[1]?.result).toBeUndefined();

      expect(results[2]?.success).toBe(true);
      expect(results[2]?.result).toBe("success-2");

      expect(results[3]?.success).toBe(false);
      expect(results[3]?.error?.message).toContain("Transpilation type error in module 3");

      expect(results[4]?.success).toBe(true);
      expect(results[4]?.result).toBe("success-4");

      expect(pool.completedTasks).toBe(3);
      expect(pool.failedTasks).toBe(2);
      expect(pool.totalTasks).toBe(5);
    });

    it("wraps non-Error thrown objects into standard Errors", async () => {
      const tasks: TaskItem<number, number>[] = [
        {
          id: "string-err",
          data: 42,
          run: async () => {
            // eslint-disable-next-line @typescript-eslint/no-throw-literal
            throw "Raw string failure";
          },
        },
      ];

      const pool = new ConcurrencyPool<number, number>({ concurrency: 1 });
      const [res] = await pool.runAll(tasks);

      expect(res?.success).toBe(false);
      expect(res?.error).toBeInstanceOf(Error);
      expect(res?.error?.message).toBe("Raw string failure");
      expect(pool.failedTasks).toBe(1);
    });
  });

  describe("Ordering, Progress Callbacks & Throughput Statistics", () => {
    it("preserves exact task input order even when tasks finish out of order", async () => {
      // Task 0 takes 40ms, Task 1 takes 5ms, Task 2 takes 20ms, Task 3 takes 1ms
      const delays = [40, 5, 20, 1];
      const tasks: TaskItem<number, number>[] = delays.map((delay, index) => ({
        id: `delay-task-${index}`,
        data: delay,
        run: async () => {
          await new Promise((resolve) => setTimeout(resolve, delay));
          return index * 10;
        },
      }));

      const pool = new ConcurrencyPool<number, number>({ concurrency: 4 });
      const results = await pool.runAll(tasks);

      expect(results.length).toBe(4);
      expect(results[0]?.task.id).toBe("delay-task-0");
      expect(results[0]?.result).toBe(0);

      expect(results[1]?.task.id).toBe("delay-task-1");
      expect(results[1]?.result).toBe(10);

      expect(results[2]?.task.id).toBe("delay-task-2");
      expect(results[2]?.result).toBe(20);

      expect(results[3]?.task.id).toBe("delay-task-3");
      expect(results[3]?.result).toBe(30);
    });

    it("fires progress callbacks onWorkerStart, onWorkerComplete, and onWorkerError", async () => {
      const started: Array<{ workerId: number; taskId: string }> = [];
      const completed: Array<{
        workerId: number;
        taskId: string;
        result: string;
        durationMs: number;
      }> = [];
      const errored: Array<{
        workerId: number;
        taskId: string;
        error: string;
        durationMs: number;
      }> = [];

      const tasks: TaskItem<number, string>[] = [
        {
          id: "t-1",
          data: 1,
          run: async () => {
            await new Promise((r) => setTimeout(r, 5));
            return "res-1";
          },
        },
        {
          id: "t-2",
          data: 2,
          run: async () => {
            await new Promise((r) => setTimeout(r, 5));
            throw new Error("boom");
          },
        },
      ];

      const pool = new ConcurrencyPool<number, string>({
        concurrency: 2,
        onWorkerStart: (workerId, task) => {
          started.push({ workerId, taskId: task.id });
        },
        onWorkerComplete: (workerId, task, result, durationMs) => {
          completed.push({ workerId, taskId: task.id, result, durationMs });
        },
        onWorkerError: (workerId, task, error, durationMs) => {
          errored.push({
            workerId,
            taskId: task.id,
            error: error.message,
            durationMs,
          });
        },
      });

      await pool.runAll(tasks);

      expect(started.length).toBe(2);
      expect(completed.length).toBe(1);
      expect(completed[0]?.taskId).toBe("t-1");
      expect(completed[0]?.result).toBe("res-1");
      expect(completed[0]?.durationMs).toBeGreaterThanOrEqual(0);

      expect(errored.length).toBe(1);
      expect(errored[0]?.taskId).toBe("t-2");
      expect(errored[0]?.error).toBe("boom");
      expect(errored[0]?.durationMs).toBeGreaterThanOrEqual(0);
    });

    it("tracks accurate runtime statistics and throughput metrics", async () => {
      const tasks: TaskItem<number, number>[] = Array.from({ length: 8 }, (_, i) => ({
        id: `stats-${i}`,
        data: i,
        run: async () => {
          await new Promise((r) => setTimeout(r, 5));
          if (i === 7) throw new Error("intentional fail");
          return i;
        },
      }));

      const pool = new ConcurrencyPool<number, number>({ concurrency: 4 });
      await pool.runAll(tasks);

      expect(pool.totalTasks).toBe(8);
      expect(pool.completedTasks).toBe(7);
      expect(pool.failedTasks).toBe(1);
      expect(pool.startTime).toBeGreaterThan(0);
      expect(pool.elapsedMs).toBeGreaterThan(0);
      expect(pool.throughput).toBeGreaterThan(0);

      const stats = pool.getStats();
      expect(stats.totalTasks).toBe(8);
      expect(stats.completedTasks).toBe(7);
      expect(stats.failedTasks).toBe(1);
      expect(stats.throughput).toBe(pool.throughput);
      expect(stats.elapsedMs).toBe(pool.elapsedMs);
      expect(stats.startTime).toBe(pool.startTime);
    });
  });

  describe("Cancellation & Abort Control", () => {
    it("aborts remaining queued tasks when abort() is invoked mid-run", async () => {
      let executedCount = 0;
      const tasks: TaskItem<number, number>[] = Array.from({ length: 12 }, (_, i) => ({
        id: `abort-${i}`,
        data: i,
        run: async () => {
          executedCount++;
          if (i === 1) {
            // Trigger abort on the pool
            pool.abort("Build cancelled by user");
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
          return i;
        },
      }));

      const pool = new ConcurrencyPool<number, number>({ concurrency: 2 });
      const results = await pool.runAll(tasks);

      expect(pool.isAborted).toBe(true);
      expect(pool.abortSignal.aborted).toBe(true);
      expect(results.length).toBe(12);

      // Tasks that were in flight should complete or succeed,
      // while queued tasks that never started should be marked as aborted
      const abortedResults = results.filter(
        (r) => !r.success && r.error?.message.includes("Build cancelled"),
      );
      expect(abortedResults.length).toBeGreaterThan(0);
      expect(executedCount).toBeLessThan(12);
    });

    it("cancels all tasks immediately if aborted prior to runAll", async () => {
      const tasks: TaskItem<number, number>[] = Array.from({ length: 5 }, (_, i) => ({
        id: `pre-abort-${i}`,
        data: i,
        run: async () => i,
      }));

      const pool = new ConcurrencyPool<number, number>({ concurrency: 2 });
      pool.cancel("Operation cancelled upfront");
      const results = await pool.runAll(tasks);

      expect(results.length).toBe(5);
      for (const res of results) {
        expect(res.success).toBe(false);
        expect(res.error?.message).toContain("Operation cancelled upfront");
        expect(res.workerId).toBe(-1);
      }
      expect(pool.failedTasks).toBe(5);
      expect(pool.completedTasks).toBe(0);
    });

    it("resets aborted state and counters when reset() is called", async () => {
      const pool = new ConcurrencyPool<number, number>({ concurrency: 2 });
      pool.abort("Test abort");
      expect(pool.isAborted).toBe(true);

      pool.reset();
      expect(pool.isAborted).toBe(false);
      expect(pool.totalTasks).toBe(0);
      expect(pool.freeWorkerIds.size).toBe(2);

      const task: TaskItem<number, number> = {
        id: "post-reset",
        data: 10,
        run: async () => 20,
      };

      const result = await pool.run(task);
      expect(result.success).toBe(true);
      expect(result.result).toBe(20);
    });
  });

  describe("Edge Cases & Single Task Helpers", () => {
    it("handles empty task list gracefully", async () => {
      const pool = new ConcurrencyPool();
      const results = await pool.runAll([]);
      expect(results).toEqual([]);
      expect(pool.totalTasks).toBe(0);
      expect(pool.completedTasks).toBe(0);
      expect(pool.failedTasks).toBe(0);
      expect(pool.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(pool.throughput).toBe(0);
    });

    it("executes single tasks using run() and runTask()", async () => {
      const pool = new ConcurrencyPool<string, string>({ concurrency: 2 });

      const taskA: TaskItem<string, string> = {
        id: "task-a",
        data: "input-a",
        run: async (wid) => `out-a-worker-${wid}`,
      };

      const taskB: TaskItem<string, string> = {
        id: "task-b",
        data: "input-b",
        run: async (wid) => `out-b-worker-${wid}`,
      };

      const resA = await pool.run(taskA);
      expect(resA.success).toBe(true);
      expect(resA.result).toContain("out-a-worker-");

      const resB = await pool.runTask(taskB);
      expect(resB.success).toBe(true);
      expect(resB.result).toContain("out-b-worker-");
    });
  });
});
