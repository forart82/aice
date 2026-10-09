/**
 * AIL 2.0 Async Concurrency Worker Pool.
 * Manages bounded concurrent execution across recycled worker slots.
 */

import os from "node:os";

export interface TaskItem<T, R> {
  id: string;
  data: T;
  run: (workerId: number) => Promise<R>;
}

export interface TaskResult<T, R> {
  task: TaskItem<T, R>;
  result?: R;
  error?: Error;
  success: boolean;
  workerId: number;
  durationMs: number;
}

export interface ConcurrencyPoolOptions<T, R> {
  concurrency?: number; // Defaults to os.cpus().length or 4
  onWorkerStart?: (workerId: number, task: TaskItem<T, R>) => void;
  onWorkerComplete?: (
    workerId: number,
    task: TaskItem<T, R>,
    result: R,
    durationMs: number,
  ) => void;
  onWorkerError?: (
    workerId: number,
    task: TaskItem<T, R>,
    error: Error,
    durationMs: number,
  ) => void;
}

export interface PoolStats {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  startTime: number;
  elapsedMs: number;
  throughput: number;
}

export class ConcurrencyPool<T = unknown, R = unknown> {
  readonly concurrency: number;
  private readonly options: ConcurrencyPoolOptions<T, R>;
  private _freeWorkerIds: Set<number>;
  private _aborted = false;
  private _abortReason?: string;
  private _abortController = new AbortController();
  private _isRunning = false;

  private _startTime = 0;
  private _perfStartTime = 0;
  private _endTime?: number;
  private _perfEndTime?: number;
  private _totalTasks = 0;
  private _completedTasks = 0;
  private _failedTasks = 0;

  private _abortTrigger?: () => void;

  constructor(options: ConcurrencyPoolOptions<T, R> = {}) {
    const cpus = os.cpus?.().length ? os.cpus().length : 4;
    this.concurrency = Math.max(1, Math.floor(options.concurrency ?? cpus));
    this.options = options;
    this._freeWorkerIds = new Set(Array.from({ length: this.concurrency }, (_, i) => i));
  }

  public get freeWorkerIds(): Set<number> {
    return this._freeWorkerIds;
  }

  public get isAborted(): boolean {
    return this._aborted;
  }

  public get isRunning(): boolean {
    return this._isRunning;
  }

  public get abortSignal(): AbortSignal {
    return this._abortController.signal;
  }

  public get activeWorkers(): number {
    return this.concurrency - this._freeWorkerIds.size;
  }

  public get totalTasks(): number {
    return this._totalTasks;
  }

  public get completedTasks(): number {
    return this._completedTasks;
  }

  public get failedTasks(): number {
    return this._failedTasks;
  }

  public get startTime(): number {
    return this._startTime;
  }

  public get endTime(): number | undefined {
    return this._endTime;
  }

  public get elapsedMs(): number {
    if (this._perfStartTime === 0) return 0;
    const end = this._perfEndTime ?? performance.now();
    return Math.max(0, end - this._perfStartTime);
  }

  public get throughput(): number {
    const elapsedSec = this.elapsedMs / 1000;
    const processed = this._completedTasks + this._failedTasks;
    if (elapsedSec <= 0 || processed === 0) return 0;
    return processed / elapsedSec;
  }

  public getStats(): PoolStats {
    return {
      totalTasks: this.totalTasks,
      completedTasks: this.completedTasks,
      failedTasks: this.failedTasks,
      startTime: this.startTime,
      elapsedMs: this.elapsedMs,
      throughput: this.throughput,
    };
  }

  public abort(reason?: string | Error): void {
    if (this._aborted) return;
    this._aborted = true;
    this._abortReason =
      typeof reason === "string" ? reason : (reason?.message ?? "ConcurrencyPool aborted");
    this._abortController.abort(this._abortReason);
    if (this._abortTrigger) {
      this._abortTrigger();
    }
  }

  public cancel(reason?: string | Error): void {
    this.abort(reason ?? "ConcurrencyPool cancelled");
  }

  public reset(): void {
    this._aborted = false;
    this._abortReason = undefined;
    this._abortController = new AbortController();
    this._freeWorkerIds = new Set(Array.from({ length: this.concurrency }, (_, i) => i));
    this._isRunning = false;
    this._startTime = 0;
    this._perfStartTime = 0;
    this._endTime = undefined;
    this._perfEndTime = undefined;
    this._totalTasks = 0;
    this._completedTasks = 0;
    this._failedTasks = 0;
    this._abortTrigger = undefined;
  }

