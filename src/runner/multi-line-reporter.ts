/**
 * AIL 2.0 Multi-Line Terminal Reporter / TUI Engine (Step 2).
 * Flicker-free interactive terminal progress dashboard visualizing concurrent
 * compilation, active worker states, overall progress, and live tokenomics.
 */

import * as path from "node:path";
import type { ConcurrencyPool, ConcurrencyPoolOptions, TaskItem } from "./concurrency-pool.js";

export type WorkerStatus = "IDLE" | "COMPILING" | "DECOMPILING" | "SHADOWING" | "DONE" | "ERROR";

export interface TaskMetrics {
  targetTokens?: number;
  ailTokens?: number;
}

export interface MultiLineReporterOptions {
  concurrency: number;
  stream?: NodeJS.WritableStream; // defaults to process.stdout
  isTTY?: boolean; // defaults to stream.isTTY ?? false
  throttleMs?: number; // throttle render updates (e.g. 50ms) to prevent flicker
  width?: number; // optional terminal column width override
  barWidth?: number; // optional progress bar length (defaults to 12)
}

export interface WorkerState {
  id: number;
  status: WorkerStatus;
  file?: string;
}

export interface ReporterPoolMapper<T = unknown, R = unknown> {
  title?: string;
  autoStart?: boolean;
  getFile?: (task: TaskItem<T, R>) => string;
  getStatus?: (task: TaskItem<T, R>) => WorkerStatus;
  getMetrics?: (result: R, task: TaskItem<T, R>) => TaskMetrics | undefined;
}

export interface ReporterStats {
  title: string;
  concurrency: number;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  elapsedMs: number;
  throughput: number;
  totalTargetTokens: number;
  totalAilTokens: number;
  tokenSavingsPct: number;
}

export class MultiLineReporter {
  readonly concurrency: number;
  readonly stream: NodeJS.WritableStream;
  readonly isTTY: boolean;
  readonly throttleMs: number;
  readonly barWidth: number;
  readonly width: number;

  private _title = "AIL 2.0 Compiler";
  private _totalTasks = 0;
  private _completedTasks = 0;
  private _failedTasks = 0;
  private _totalTargetTokens = 0;
  private _totalAilTokens = 0;
  private _summary?: string;

  private _workers: WorkerState[];
  private _isStarted = false;
  private _isFinished = false;
  private _startTime = 0;
  private _endTime?: number;

  private _renderedLines = 0;
  private _cursorHidden = false;
  private _cursorRestored = false;

  private _throttleTimer?: NodeJS.Timeout | ReturnType<typeof setTimeout>;
  private _lastRenderTime = 0;

  private _loggedFiles = new Set<string>();
  private _startedCount = 0;

  private _sigintHandler?: () => void;
  private _exitHandler?: () => void;

  constructor(options: MultiLineReporterOptions) {
    this.concurrency = Math.max(1, Math.floor(options.concurrency));
    this.stream = options.stream ?? process.stdout;
    const streamWithTty = this.stream as { isTTY?: boolean; columns?: number };
    this.isTTY =
      options.isTTY !== undefined ? options.isTTY : Boolean(streamWithTty.isTTY ?? false);

    // Default throttle: 50ms for live stdout TTY, 0ms for mock/custom streams or non-TTY
    if (options.throttleMs !== undefined) {
      this.throttleMs = options.throttleMs;
    } else if (this.isTTY && (!options.stream || options.stream === process.stdout)) {
      this.throttleMs = 50;
    } else {
      this.throttleMs = 0;
    }

    this.barWidth = options.barWidth ?? 12;

    const streamCols = typeof streamWithTty.columns === "number" ? streamWithTty.columns : 0;
    this.width = options.width ?? (streamCols >= 60 ? Math.min(streamCols, 100) : 68);

    this._workers = Array.from({ length: this.concurrency }, (_, id) => ({
      id,
      status: "IDLE",
    }));
  }

  public get isStarted(): boolean {
    return this._isStarted;
  }

