/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Real-time ANSI Terminal Progress Bar Dashboard for AICE Parallel Benchmarks.
 * Supports multi-line concurrent worker streams, live turn tickers, and CI fallback.
 */

import * as readline from "node:readline";

export interface WorkerStreamState {
  id: string; // e.g. "RW-01"
  mode: string; // e.g. "aice_with_idioms"
  title: string;
  layer: 1 | 2 | 3;
  layerTitle: string;
  turns: number;
  toolCalls: number;
  status: "QUEUED" | "RUNNING" | "VERIFYING" | "DONE" | "FAILED";
  error?: string;
  startTime: number;
  elapsedSeconds: number;
}

export class BenchmarkDashboard {
  private workers: Map<string, WorkerStreamState> = new Map();
  private totalSteps: number = 0;
  private completedSteps: number = 0;
  private startTime: number = Date.now();
  private isTTY: boolean = Boolean(process.stdout.isTTY && !process.env.CI && !process.env.NO_COLOR);
  private timer?: NodeJS.Timeout;
  private renderedLinesCount: number = 0;
  private concurrency: number = 3;

  constructor(totalSteps: number = 33, concurrency: number = 3) {
    this.totalSteps = totalSteps;
    this.concurrency = concurrency;
  }

  public registerWorker(key: string, initial: Partial<WorkerStreamState>): void {
    const state: WorkerStreamState = {
      id: initial.id || key,
      mode: initial.mode || "aice_with_idioms",
      title: initial.title || key,
      layer: initial.layer || 1,
      layerTitle: initial.layerTitle || "Layer 1: Baseline",
      turns: initial.turns || 0,
      toolCalls: initial.toolCalls || 0,
      status: initial.status || "QUEUED",
      startTime: Date.now(),
      elapsedSeconds: 0,
      ...initial,
    };
    this.workers.set(key, state);
    if (!this.isTTY) {
      console.log(`[QUEUED] ${state.id}:${state.mode} (${state.title})`);
    }
  }

  public updateWorker(key: string, updates: Partial<WorkerStreamState>): void {
    const existing = this.workers.get(key);
    if (!existing) return;
    const prevStatus = existing.status;
    const prevLayer = existing.layer;
    Object.assign(existing, updates);
    existing.elapsedSeconds = Number(((Date.now() - existing.startTime) / 1000).toFixed(1));

    if (!this.isTTY) {
      if (updates.status && updates.status !== prevStatus) {
        const errInfo = updates.status === "FAILED" && existing.error ? `\n  ↳ Reason: ${existing.error}` : "";
        console.log(`[${updates.status}] ${existing.id}:${existing.mode} L${existing.layer}/3 (${existing.layerTitle}) - turns=${existing.turns} elapsed=${existing.elapsedSeconds}s${errInfo}`);
      } else if (updates.layer && updates.layer !== prevLayer) {
        console.log(`[STEP] ${existing.id}:${existing.mode} -> L${existing.layer}/3 (${existing.layerTitle})`);
      }
    }
  }

  public stepCompleted(): void {
    this.completedSteps++;
  }

  public start(): void {
    if (this.isTTY) {
      // Hide cursor
      process.stdout.write("\x1b[?25l");
      this.timer = setInterval(() => {
        this.render();
      }, 100);
    }
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.isTTY) {
      this.render();
      // Restore cursor
      process.stdout.write("\x1b[?25h\n");
    }
  }

  public static buildBar(ratio: number, width: number = 18): string {
    const clamped = Math.max(0, Math.min(1, ratio));
    const filled = Math.round(clamped * width);
    const empty = width - filled;
    return "\x1b[32m" + "█".repeat(filled) + "\x1b[90m" + "░".repeat(empty) + "\x1b[0m";
  }

  public render(): void {
    if (!this.isTTY) return;

    const activeWorkers = Array.from(this.workers.values()).filter(
      (w) => w.status === "RUNNING" || w.status === "VERIFYING",
    );
    const displayWorkers = activeWorkers.slice(0, Math.max(this.concurrency, 4));

    const lines: string[] = [];
    lines.push(`\x1b[1;36m🚀 AICE 3-Layer Progressive Benchmark\x1b[0m \x1b[90m(Concurrency: ${this.concurrency} | Model: gemini-3.8-flash-low)\x1b[0m`);

    for (const w of displayWorkers) {
      const layerRatio = (w.layer - 1 + (w.status === "DONE" ? 1 : 0.4)) / 3;
      const bar = BenchmarkDashboard.buildBar(layerRatio, 16);
      const modeTag = w.mode === "without_aice" ? "\x1b[33mno_aice\x1b[0m" : w.mode === "aice_no_idioms" ? "\x1b[34mpure_aice\x1b[0m" : "\x1b[32m+idioms\x1b[0m";
      const statusIcon = w.status === "VERIFYING" ? "\x1b[35m🔍 verif\x1b[0m" : "\x1b[36m⏳ run\x1b[0m";
      const layerTag = `\x1b[1mL${w.layer}/3\x1b[0m`;
      const titleShort = w.layerTitle.length > 24 ? w.layerTitle.slice(0, 21) + "..." : w.layerTitle.padEnd(24);
      lines.push(
        `  \x1b[1m[${w.id}]\x1b[0m ${modeTag.padEnd(19)} [${bar}] ${layerTag} ${titleShort} ${statusIcon} \x1b[90mturns=\x1b[0m\x1b[1m${w.turns}\x1b[0m \x1b[90m(${w.elapsedSeconds}s)\x1b[0m`,
      );
    }

    if (displayWorkers.length === 0) {
      lines.push(`  \x1b[90m(Waiting for next workers in pool...)\x1b[0m`);
    }

    lines.push(`\x1b[90m${"─".repeat(82)}\x1b[0m`);
    const totalRatio = this.totalSteps > 0 ? this.completedSteps / this.totalSteps : 0;
    const globalBar = BenchmarkDashboard.buildBar(totalRatio, 24);
    const elapsedTotal = Math.round((Date.now() - this.startTime) / 1000);
    const pct = Math.round(totalRatio * 100);
    lines.push(
      `  \x1b[1mOverall:\x1b[0m [${globalBar}] \x1b[1;32m${this.completedSteps}/${this.totalSteps} Steps (${pct}%)\x1b[0m \x1b[90m| Elapsed: ${elapsedTotal}s\x1b[0m`,
    );

    // Reposition cursor and redraw
    if (this.renderedLinesCount > 0) {
      readline.moveCursor(process.stdout, 0, -this.renderedLinesCount);
    }
    for (const line of lines) {
      readline.clearLine(process.stdout, 0);
      process.stdout.write(line + "\n");
    }
    this.renderedLinesCount = lines.length;
  }
}