  public async run(task: TaskItem<T, R>): Promise<TaskResult<T, R>> {
    const results = await this.runAll([task]);
    const first = results[0];
    if (!first) {
      throw new Error("Task execution failed to produce a result");
    }
    return first;
  }

  public async runTask(task: TaskItem<T, R>): Promise<TaskResult<T, R>> {
    return this.run(task);
  }

  public async runAll(tasks: TaskItem<T, R>[]): Promise<TaskResult<T, R>[]> {
    this._isRunning = true;
    this._startTime = Date.now();
    this._perfStartTime = performance.now();
    this._endTime = undefined;
    this._perfEndTime = undefined;
    this._totalTasks = tasks.length;
    this._completedTasks = 0;
    this._failedTasks = 0;

    if (tasks.length === 0) {
      this._endTime = Date.now();
      this._perfEndTime = performance.now();
      this._isRunning = false;
      return [];
    }

    const results: TaskResult<T, R>[] = new Array(tasks.length);

    if (this._aborted) {
      const reason = this._abortReason ?? "ConcurrencyPool aborted";
      for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];
        if (!task) continue;
        results[i] = {
          task,
          success: false,
          error: new Error(reason),
          workerId: -1,
          durationMs: 0,
        };
      }
      this._failedTasks = tasks.length;
      this._endTime = Date.now();
      this._perfEndTime = performance.now();
      this._isRunning = false;
      return results;
    }

    // Refresh free workers set if not full and no active runs
    if (this._freeWorkerIds.size < this.concurrency) {
      this._freeWorkerIds = new Set(Array.from({ length: this.concurrency }, (_, i) => i));
    }

    return new Promise<TaskResult<T, R>[]>((resolve) => {
      const queue: Array<{ task: TaskItem<T, R>; index: number }> = tasks.map((task, index) => ({
        task,
        index,
      }));

      let inFlight = 0;
      let settled = false;

      const finish = () => {
        if (settled) return;
        settled = true;
        this._abortTrigger = undefined;
        this._endTime = Date.now();
        this._perfEndTime = performance.now();
        this._isRunning = false;
        resolve(results);
      };

      const dispatchNext = () => {
        if (settled) return;

        if (this._aborted) {
          while (queue.length > 0) {
            const item = queue.shift();
            if (!item) break;
            const { task, index } = item;
            this._failedTasks++;
            results[index] = {
              task,
              success: false,
              error: new Error(this._abortReason ?? "ConcurrencyPool aborted"),
              workerId: -1,
              durationMs: 0,
            };
          }
          if (inFlight === 0) {
            finish();
          }
          return;
        }

        while (this._freeWorkerIds.size > 0 && queue.length > 0 && !this._aborted) {
          const item = queue.shift();
          if (!item) break;
          const { task, index } = item;

          const workerId = Math.min(...this._freeWorkerIds);
          this._freeWorkerIds.delete(workerId);
          inFlight++;

          (async () => {
            const taskStart = performance.now();
            try {
              this.options.onWorkerStart?.(workerId, task);
              const result = await task.run(workerId);
              const durationMs = Math.max(0, performance.now() - taskStart);
              this._completedTasks++;
              try {
                this.options.onWorkerComplete?.(workerId, task, result, durationMs);
              } catch {
                // Safeguard against user callback exception
              }
              results[index] = {
                task,
                result,
                success: true,
                workerId,
                durationMs,
              };
            } catch (err: unknown) {
              const durationMs = Math.max(0, performance.now() - taskStart);
              const error = err instanceof Error ? err : new Error(String(err));
              this._failedTasks++;
              try {
                this.options.onWorkerError?.(workerId, task, error, durationMs);
              } catch {
                // Safeguard against user callback exception
              }
              results[index] = {
                task,
                error,
                success: false,
                workerId,
                durationMs,
              };
            } finally {
              this._freeWorkerIds.add(workerId);
              inFlight--;
              dispatchNext();
            }
          })();
        }

        if (inFlight === 0 && queue.length === 0) {
          finish();
        }
      };

      this._abortTrigger = () => {
        dispatchNext();
      };

      dispatchNext();
    });
  }
}