  public get isFinished(): boolean {
    return this._isFinished;
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

  public get title(): string {
    return this._title;
  }

  public get summary(): string | undefined {
    return this._summary;
  }

  public get elapsedMs(): number {
    if (this._startTime === 0) return 0;
    const end = this._endTime ?? performance.now();
    return Math.max(0, end - this._startTime);
  }

  public get throughput(): number {
    const elapsedSec = this.elapsedMs / 1000;
    const processed = this._completedTasks + this._failedTasks;
    if (elapsedSec <= 0 || processed === 0) return 0;
    return Math.round(processed / elapsedSec);
  }

  public get totalTargetTokens(): number {
    return this._totalTargetTokens;
  }

  public get totalAilTokens(): number {
    return this._totalAilTokens;
  }

  public get tokenSavingsPct(): number {
    if (this._totalTargetTokens <= 0) return 0;
    return ((this._totalTargetTokens - this._totalAilTokens) / this._totalTargetTokens) * 100;
  }

  public getWorker(workerId: number): WorkerState | undefined {
    return this._workers[workerId];
  }

  public getAllWorkers(): WorkerState[] {
    return this._workers.map((w) => ({ ...w }));
  }

  public getStats(): ReporterStats {
    return {
      title: this._title,
      concurrency: this.concurrency,
      totalTasks: this._totalTasks,
      completedTasks: this._completedTasks,
      failedTasks: this._failedTasks,
      elapsedMs: this.elapsedMs,
      throughput: this.throughput,
      totalTargetTokens: this._totalTargetTokens,
      totalAilTokens: this._totalAilTokens,
      tokenSavingsPct: this.tokenSavingsPct,
    };
  }

  public start(title: string, totalTasks: number): void {
    if (this._throttleTimer) {
      clearTimeout(this._throttleTimer);
      this._throttleTimer = undefined;
    }

    this._title = title;
    this._totalTasks = Math.max(0, totalTasks);
    this._completedTasks = 0;
    this._failedTasks = 0;
    this._totalTargetTokens = 0;
    this._totalAilTokens = 0;
    this._summary = undefined;
    this._isStarted = true;
    this._isFinished = false;
    this._startTime = performance.now();
    this._endTime = undefined;
    this._renderedLines = 0;
    this._cursorRestored = false;
    this._loggedFiles.clear();
    this._startedCount = 0;

    this._workers = Array.from({ length: this.concurrency }, (_, id) => ({
      id,
      status: "IDLE",
    }));

    if (this.isTTY) {
      if (!this._cursorHidden) {
        this.stream.write("\x1b[?25l");
        this._cursorHidden = true;
      }
      this.setupSignalHandlers();
      this.renderNow();
      this._lastRenderTime = performance.now();
    }
  }

  public updateWorker(workerId: number, status: WorkerStatus, file?: string): void {
    if (this._isFinished) return;
    if (workerId < 0 || workerId >= this.concurrency) return;

    const formattedFile = file ? this.formatRelPath(file) : undefined;
    this._workers[workerId] = {
      id: workerId,
      status,
      file: formattedFile,
    };

    if (!this.isTTY) {
      if (
        formattedFile &&
        (status === "COMPILING" || status === "DECOMPILING" || status === "SHADOWING")
      ) {
        if (!this._loggedFiles.has(formattedFile)) {
          this._loggedFiles.add(formattedFile);
          this._startedCount++;
          const verb = status.charAt(0) + status.slice(1).toLowerCase();
          const taskStr = `(${this._startedCount}/${this._totalTasks})`;
          this.stream.write(`[AIL] ${taskStr} ${verb} ${formattedFile}...\n`);
        }
      }
    } else {
      this.requestRender();
    }
  }

  public taskCompleted(workerId: number, file: string, metrics?: TaskMetrics): void {
    if (this._isFinished) return;
    const formattedFile = this.formatRelPath(file);

    this._completedTasks++;
    if (workerId >= 0 && workerId < this.concurrency) {
      this._workers[workerId] = {
        id: workerId,
        status: "DONE",
        file: formattedFile,
      };
    }

    if (metrics) {
      if (typeof metrics.targetTokens === "number" && !Number.isNaN(metrics.targetTokens)) {
        this._totalTargetTokens += metrics.targetTokens;
      }
      if (typeof metrics.ailTokens === "number" && !Number.isNaN(metrics.ailTokens)) {
        this._totalAilTokens += metrics.ailTokens;
      }
    }

    if (!this.isTTY) {
      if (!this._loggedFiles.has(formattedFile)) {
        this._loggedFiles.add(formattedFile);
        this._startedCount++;
        this.stream.write(
          `[AIL] (${this._startedCount}/${this._totalTasks}) Completed ${formattedFile}\n`,
        );
      }
    } else {
      this.requestRender();
    }
  }

  public taskFailed(workerId: number, file: string, error: string): void {
    if (this._isFinished) return;
    const formattedFile = this.formatRelPath(file);

    this._failedTasks++;
    if (workerId >= 0 && workerId < this.concurrency) {
      this._workers[workerId] = {
        id: workerId,
        status: "ERROR",
        file: formattedFile,
      };
    }

    if (!this.isTTY) {
      this.stream.write(`[AIL] ERROR (${formattedFile}): ${error}\n`);
    } else {
      this.requestRender();
    }
  }

  public finish(summary?: string): void {
    if (this._isFinished) return;
    this._isFinished = true;
    this._endTime = performance.now();
    if (summary) {
      this._summary = summary;
    }

    if (this._throttleTimer) {
      clearTimeout(this._throttleTimer);
      this._throttleTimer = undefined;
    }

    for (let i = 0; i < this._workers.length; i++) {
      const w = this._workers[i];
      if (
        w &&
        (w.status === "COMPILING" || w.status === "DECOMPILING" || w.status === "SHADOWING")
      ) {
        w.status = "DONE";
      }
    }

    if (this.isTTY) {
      this.renderNow();
      this.restoreCursor();
    } else {
      const lines = this.formatBox();
      this.stream.write(`${lines.join("\n")}\n`);
    }

    this.cleanupSignalHandlers();
  }

  public renderNow(): void {
    const lines = this.formatBox();
    if (this._renderedLines === 0) {
      this.stream.write(`${lines.join("\n")}\n`);
    } else {
      let buf = `\x1b[${this._renderedLines}A`;
      for (const line of lines) {
        buf += `\r\x1b[2K${line}\n`;
      }
      this.stream.write(buf);
    }
    this._renderedLines = lines.length;
  }

  public formatBox(): string[] {
    const width = this.width;
    const innerWidth = width - 4;
    const lines: string[] = [];

    // Header: ┌─ <Title> [Concurrency: <N> Workers] ──────┐
    const headerPrefix = `┌─ ${this._title} [Concurrency: ${this.concurrency} Workers] `;
    let header: string;
    if (headerPrefix.length >= width - 1) {
      header = `${headerPrefix.slice(0, width - 2)}─┐`;
    } else {
      const fillCount = width - headerPrefix.length - 1;
      header = `${headerPrefix}${"─".repeat(fillCount)}┐`;
    }
    lines.push(header);

    // Per-worker lines: │ Worker <id>: [<STATUS>] <relPath>
    for (let i = 0; i < this.concurrency; i++) {
      const worker = this._workers[i] ?? { id: i, status: "IDLE" };
      let workerContent = `Worker ${worker.id}: [${worker.status}]`;
      if (worker.file) {
        workerContent += ` ${worker.file}`;
      }
      lines.push(this.formatInnerLine(workerContent, innerWidth));
    }

    // Separator: ├──────────────────────────────────────────┤
    lines.push(`├${"─".repeat(width - 2)}┤`);

    // Optional Summary line
    if (this._summary) {
      lines.push(this.formatInnerLine(`Summary:    ${this._summary}`, innerWidth));
    }

    // Progress line: │ Progress:   [████████░░░░] 65.0% (13/20 files) │
    const processed = this._completedTasks + this._failedTasks;
    const ratio =
      this._totalTasks > 0
        ? Math.min(1, Math.max(0, processed / this._totalTasks))
        : processed === 0
          ? 0
          : 1;
    const filledCount = Math.min(this.barWidth, Math.max(0, Math.round(ratio * this.barWidth)));
    const emptyCount = this.barWidth - filledCount;
    const bar = "█".repeat(filledCount) + "░".repeat(emptyCount);
    const pctStr = `${(ratio * 100).toFixed(1)}%`;
    const progressContent = `Progress:   [${bar}] ${pctStr} (${processed}/${this._totalTasks} files)`;
    lines.push(this.formatInnerLine(progressContent, innerWidth));

    // Metrics line: │ Throughput: 42 files/sec • Elapsed: 0.3s • Tokens: -28.4% │
    const elapsedSec = (this.elapsedMs / 1000).toFixed(1);
    const throughputVal = this.throughput;
    let tokensStr: string;
    if (this._totalTargetTokens > 0) {
      const tokenDiffPct =
        ((this._totalAilTokens - this._totalTargetTokens) / this._totalTargetTokens) * 100;
      tokensStr = `${tokenDiffPct > 0 ? "+" : ""}${tokenDiffPct.toFixed(1)}%`;
    } else {
      tokensStr = "0.0%";
    }
    const metricsContent = `Throughput: ${throughputVal} files/sec • Elapsed: ${elapsedSec}s • Tokens: ${tokensStr}`;
    lines.push(this.formatInnerLine(metricsContent, innerWidth));

    // Footer: └──────────────────────────────────────────┘
    lines.push(`└${"─".repeat(width - 2)}┘`);

    return lines;
  }

  public createPoolCallbacks<T = unknown, R = unknown>(
    mapper?: ReporterPoolMapper<T, R>,
  ): Pick<ConcurrencyPoolOptions<T, R>, "onWorkerStart" | "onWorkerComplete" | "onWorkerError"> {
    return {
      onWorkerStart: (workerId: number, task: TaskItem<T, R>) => {
        if (!this._isStarted && mapper?.autoStart !== false) {
          this.start(mapper?.title ?? "AIL Compilation", 0);
        }
        const file = this.resolveTaskFile(task, mapper);
        const status = this.resolveTaskStatus(task, mapper);
        this.updateWorker(workerId, status, file);
      },
      onWorkerComplete: (
        workerId: number,
        task: TaskItem<T, R>,
        result: R,
        _durationMs: number,
      ) => {
        const file = this.resolveTaskFile(task, mapper);
        const metrics = this.resolveTaskMetrics(result, task, mapper);
        this.taskCompleted(workerId, file, metrics);
      },
      onWorkerError: (
        workerId: number,
        task: TaskItem<T, R>,
        error: Error,
        _durationMs: number,
      ) => {
        const file = this.resolveTaskFile(task, mapper);
        this.taskFailed(workerId, file, error.message);
      },
    };
  }

  public attachToPool<T = unknown, R = unknown>(
    pool: ConcurrencyPool<T, R>,
    mapper?: ReporterPoolMapper<T, R>,
  ): this {
    const attachMethod = (
      pool as unknown as {
        attachReporter?: (
          reporter: MultiLineReporter,
          mapper?: ReporterPoolMapper<T, R>,
        ) => unknown;
      }
    ).attachReporter;

    if (typeof attachMethod === "function") {
      attachMethod.call(pool, this, mapper);
    } else {
      const callbacks = this.createPoolCallbacks(mapper);
      const existingOptions = (pool as unknown as { options?: ConcurrencyPoolOptions<T, R> })
        .options;
      if (existingOptions) {
        const prevStart = existingOptions.onWorkerStart;
        const prevComplete = existingOptions.onWorkerComplete;
        const prevError = existingOptions.onWorkerError;

        existingOptions.onWorkerStart = (workerId: number, task: TaskItem<T, R>) => {
          prevStart?.(workerId, task);
          callbacks.onWorkerStart?.(workerId, task);
        };
        existingOptions.onWorkerComplete = (
          workerId: number,
          task: TaskItem<T, R>,
          result: R,
          dur: number,
        ) => {
          prevComplete?.(workerId, task, result, dur);
          callbacks.onWorkerComplete?.(workerId, task, result, dur);
        };
        existingOptions.onWorkerError = (
          workerId: number,
          task: TaskItem<T, R>,
          error: Error,
          dur: number,
        ) => {
          prevError?.(workerId, task, error, dur);
          callbacks.onWorkerError?.(workerId, task, error, dur);
        };
      }
    }
    return this;
  }

  private resolveTaskFile<T, R>(task: TaskItem<T, R>, mapper?: ReporterPoolMapper<T, R>): string {
    if (mapper?.getFile) {
      return mapper.getFile(task);
    }
    if (typeof task.data === "string") {
      return task.data;
    }
    const dataObj = task.data as { file?: unknown } | null | undefined;
    if (dataObj && typeof dataObj.file === "string") {
      return dataObj.file;
    }
    return task.id;
  }

  private resolveTaskStatus<T, R>(
    task: TaskItem<T, R>,
    mapper?: ReporterPoolMapper<T, R>,
  ): WorkerStatus {
    if (mapper?.getStatus) {
      return mapper.getStatus(task);
    }
    const dataObj = task.data as { status?: unknown } | null | undefined;
    if (
      dataObj &&
      typeof dataObj.status === "string" &&
      ["IDLE", "COMPILING", "DECOMPILING", "SHADOWING", "DONE", "ERROR"].includes(dataObj.status)
    ) {
      return dataObj.status as WorkerStatus;
    }
    return "COMPILING";
  }

  private resolveTaskMetrics<T, R>(
    result: R,
    task: TaskItem<T, R>,
    mapper?: ReporterPoolMapper<T, R>,
  ): TaskMetrics | undefined {
    if (mapper?.getMetrics) {
      return mapper.getMetrics(result, task);
    }
    const resObj = result as
      | {
          metrics?: TaskMetrics;
          targetTokens?: number;
          ailTokens?: number;
        }
      | null
      | undefined;
    if (resObj?.metrics) {
      return resObj.metrics;
    }
    if (typeof resObj?.targetTokens === "number" || typeof resObj?.ailTokens === "number") {
      return {
        targetTokens: resObj.targetTokens,
        ailTokens: resObj.ailTokens,
      };
    }
    return undefined;
  }

  private requestRender(): void {
    if (!this.isTTY) return;
    if (this.throttleMs <= 0) {
      this.renderNow();
      return;
    }

    const now = performance.now();
    const timeSinceLast = now - this._lastRenderTime;

    if (timeSinceLast >= this.throttleMs) {
      this.renderNow();
      this._lastRenderTime = now;
      return;
    }

    if (!this._throttleTimer) {
      const delay = Math.max(1, this.throttleMs - timeSinceLast);
      this._throttleTimer = setTimeout(() => {
        this._throttleTimer = undefined;
        this.renderNow();
        this._lastRenderTime = performance.now();
      }, delay);
    }
  }

  private formatInnerLine(content: string, innerWidth: number): string {
    let truncated = content;
    if (truncated.length > innerWidth) {
      truncated = `${truncated.slice(0, innerWidth - 3)}...`;
    }
    return `│ ${truncated.padEnd(innerWidth, " ")} │`;
  }

  private formatRelPath(filePath: string): string {
    const cwd = process.cwd();
    let rel = path.isAbsolute(filePath) ? path.relative(cwd, filePath) : filePath;
    rel = rel.replace(/\\/g, "/");
    return rel;
  }

  private restoreCursor(): void {
    if (this.isTTY && this._cursorHidden && !this._cursorRestored) {
      this.stream.write("\x1b[?25h");
      this._cursorRestored = true;
    }
  }

  private setupSignalHandlers(): void {
    if (this._sigintHandler || this._exitHandler) return;

    this._sigintHandler = () => {
      this.restoreCursor();
      process.exit(130);
    };
    this._exitHandler = () => {
      this.restoreCursor();
    };

    process.once("SIGINT", this._sigintHandler);
    process.once("exit", this._exitHandler);
  }

  private cleanupSignalHandlers(): void {
    if (this._sigintHandler) {
      process.removeListener("SIGINT", this._sigintHandler);
      this._sigintHandler = undefined;
    }
    if (this._exitHandler) {
      process.removeListener("exit", this._exitHandler);
      this._exitHandler = undefined;
    }
  }
}

export function attachReporterToPool<T = unknown, R = unknown>(
  reporter: MultiLineReporter,
  pool: ConcurrencyPool<T, R>,
  mapper?: ReporterPoolMapper<T, R>,
): MultiLineReporter {
  return reporter.attachToPool(pool, mapper);
}

export function createPoolReporterCallbacks<T = unknown, R = unknown>(
  reporter: MultiLineReporter,
  mapper?: ReporterPoolMapper<T, R>,
): Pick<ConcurrencyPoolOptions<T, R>, "onWorkerStart" | "onWorkerComplete" | "onWorkerError"> {
  return reporter.createPoolCallbacks(mapper);
}
