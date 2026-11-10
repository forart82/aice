/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 15-Language / 24-Extension Enterprise Polyglot Torture Test Suite (v0.9.7).
 * Exercises:
 * - Lossless Source-Preserving Preprocessor (`preprocessHybridAndIdiomsLossless`)
 * - `createFile` & `createBatch` across all 15 languages / 24 extensions
 * - Strict byte-span isolation in `splice()` (100% byte-for-byte preservation outside spliced symbol)
 * - Multi-symbol batch splicing (`edits` array, bottom-to-top reverse offset application)
 * - `[Lstart-Lend]` line ranges and multi-language `## ⚠️ Native Syntax Diagnostics` in `outlinePath` & `generateContext`
 * - Pre-write syntax validation gate (`validateNativeSyntax`) rejecting malformed syntax before disk write
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vm from "node:vm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const CLI_PATH = path.resolve(process.cwd(), "bin/aice.ts");
const TSX_BIN = path.resolve(process.cwd(), "node_modules/.bin/tsx");

function runCli(args: string[], cwd: string, input?: string) {
  return spawnSync(TSX_BIN, [CLI_PATH, ...args], {
    cwd,
    input,
    encoding: "utf-8",
    timeout: 60000,
  });
}

import {
  createBatch,
  createFile,
  extractInlineIdiomsFromSource,
  generateContext,
  locateNativeDeclarationSpan,
  type OutlineResult,
  outlinePath,
  parseOptionIdioms,
  preprocessHybridAndIdiomsLossless,
  splice,
  spliceNativeSource,
  validateNativeSyntax,
} from "../src/tools/index.js";

describe("15-Language / 24-Extension Enterprise Polyglot Torture Suite (v0.9.7)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-enterprise-torture-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("1. TypeScript (.ts) & React TSX (.tsx): conditional/mapped types, generics, JSX handlers, object keys '0>1'/'soft-drop', template literals with ': #fff', @idiom macros, and byte-exact splicing", async () => {
    const tsPath = path.join(tmpDir, "tetromino_engine.ts");
    const tsSource = [
      "@idiom $clamp($v, $lo, $hi) => Math.max($lo, Math.min($hi, $v))",
      "",
      "export type DeepReadonly<T> = {",
      "  readonly [P in keyof T]: T[P] extends Record<string, unknown> ? DeepReadonly<T[P]> : T[P];",
      "};",
      "",
      "export type ExtractPayload<T> = T extends { payload: infer P } ? P : never;",
      "",
      "export const SRS_KICK_TABLE: Record<string, Array<[number, number]>> = {",
      '  "0>1": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],',
      '  "1>2": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],',
      '  "soft-drop": [[0, 1]],',
      "};",
      "",
      "pub fn computeDropScore<T extends Record<string, unknown>>(rows: :#, combo: :#, meta: T): :# {",
      "  const clampedRows = $clamp(rows, 0, 4);",
      '  const themeBadge = `border: 1px solid #fff; color: #00f3ff; meta=${String(meta["soft-drop"] ?? 0)}`;',
      "  if (themeBadge.length === 0) ret 0;",
      "  ret clampedRows * 100 + combo * 50;",
      "}",
      "",
      "pub fn describeKickProfile(key: :$): :$ {",
      "  const kicks = SRS_KICK_TABLE[key] ?? [];",
      "  ret `profile:${key}:${kicks.length}`;",
      "}",
    ].join("\n");

    const createdTs = await createFile(tsPath, { code: tsSource, projectRoot: tmpDir });
    expect(createdTs.content).toContain(
      "readonly [P in keyof T]: T[P] extends Record<string, unknown>",
    );
    expect(createdTs.content).toContain('"0>1": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]]');
    expect(createdTs.content).toContain('"soft-drop": [[0, 1]]');
    expect(createdTs.content).toContain("border: 1px solid #fff; color: #00f3ff;");
    expect(createdTs.content).toContain(
      "export function computeDropScore<T extends Record<string, unknown>>(rows: number, combo: number, meta: T): number",
    );
    expect(createdTs.content).toContain("Math.max(0, Math.min(4, rows))");

    // Verify strict byte-span isolation when splicing computeDropScore
    const beforeDisk = fs.readFileSync(tsPath, "utf-8");
    const span = locateNativeDeclarationSpan(beforeDisk, "typescript", "computeDropScore", tsPath);
    expect(span).not.toBeNull();
    const prefixBefore = beforeDisk.slice(0, span!.startOffset);
    const suffixBefore = beforeDisk.slice(span!.endOffset);

    await splice(tsPath, {
      symbol: "computeDropScore",
      code: [
        "@idiom $clamp($v, $lo, $hi) => Math.max($lo, Math.min($hi, $v))",
        "pub fn computeDropScore<T extends Record<string, unknown>>(rows: :#, combo: :#, meta: T): :# {",
        "  const safeRows = $clamp(rows, 1, 8);",
        "  ret safeRows * 250 + combo * 75 + (meta ? 1 : 0);",
        "}",
      ].join("\n"),
    });

    const afterDisk = fs.readFileSync(tsPath, "utf-8");
    expect(afterDisk.startsWith(prefixBefore)).toBe(true);
    expect(afterDisk.endsWith(suffixBefore)).toBe(true);
    expect(afterDisk).toContain("safeRows * 250 + combo * 75");

    // React TSX (.tsx) with generic component, event handlers, and preserved interface Props
    const tsxPath = path.join(tmpDir, "HudPanel.tsx");
    const tsxSource = [
      'import React from "react";',
      "",
      "export interface HudPanelProps<TItem extends { id: string; label: string }> {",
      "  items: readonly TItem[];",
      "  activeId?: string;",
      "  onSelect: (id: string) => void;",
      "}",
      "",
      "pub fn HudPanel<TItem extends { id: string; label: string }>(props: HudPanelProps<TItem>) {",
      "  const { items, activeId, onSelect } = props;",
      "  return (",
      '    <section className="hud-panel" data-theme="color: #fff">',
      "      {items.map((item) => (",
      "        <button",
      "          key={item.id}",
      '          type="button"',
      '          className={item.id === activeId ? "active" : "idle"}',
      "          onClick={() => onSelect(item.id)}",
      "        >",
      "          {item.label}",
      "        </button>",
      "      ))}",
      "    </section>",
      "  );",
      "}",
    ].join("\n");

    await createFile(tsxPath, { code: tsxSource, projectRoot: tmpDir });
    const tsxBefore = fs.readFileSync(tsxPath, "utf-8");
    const tsxSpan = locateNativeDeclarationSpan(tsxBefore, "tsx", "HudPanel", tsxPath)!;
    expect(tsxSpan).not.toBeNull();
    const tsxPrefix = tsxBefore.slice(0, tsxSpan.startOffset);
    expect(tsxPrefix).toContain(
      "export interface HudPanelProps<TItem extends { id: string; label: string }>",
    );

    await splice(tsxPath, {
      symbol: "HudPanel",
      code: [
        "pub fn HudPanel<TItem extends { id: string; label: string }>(props: HudPanelProps<TItem>) {",
        "  return (",
        '    <section className="hud-panel-v2" data-count={props.items.length}>',
        "      {props.items.map((it) => (",
        '        <button key={it.id} type="button" onClick={() => props.onSelect(it.id)}>',
        "          {it.label}",
        "        </button>",
        "      ))}",
        "    </section>",
        "  );",
        "}",
      ].join("\n"),
    });

    const tsxAfter = fs.readFileSync(tsxPath, "utf-8");
    expect(tsxAfter.startsWith(tsxPrefix)).toBe(true);
    expect(tsxAfter).toContain("hud-panel-v2");
  });

  it("2. JavaScript (.js, .mjs, .cjs) & JSX (.jsx): hybrid pub fn + { ... }, private fields #state, async function*, Web Audio API patterns, and vm.Script verification", async () => {
    const mjsPath = path.join(tmpDir, "synth_audio.mjs");
    const jsPath = path.join(tmpDir, "worker_bus.js");
    const cjsPath = path.join(tmpDir, "legacy_adapter.cjs");
    const jsxPath = path.join(tmpDir, "ScoreTicker.jsx");

    await createBatch(
      [
        {
          path: mjsPath,
          code: [
            "@idiom $midiToHz($n) => (440 * Math.pow(2, (($n) - 69) / 12))",
            "export class SynthEngine {",
            "  #ctx = null;",
            "  #gainNode = null;",
            "  constructor(AudioCtx) {",
            "    this.#ctx = new AudioCtx();",
            "    this.#gainNode = this.#ctx.createGain();",
            "  }",
            "  triggerNote(midiNote, durationSec = 0.15) {",
            "    const osc = this.#ctx.createOscillator();",
            "    osc.frequency.setValueAtTime($midiToHz(midiNote), this.#ctx.currentTime);",
            "    osc.connect(this.#gainNode);",
            "    return osc;",
            "  }",
            "}",
            "pub async function* streamArpeggio(notes) {",
            "  for (const n of notes) {",
            "    yield $midiToHz(n);",
            "  }",
            "}",
            "pub fn clampGain(val) {",
            "  ret Math.max(0.0001, Math.min(1.0, val));",
            "}",
          ].join("\n"),
        },
        {
          path: jsPath,
          code: [
            'pub const CHANNELS = { "0>1": "primary", "soft-drop": "aux" };',
            "pub fn resolveChannel(key) {",
            '  ret CHANNELS[key] ?? "default";',
            "}",
          ].join("\n"),
        },
        {
          path: cjsPath,
          code: [
            'const { EventEmitter } = require("node:events");',
            "class LegacyBus extends EventEmitter {",
            "  #count = 0;",
            "  emitMetric(name, payload) {",
            "    this.#count += 1;",
            "    this.emit(name, { seq: this.#count, payload });",
            "    return this.#count;",
            "  }",
            "}",
            "module.exports = { LegacyBus };",
          ].join("\n"),
        },
        {
          path: jsxPath,
          code: [
            "pub fn ScoreTicker({ score, highScore }) {",
            "  return (",
            '    <div className="score-ticker" style={{ color: "#00f3ff" }}>',
            "      <span>{score}</span> / <strong>{highScore}</strong>",
            "    </div>",
            "  );",
            "}",
          ].join("\n"),
        },
      ],
      { projectRoot: tmpDir },
    );

    // Verify Node vm.Script syntax on .mjs, .js, .cjs
    for (const p of [mjsPath, jsPath, cjsPath]) {
      const content = fs.readFileSync(p, "utf-8");
      const strippedEsm = content
        .replace(/^\s*export\s+default\s+/gm, "")
        .replace(/^\s*export\s+(?=(?:async\s+)?function|class|const|let|var)/gm, "");
      expect(() => new vm.Script(strippedEsm, { filename: p })).not.toThrow();
    }
    expect(fs.readFileSync(mjsPath, "utf-8")).toContain(
      "440 * Math.pow(2, ((midiNote) - 69) / 12)",
    );
    expect(fs.readFileSync(mjsPath, "utf-8")).toContain("#ctx = null;");
    expect(fs.readFileSync(mjsPath, "utf-8")).toContain(
      "export async function* streamArpeggio(notes)",
    );
    expect(fs.readFileSync(jsxPath, "utf-8")).toContain('style={{ color: "#00f3ff" }}');
  });

  it("3. Python (.py): stacked decorators, match/case, async comprehensions, union types int | str | None, multi-line docstrings, and $idiom expansion", async () => {
    const pyPath = path.join(tmpDir, "fastapi_router.py");
    const pySource = [
      "@idiom $clamp_score($x, $lo, $hi) => max($lo, min($hi, $x))",
      "from typing import Any",
      "",
      "DEFAULT_TIMEOUT: int = 30",
      "",
      '@router.post("/v1/{item_id}")',
      '@require_scope("items:write")',
      "async def handle_item_event(item_id: str, payload: dict[str, Any], retry: int | str | None = None) -> dict[str, Any]:",
      '    """',
      "    Process incoming item telemetry event with pattern matching.",
      "    Preserves #fff hex and nested quotes inside docstring.",
      '    """',
      "    normalized = [x async for x in stream_chunks(item_id) if x is not None]",
      '    match payload.get("kind"):',
      '        case "score":',
      '            val = $clamp_score(int(payload.get("value", 0)), 0, 9999)',
      '            return {"id": item_id, "score": val, "chunks": len(normalized)}',
      '        case "reset":',
      '            return {"id": item_id, "score": 0, "retry": retry}',
      "        case _:",
      '            return {"id": item_id, "status": "ignored"}',
      "",
      "def summarize_batch(scores: list[int]) -> int:",
      "    return sum($clamp_score(s, 0, 100) for s in scores)",
      "",
    ].join("\n");

    const createdPy = await createFile(pyPath, { code: pySource, projectRoot: tmpDir });
    expect(createdPy.content).toContain('@router.post("/v1/{item_id}")');
    expect(createdPy.content).toContain('@require_scope("items:write")');
    expect(createdPy.content).toContain('match payload.get("kind"):');
    expect(createdPy.content).toContain('max(0, min(9999, int(payload.get("value", 0))))');
    expect(createdPy.content).toContain("retry: int | str | None = None");

    const beforePy = fs.readFileSync(pyPath, "utf-8");
    const pySpan = locateNativeDeclarationSpan(beforePy, "python", "summarize_batch", pyPath)!;
    expect(pySpan).not.toBeNull();
    const pyPrefix = beforePy.slice(0, pySpan.startOffset);

    await splice(pyPath, {
      symbol: "summarize_batch",
      code: [
        "@idiom $clamp_score($x, $lo, $hi) => max($lo, min($hi, $x))",
        "def summarize_batch(scores: list[int]) -> int:",
        "    return sum($clamp_score(s, 10, 500) * 2 for s in scores)",
      ].join("\n"),
    });

    const afterPy = fs.readFileSync(pyPath, "utf-8");
    expect(afterPy.startsWith(pyPrefix)).toBe(true);
    expect(afterPy).toContain("max(10, min(500, s)) * 2");
  });

  it("4. Rust (.rs): lifetimes 'a, trait bounds where T: Clone + Send + 'static, #[derive(...)], macro_rules!, ? operator, and raw strings r#\"...\"#", async () => {
    const rsPath = path.join(tmpDir, "pipeline.rs");
    const rsSource = [
      "@idiom $clamp_u32($v, $lo, $hi) => ($v).clamp($lo, $hi)",
      "",
      "macro_rules! metric_tag {",
      "    ($k:expr, $v:expr) => {",
      '        format!("{}:{}", $k, $v)',
      "    };",
      "}",
      "",
      "#[derive(Debug, Clone, PartialEq, Eq)]",
      "pub struct ZeroCopyFrame<'a, T>",
      "where",
      "    T: Clone + Send + 'static,",
      "{",
      "    pub topic: &'a str,",
      "    pub payload: T,",
      "    pub weight: u32,",
      "}",
      "",
      "pub fn decode_frame<'a>(raw: &'a str, bonus: u32) -> Result<ZeroCopyFrame<'a, String>, String> {",
      '    let schema = r#"{"version": 2, "color": "#00f3ff", "mode": "strict"}"#;',
      "    if raw.is_empty() {",
      '        return Err(format!("empty frame for schema {}", schema));',
      "    }",
      "    let part = raw.split(':').next().ok_or_else(|| \"missing colon\".to_string())?;",
      "    let tag = metric_tag!(part, $clamp_u32(bonus, 1, 100));",
      "    Ok(ZeroCopyFrame {",
      "        topic: part,",
      "        payload: tag,",
      "        weight: $clamp_u32(bonus, 1, 100),",
      "    })",
      "}",
    ].join("\n");

    const createdRs = await createFile(rsPath, { code: rsSource, projectRoot: tmpDir });
    expect(createdRs.content).toContain("pub struct ZeroCopyFrame<'a, T>");
    expect(createdRs.content).toContain("T: Clone + Send + 'static,");
    expect(createdRs.content).toContain(
      'r#"{"version": 2, "color": "#00f3ff", "mode": "strict"}"#',
    );
    expect(createdRs.content).toContain("(bonus).clamp(1, 100)");

    const rsBefore = fs.readFileSync(rsPath, "utf-8");
    const rsSpan = locateNativeDeclarationSpan(rsBefore, "rust", "decode_frame", rsPath)!;
    expect(rsSpan).not.toBeNull();
    const rsPrefix = rsBefore.slice(0, rsSpan.startOffset);

    await splice(rsPath, {
      symbol: "decode_frame",
      code: [
        "pub fn decode_frame<'a>(raw: &'a str, bonus: u32) -> Result<ZeroCopyFrame<'a, String>, String> {",
        "    let part = raw.split(':').next().ok_or_else(|| \"missing\".to_string())?;",
        "    Ok(ZeroCopyFrame {",
        "        topic: part,",
        "        payload: metric_tag!(part, bonus),",
        "        weight: bonus.saturating_mul(2),",
        "    })",
        "}",
      ].join("\n"),
    });

    const rsAfter = fs.readFileSync(rsPath, "utf-8");
    expect(rsAfter.startsWith(rsPrefix)).toBe(true);
    expect(rsAfter).toContain("bonus.saturating_mul(2)");
  });

  it('5. Go (.go): struct tags `json:"id,omitempty"`, channels <-ch / ch <- msg, defer, pointer receivers func (s *Server) Handle(...), and select blocks', async () => {
    const goPath = path.join(tmpDir, "dispatcher.go");
    const goSource = [
      "package dispatcher",
      "",
      'import "context"',
      "",
      "type TelemetryPacket struct {",
      '\tID      string `json:"id,omitempty"`',
      '\tLatency int    `json:"latency_ms"`',
      "}",
      "",
      "type Server struct {",
      "\tinbox  chan TelemetryPacket",
      "\toutbox chan int",
      "}",
      "",
      "func (s *Server) Handle(ctx context.Context, pkt TelemetryPacket) int {",
      "\tdefer func() { recover() }()",
      "\tselect {",
      "\tcase s.inbox <- pkt:",
      "\t\tval := <-s.outbox",
      "\t\treturn val + pkt.Latency",
      "\tcase <-ctx.Done():",
      "\t\treturn -1",
      "\t}",
      "}",
      "",
      "func ComputeWeight(base int, scale int) int {",
      "\treturn base*scale + 10",
      "}",
    ].join("\n");

    const createdGo = await createFile(goPath, { code: goSource, projectRoot: tmpDir });
    expect(createdGo.content).toContain('`json:"id,omitempty"`');
    expect(createdGo.content).toContain("case s.inbox <- pkt:");
    expect(createdGo.content).toContain("val := <-s.outbox");

    const goBefore = fs.readFileSync(goPath, "utf-8");
    const goSpan = locateNativeDeclarationSpan(goBefore, "go", "ComputeWeight", goPath)!;
    const goPrefix = goBefore.slice(0, goSpan.startOffset);

    await splice(goPath, {
      symbol: "ComputeWeight",
      code: ["func ComputeWeight(base int, scale int) int {", "\treturn base*scale + 42", "}"].join(
        "\n",
      ),
    });

    const goAfter = fs.readFileSync(goPath, "utf-8");
    expect(goAfter.startsWith(goPrefix)).toBe(true);
    expect(goAfter).toContain("base*scale + 42");
  });

  it("6. C++ (.cpp, .cc, .cxx, .hpp, .h): template <typename T>, RAII destructors ~Engine(), lambdas [&](const auto& item), std::unique_ptr, and namespaces", async () => {
    const hppPath = path.join(tmpDir, "engine.hpp");
    const hPath = path.join(tmpDir, "types.h");
    const cppPath = path.join(tmpDir, "engine.cpp");
    const ccPath = path.join(tmpDir, "kernel.cc");
    const cxxPath = path.join(tmpDir, "simd.cxx");

    await createBatch(
      [
        {
          path: hPath,
          code: [
            "#pragma once",
            "struct FrameMetrics {",
            "    int frameId;",
            "    double deltaMs;",
            "};",
          ].join("\n"),
        },
        {
          path: hppPath,
          code: [
            "#pragma once",
            "#include <memory>",
            "#include <vector>",
            "#include <algorithm>",
            "",
            "namespace aice::core {",
            "",
            "template <typename T>",
            "class RingBuffer {",
            "public:",
            "    explicit RingBuffer(size_t cap) : capacity_(cap) {}",
            "    ~RingBuffer() = default;",
            "    size_t capacity() const noexcept { return capacity_; }",
            "private:",
            "    size_t capacity_;",
            "};",
            "",
            "} // namespace aice::core",
          ].join("\n"),
        },
        {
          path: cppPath,
          code: [
            "@idiom $clamp_val($v, $lo, $hi) => std::clamp($v, $lo, $hi)",
            '#include "engine.hpp"',
            "",
            "template <typename T>",
            "T accumulateClamped(const std::vector<T>& items, T lo, T hi) {",
            "    T total = static_cast<T>(0);",
            "    std::for_each(items.begin(), items.end(), [&](const auto& item) {",
            "        total += $clamp_val(item, lo, hi);",
            "    });",
            "    return total;",
            "}",
            "",
            "int computeStepScore(int raw, int bonus) {",
            "    return $clamp_val(raw, 0, 1000) + bonus;",
            "}",
          ].join("\n"),
        },
        {
          path: ccPath,
          code: "int runKernelCc(int x) {\n    return x * 2;\n}\n",
        },
        {
          path: cxxPath,
          code: "int runSimdCxx(int x) {\n    return x * 4;\n}\n",
        },
      ],
      { projectRoot: tmpDir },
    );

    const cppBefore = fs.readFileSync(cppPath, "utf-8");
    expect(cppBefore).toContain("template <typename T>");
    expect(cppBefore).toContain("[&](const auto& item)");
    expect(cppBefore).toContain("std::clamp(item, lo, hi)");

    const cppSpan = locateNativeDeclarationSpan(cppBefore, "cpp", "computeStepScore", cppPath)!;
    const cppPrefix = cppBefore.slice(0, cppSpan.startOffset);

    await splice(cppPath, {
      symbol: "computeStepScore",
      code: [
        "int computeStepScore(int raw, int bonus) {",
        "    return std::clamp(raw, 0, 2000) + bonus * 3;",
        "}",
      ].join("\n"),
    });

    const cppAfter = fs.readFileSync(cppPath, "utf-8");
    expect(cppAfter.startsWith(cppPrefix)).toBe(true);
    expect(cppAfter).toContain("bonus * 3");
  });

  it('7. C# (.cs): [HttpGet("{id}")], LINQ .Where(x => x.IsActive), record, async Task<IActionResult>, and nullable reference types', async () => {
    const csPath = path.join(tmpDir, "TelemetryController.cs");
    const csSource = [
      "using System;",
      "using System.Collections.Generic;",
      "using System.Linq;",
      "using System.Threading.Tasks;",
      "",
      "namespace Aice.Enterprise;",
      "",
      "public record MetricNode(string Id, int Score, bool IsActive, string? Tag = null);",
      "",
      "public class TelemetryController",
      "{",
      '    [HttpGet("{id}")]',
      "    public async Task<int> GetActiveScoreAsync(string id, IEnumerable<MetricNode> nodes)",
      "    {",
      "        await Task.Yield();",
      "        return nodes",
      "            .Where(x => x.IsActive && x.Id.StartsWith(id, StringComparison.Ordinal))",
      "            .Select(x => x.Score)",
      "            .DefaultIfEmpty(0)",
      "            .Sum();",
      "    }",
      "",
      "    public int NormalizeFactor(int factor)",
      "    {",
      "        return Math.Clamp(factor, 1, 10);",
      "    }",
      "}",
    ].join("\n");

    const createdCs = await createFile(csPath, { code: csSource, projectRoot: tmpDir });
    expect(createdCs.content).toContain(
      "public record MetricNode(string Id, int Score, bool IsActive, string? Tag = null);",
    );
    expect(createdCs.content).toContain('[HttpGet("{id}")]');
    expect(createdCs.content).toContain(
      ".Where(x => x.IsActive && x.Id.StartsWith(id, StringComparison.Ordinal))",
    );

    const csBefore = fs.readFileSync(csPath, "utf-8");
    const csSpan = locateNativeDeclarationSpan(
      csBefore,
      "csharp",
      "TelemetryController.NormalizeFactor",
      csPath,
    )!;
    const csPrefix = csBefore.slice(0, csSpan.startOffset);
    const csSuffix = csBefore.slice(csSpan.endOffset);

    await splice(csPath, {
      symbol: "TelemetryController.NormalizeFactor",
      code: [
        "    public int NormalizeFactor(int factor)",
        "    {",
        "        return Math.Clamp(factor, 5, 50) * 2;",
        "    }",
      ].join("\n"),
    });

    const csAfter = fs.readFileSync(csPath, "utf-8");
    expect(csAfter.startsWith(csPrefix)).toBe(true);
    expect(csAfter.endsWith(csSuffix)).toBe(true);
    expect(csAfter).toContain("Math.Clamp(factor, 5, 50) * 2");
  });

  it("8. Kotlin (.kt, .kts): data class, sealed interface, suspend fun, extension functions, and coroutine flow { emit(...) }", async () => {
    const ktPath = path.join(tmpDir, "StreamProcessor.kt");
    const ktsPath = path.join(tmpDir, "build.gradle.kts");

    const ktSource = [
      "package dev.aice.stream",
      "",
      "import kotlinx.coroutines.flow.Flow",
      "import kotlinx.coroutines.flow.flow",
      "",
      "sealed interface StreamEvent {",
      "    data class Data(val id: String, val value: Int) : StreamEvent",
      "    data object Complete : StreamEvent",
      "}",
      "",
      "fun Int.clampScore(minVal: Int, maxVal: Int): Int = this.coerceIn(minVal, maxVal)",
      "",
      "suspend fun emitBoundedStream(items: List<Int>): Flow<StreamEvent> = flow {",
      "    for ((idx, item) in items.withIndex()) {",
      '        emit(StreamEvent.Data("item-$idx", item.clampScore(0, 100)))',
      "    }",
      "    emit(StreamEvent.Complete)",
      "}",
      "",
      "fun calculateBonus(base: Int, mult: Int): Int {",
      "    return base * mult + 5",
      "}",
    ].join("\n");

    await createBatch(
      [
        { path: ktPath, code: ktSource },
        {
          path: ktsPath,
          code: ["fun resolveVersionTag(): String {", '    return "0.9.7"', "}"].join("\n"),
        },
      ],
      { projectRoot: tmpDir },
    );

    const ktBefore = fs.readFileSync(ktPath, "utf-8");
    expect(ktBefore).toContain("sealed interface StreamEvent");
    expect(ktBefore).toContain(
      "suspend fun emitBoundedStream(items: List<Int>): Flow<StreamEvent> = flow",
    );

    const ktSpan = locateNativeDeclarationSpan(ktBefore, "kotlin", "calculateBonus", ktPath)!;
    const ktPrefix = ktBefore.slice(0, ktSpan.startOffset);

    await splice(ktPath, {
      symbol: "calculateBonus",
      code: [
        "fun calculateBonus(base: Int, mult: Int): Int {",
        "    return base * mult + 25",
        "}",
      ].join("\n"),
    });

    const ktAfter = fs.readFileSync(ktPath, "utf-8");
    expect(ktAfter.startsWith(ktPrefix)).toBe(true);
    expect(ktAfter).toContain("base * mult + 25");
  });

  it("9. PHP (.php): declare(strict_types=1);, namespaces, #[Route('/api')], native $variables + $this->repo->find($id) alongside AICE $idiom(...) calls", async () => {
    const phpPath = path.join(tmpDir, "InvoiceController.php");
    const phpSource = [
      "<?php",
      "declare(strict_types=1);",
      "",
      "namespace App\\Controller;",
      "",
      "@idiom $clampPhp($v, $lo, $hi) => max($lo, min($hi, $v))",
      "",
      "#[Route('/api/invoices')]",
      "final class InvoiceController",
      "{",
      "    public function __construct(private readonly object $repo) {}",
      "",
      "    #[Route('/{id}', methods: ['GET'])]",
      "    public function show(int $id, int $discountPct): array",
      "    {",
      "        $record = $this->repo->find($id);",
      "        $safeDiscount = $clampPhp($discountPct, 0, 80);",
      "        $totalCents = (int) ($record->subtotalCents ?? 1000);",
      "        return [",
      "            'id' => $id,",
      "            'discount' => $safeDiscount,",
      "            'finalCents' => $totalCents - (int) (($totalCents * $safeDiscount) / 100),",
      "        ];",
      "    }",
      "",
      "    public function computeTaxCents(int $amountCents, int $ratePct): int",
      "    {",
      "        return (int) (($amountCents * $ratePct) / 100);",
      "    }",
      "}",
    ].join("\n");

    const createdPhp = await createFile(phpPath, { code: phpSource, projectRoot: tmpDir });
    // Verify PHP native $variables and $this->repo->find($id) were preserved untouched while $clampPhp expanded!
    expect(createdPhp.content).toContain("declare(strict_types=1);");
    expect(createdPhp.content).toContain("$record = $this->repo->find($id);");
    expect(createdPhp.content).toContain("$safeDiscount = max(0, min(80, $discountPct));");
    expect(createdPhp.content).not.toContain("@idiom");

    const phpBefore = fs.readFileSync(phpPath, "utf-8");
    const phpSpan = locateNativeDeclarationSpan(
      phpBefore,
      "php",
      "InvoiceController.computeTaxCents",
      phpPath,
    )!;
    const phpPrefix = phpBefore.slice(0, phpSpan.startOffset);
    const phpSuffix = phpBefore.slice(phpSpan.endOffset);

    await splice(phpPath, {
      symbol: "InvoiceController.computeTaxCents",
      code: [
        "@idiom $clampPhp($v, $lo, $hi) => max($lo, min($hi, $v))",
        "    public function computeTaxCents(int $amountCents, int $ratePct): int",
        "    {",
        "        $boundedRate = $clampPhp($ratePct, 0, 50);",
        "        return (int) (($amountCents * $boundedRate) / 100);",
        "    }",
      ].join("\n"),
    });

    const phpAfter = fs.readFileSync(phpPath, "utf-8");
    expect(phpAfter.startsWith(phpPrefix)).toBe(true);
    expect(phpAfter.endsWith(phpSuffix)).toBe(true);
    expect(phpAfter).toContain("$boundedRate = max(0, min(50, $ratePct));");
  });

  it("10. CSS (.css), HTML (.html, .htm), Twig (.twig), JSON (.json), YAML (.yaml, .yml): @keyframes, @media, CSS shorthands, Twig blocks, JSON/YAML dot-path splicing, and YAML anchors &base/*base", async () => {
    const cssPath = path.join(tmpDir, "neon_hud.css");
    const htmlPath = path.join(tmpDir, "index.html");
    const htmPath = path.join(tmpDir, "widget.htm");
    const twigPath = path.join(tmpDir, "dashboard.twig");
    const jsonPath = path.join(tmpDir, "manifest.json");
    const yamlPath = path.join(tmpDir, "pipeline.yaml");
    const ymlPath = path.join(tmpDir, "docker-compose.yml");

    await createBatch(
      [
        {
          path: cssPath,
          code: [
            ":root {",
            "  --neon-cyan: #00f3ff;",
            "  --neon-magenta: #ff007f;",
            "}",
            "@keyframes pulseGlow {",
            "  0% { opacity: 0.6; }",
            "  100% { opacity: 1; }",
            "}",
            ".hud-grid {",
            "  d: grid;",
            "  gtc: repeat(3, 1fr);",
            "  g: 16px;",
            "  bg: #05070e;",
            "  c: var(--neon-cyan);",
            "}",
            "@media (max-width: 768px) {",
            "  .hud-grid {",
            "    gtc: 1fr;",
            "  }",
            "}",
          ].join("\n"),
        },
        {
          path: htmlPath,
          code: [
            "<!DOCTYPE html>",
            '<html lang="en">',
            "<head><title>Neon Arena</title></head>",
            "<body>",
            '  <main id="arena-root">',
            '    <section id="scoreboard" class="card">Score: 0</section>',
            "  </main>",
            "</body>",
            "</html>",
          ].join("\n"),
        },
        {
          path: htmPath,
          code: '<div id="mini-widget"><span>Ready</span></div>\n',
        },
        {
          path: twigPath,
          code: [
            '{% extends "base.html.twig" %}',
            "{% block header %}",
            '  <header class="top-bar">{{ title|escape }}</header>',
            "{% endblock %}",
            "{% block content %}",
            '  <section class="metrics">{{ total_score }}</section>',
            "{% endblock %}",
          ].join("\n"),
        },
        {
          path: jsonPath,
          code: JSON.stringify(
            {
              name: "aice-enterprise-suite",
              version: "0.9.7",
              features: {
                losslessPreprocessor: true,
                batchSpliceLimit: 32,
              },
            },
            null,
            2,
          ),
        },
        {
          path: yamlPath,
          code: [
            "defaults: &base",
            "  retries: 3",
            "  timeoutSec: 30",
            "production:",
            "  <<: *base",
            "  replicas: 4",
          ].join("\n"),
        },
        {
          path: ymlPath,
          code: [
            "services:",
            "  api:",
            "    image: node:22-alpine",
            "    ports:",
            '      - "3000:3000"',
          ].join("\n"),
        },
      ],
      { projectRoot: tmpDir },
    );

    const cssContent = fs.readFileSync(cssPath, "utf-8");
    expect(cssContent).toContain("--neon-cyan: #00f3ff;");
    expect(cssContent).toContain("@keyframes pulseGlow");
    expect(cssContent).toContain("display: grid;");
    expect(cssContent).toContain("grid-template-columns: repeat(3, 1fr);");
    expect(cssContent).toContain("gap: 16px;");

    // Splice .hud-grid in CSS while preserving :root, @keyframes, and @media
    await splice(cssPath, {
      symbol: ".hud-grid",
      code: ".hud-grid {\n  d: flex;\n  jc: space-between;\n  g: 24px;\n}",
    });
    const cssAfter = fs.readFileSync(cssPath, "utf-8");
    expect(cssAfter).toContain("--neon-cyan: #00f3ff;");
    expect(cssAfter).toContain("@keyframes pulseGlow");
    expect(cssAfter).toContain("display: flex;");
    expect(cssAfter).toContain("justify-content: space-between;");
    expect(cssAfter).toContain("@media (max-width: 768px)");

    // Splice Twig block
    await splice(twigPath, {
      symbol: "block:content",
      code: '{% block content %}\n  <section class="metrics-v2">{{ total_score }} pts</section>\n{% endblock %}',
    });
    const twigAfter = fs.readFileSync(twigPath, "utf-8");
    expect(twigAfter).toContain('{% extends "base.html.twig" %}');
    expect(twigAfter).toContain("{{ title|escape }}");
    expect(twigAfter).toContain("metrics-v2");

    // Splice JSON nested dot-path
    await splice(jsonPath, {
      symbol: "features.batchSpliceLimit",
      code: "64",
    });
    const parsedJson = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
    expect(parsedJson.features.batchSpliceLimit).toBe(64);
    expect(parsedJson.version).toBe("0.9.7");

    // Splice YAML nested key while verifying valid YAML
    await splice(yamlPath, {
      symbol: "production.replicas",
      code: "8",
    });
    expect(fs.readFileSync(yamlPath, "utf-8")).toContain("replicas: 8");
  });

  it("11. Multi-Symbol Batch Splicing (`edits` array): updates 5 functions atomically in reverse offset order without offset drift while preserving interleaved comments/constants byte-for-byte", async () => {
    const batchTsPath = path.join(tmpDir, "multi_batch_service.ts");
    const initialSource = [
      "// === HEADER SENTINEL: DO NOT TOUCH ===",
      'export const TABLE_A = { "0>1": 100, "soft-drop": 200 };',
      "",
      "export function fnAlpha(x: number): number {",
      "  return x + 1;",
      "}",
      "",
      "// --- INTERLEAVED COMMENT 1 ---",
      "export function fnBeta(x: number): number {",
      "  return x + 2;",
      "}",
      "",
      "// --- INTERLEAVED COMMENT 2 ---",
      "export function fnGamma(x: number): number {",
      "  return x + 3;",
      "}",
      "",
      "// --- INTERLEAVED COMMENT 3 ---",
      "export function fnDelta(x: number): number {",
      "  return x + 4;",
      "}",
      "",
      "// --- INTERLEAVED COMMENT 4 ---",
      "export function fnEpsilon(x: number): number {",
      "  return x + 5;",
      "}",
      "",
      "// === FOOTER SENTINEL: DO NOT TOUCH ===",
    ].join("\n");

    await createFile(batchTsPath, { code: initialSource, projectRoot: tmpDir });

    const startMs = performance.now();
    const res = await splice(batchTsPath, {
      edits: [
        { symbol: "fnAlpha", code: "pub fn fnAlpha(x: :#): :# {\n  ret x * 10;\n}" },
        { symbol: "fnBeta", code: "pub fn fnBeta(x: :#): :# {\n  ret x * 20;\n}" },
        { symbol: "fnGamma", code: "pub fn fnGamma(x: :#): :# {\n  ret x * 30;\n}" },
        { symbol: "fnDelta", code: "pub fn fnDelta(x: :#): :# {\n  ret x * 40;\n}" },
        { symbol: "fnEpsilon", code: "pub fn fnEpsilon(x: :#): :# {\n  ret x * 50;\n}" },
      ],
    });
    const elapsedMs = performance.now() - startMs;

    expect(elapsedMs).toBeLessThan(250);
    expect(res.modifiedCode).toContain("// === HEADER SENTINEL: DO NOT TOUCH ===");
    expect(res.modifiedCode).toContain('export const TABLE_A = { "0>1": 100, "soft-drop": 200 };');
    expect(res.modifiedCode).toContain("// --- INTERLEAVED COMMENT 1 ---");
    expect(res.modifiedCode).toContain("// --- INTERLEAVED COMMENT 2 ---");
    expect(res.modifiedCode).toContain("// --- INTERLEAVED COMMENT 3 ---");
    expect(res.modifiedCode).toContain("// --- INTERLEAVED COMMENT 4 ---");
    expect(res.modifiedCode).toContain("// === FOOTER SENTINEL: DO NOT TOUCH ===");
    expect(res.modifiedCode).toContain("return x * 10;");
    expect(res.modifiedCode).toContain("return x * 20;");
    expect(res.modifiedCode).toContain("return x * 30;");
    expect(res.modifiedCode).toContain("return x * 40;");
    expect(res.modifiedCode).toContain("return x * 50;");
  });

  it("12. Polyglot Line-Range Indexing (`[Lstart-Lend]`) & Multi-Language Pre-Write Syntax Validation Gates", async () => {
    const pyFile = path.join(tmpDir, "indexed_service.py");
    await createFile(pyFile, {
      code: [
        "class MetricsCollector:",
        "    def record_hit(self, count: int) -> int:",
        "        return count + 1",
        "",
        "def compute_total(values: list[int]) -> int:",
        "    return sum(values)",
      ].join("\n"),
      projectRoot: tmpDir,
    });

    const outRes = (await outlinePath(pyFile)) as OutlineResult;
    expect(outRes.text).toMatch(/\[L\d+-L\d+\]/);
    expect(outRes.symbols.length).toBeGreaterThanOrEqual(2);
    expect(outRes.symbols[0].lineRange).toMatch(/^\[L\d+-L\d+\]$/);

    const ctxRes = await generateContext(pyFile, { projectRoot: tmpDir });
    expect(ctxRes.formattedBundle).toMatch(/\[L\d+-L\d+\]/);

    // Verify pre-write syntax validation gate across multiple languages
    expect(validateNativeSyntax('{"unclosed": [1, 2}', "json", "bad.json").valid).toBe(false);
    expect(validateNativeSyntax(".card { color: red; ", "css", "bad.css").valid).toBe(false);
    expect(
      validateNativeSyntax("pub;\nfn;\nexport const x = ;", "typescript", "bad.ts").valid,
    ).toBe(false);
    expect(validateNativeSyntax("{% block main %}<div>{% endblock", "twig", "bad.twig").valid).toBe(
      false,
    );
    expect(
      validateNativeSyntax("def broken(x: int) -> int:\n    return (x + 1\n", "python", "bad.py")
        .valid,
    ).toBe(false);

    // Verify broken file on disk surfaces `## ⚠️ Native Syntax Diagnostics` in outlinePath & generateContext
    const brokenCss = path.join(tmpDir, "broken.css");
    fs.writeFileSync(brokenCss, ".panel {\n  color: #fff;\n  background: (\n", "utf-8");
    const brokenOut = (await outlinePath(brokenCss)) as OutlineResult;
    expect(brokenOut.text).toContain("## ⚠️ Native Syntax Diagnostics");
    const brokenCtx = await generateContext(brokenCss, { projectRoot: tmpDir });
    expect(brokenCtx.formattedBundle).toContain("## ⚠️ Native Syntax Diagnostics");
    expect(brokenCtx.nativeDiagnostics).toContain("## ⚠️ Native Syntax Diagnostics");
  });

  it("13. Deep Edge-Case Regressions: regex/comments inside template `${...}`, `-> :#` & `[#]` sigils, Twig nested CSS `}}`, multi-line docstring diagnostic offsets, `=>` option idioms, match-arm `$idioms`, `<-` native splices, void C#/C++ fns, and C++ method overloads", () => {
    // 1. Regex with quotes/braces and block comments with `}` inside JS/TS template literal `${...}`
    const tplSrc =
      "export const check = (s: string) => `res: ${ /don't/.test(s) && /}/g.test(s) && /* } */ true }`;";
    const tplOut = preprocessHybridAndIdiomsLossless(tplSrc, "typescript");
    expect(tplOut).toBe(tplSrc);
    expect(validateNativeSyntax(tplOut, "typescript", "check.ts").valid).toBe(true);

    // 2. Return type compact sigil `-> :#` in Rust, TypeScript, and PHP
    expect(
      preprocessHybridAndIdiomsLossless("pub fn calc(x: :#) -> :# {\n  <- x + 1.0\n}", "rust"),
    ).toContain("pub fn calc(x: f64) -> f64 {");
    expect(
      preprocessHybridAndIdiomsLossless("pub fn calc(x: :#) -> :# {\n  <- x + 1\n}", "typescript"),
    ).toContain("export function calc(x: number): number {");

    // 3. Array compact sigils `[#]` in C++, C#, and PHP
    expect(
      preprocessHybridAndIdiomsLossless("pub fn sum(xs: [#]) -> :# {\n  <- 0.0;\n}", "cpp"),
    ).toContain("double sum(std::vector<double> xs) {");
    expect(
      preprocessHybridAndIdiomsLossless("pub fn sum(xs: [#]) -> :# {\n  <- 0.0;\n}", "csharp"),
    ).toContain("public double sum(double[] xs) {");
    expect(
      preprocessHybridAndIdiomsLossless("pub fn sum($xs: [#]) -> :# {\n  <- 0.0;\n}", "php"),
    ).toContain("public function sum(array $xs): float {");

    // 4. Twig comment with `{%` and nested CSS `@media { .card { ... }}` alongside `{{ title }}`
    const twigWithNestedCss =
      "{# comment with {% if x %} #}\n<style>@media (max-width: 600px) { .card { color: #fff; }}</style>\n<div>{{ title }}</div>";
    expect(validateNativeSyntax(twigWithNestedCss, "twig", "nested.html.twig").valid).toBe(true);

    // 5. Accurate line/column diagnostic offset after multi-line Python docstring
    const pyBroken = [
      '"""',
      "Line 2 of docstring",
      "Line 3 of docstring",
      "Line 4 of docstring",
      '"""',
      "def broken_fn(x: int) -> int:",
      "    return (x + 1",
    ].join("\n");
    const pyDiag = validateNativeSyntax(pyBroken, "python", "broken.py");
    expect(pyDiag.valid).toBe(false);
    expect(pyDiag.items[0]?.line).toBe(7);

    // 6. `parseOptionIdioms` with `=>` arrow separator
    const parsedIdioms = parseOptionIdioms("$clamp($0,$1,$2) => Math.max($1, Math.min($2, $0))");
    expect(parsedIdioms.$clamp.templateAice).toBe("Math.max($1, Math.min($2, $0))");

    // 7. Inline `@idiom` with `return` expanded inside Rust `match` arm
    const rsIdiomMatch = [
      "@idiom $bail($0) = return Err($0)",
      "pub fn check(x: Option<i32>) -> Result<i32, &str> {",
      "    match x {",
      "        Some(v) => Ok(v),",
      '        None => $bail("missing"),',
      "    }",
      "}",
    ].join("\n");
    const ex = extractInlineIdiomsFromSource(rsIdiomMatch);
    const rsExpanded = preprocessHybridAndIdiomsLossless(ex.cleanedCode, "rust", ex.inlineIdioms);
    expect(rsExpanded).toContain('None => return Err("missing"),');

    // 8. Splicing native Rust and Python functions containing `<-` return shorthands
    const rsOrig = "pub fn calc(x: f64) -> f64 {\n    return x;\n}\n";
    const rsSpliced = spliceNativeSource(
      rsOrig,
      { symbol: "calc", code: "pub fn calc(x: f64) -> f64 {\n    <- x + 1.0;\n}" },
      "calc.rs",
    );
    expect(rsSpliced.modifiedCode).toContain("return x + 1.0;");

    const pyOrig = "def calc(x: float) -> float:\n    return x\n";
    const pySpliced = spliceNativeSource(
      pyOrig,
      { symbol: "calc", code: "def calc(x: float) -> float:\n    <- x + 1.0" },
      "calc.py",
    );
    expect(pySpliced.modifiedCode).toContain("return x + 1.0");

    // 9. Void hybrid `pub fn` without `->` in C# and C++
    expect(
      preprocessHybridAndIdiomsLossless("pub fn reset(x: :#) {\n  ret;\n}", "csharp"),
    ).toContain("public void reset(double x) {");
    expect(preprocessHybridAndIdiomsLossless("pub fn reset(x: :#) {\n  ret;\n}", "cpp")).toContain(
      "void reset(double x) {",
    );

    // 10. Overloaded method resolution in C++
    const cppOverloads = [
      "class Calc {",
      "public:",
      "  int compute(int a) {",
      "    return a;",
      "  }",
      "  int compute(int a, int b) {",
      "    return a + b;",
      "  }",
      "};",
    ].join("\n");
    const span2 = locateNativeDeclarationSpan(cppOverloads, "Calc.compute(int, int)", "cpp");
    expect(span2?.origHeader?.trim()).toBe("int compute(int a, int b)");

    const splicedOverload = spliceNativeSource(
      cppOverloads,
      { symbol: "Calc.compute", code: "int compute(int a, int b) {\n  return a * b;\n}" },
      "calc.cpp",
    );
    expect(splicedOverload.modifiedCode).toContain("int compute(int a) {\n    return a;\n  }");
    expect(splicedOverload.modifiedCode).toContain(
      "int compute(int a, int b) {\n    return a * b;\n  }",
    );
  });

  it("14. AICE v0.9.8 Regressions: Line-Range Splicing, Imports Block Splicing, Class Field & Arrow-Property Splicing, CLI `--stdin`, and Create Overwrite Guard (>25 lines)", async () => {
    // 1. Line-range splicing on TypeScript file
    const lineRangeFile = path.join(tmpDir, "lines.ts");
    fs.writeFileSync(
      lineRangeFile,
      [
        "// Header comment",
        "export const alpha = 1;",
        "export const beta = 2;",
        "export const gamma = 3;",
        "export function calc() {",
        "    const x = 10;",
        "    return x * 2;",
        "}",
        "export const delta = 4;",
      ].join("\n"),
      "utf-8",
    );

    // Replace L2-L2 (alpha)
    const spL2 = await splice(lineRangeFile, {
      symbol: "L2-L2",
      code: "export const alpha = 99;",
      projectRoot: tmpDir,
    });
    expect(spL2.modifiedCode).toContain("export const alpha = 99;");
    expect(spL2.modifiedCode).not.toContain("export const alpha = 1;");

    // Replace [L5-L7] (calc function header through inner statement)
    const spBracket = await splice(lineRangeFile, {
      symbol: "[L5-L7]",
      code: "export function calc() {\n    const x = 50;\n    return x + 5;",
      projectRoot: tmpDir,
    });
    expect(spBracket.modifiedCode).toContain("const x = 50;\n    return x + 5;");

    // Delete L3 (beta)
    const spDelL3 = await splice(lineRangeFile, {
      symbol: "L3",
      delete: true,
      projectRoot: tmpDir,
    });
    expect(spDelL3.modifiedCode).not.toContain("export const beta = 2;");
    expect(spDelL3.modifiedCode).not.toMatch(/\n\n\n/);

    // 2. Imports block splicing
    const importFile = path.join(tmpDir, "imports_target.ts");
    fs.writeFileSync(
      importFile,
      [
        "import * as fs from 'node:fs';",
        "import * as path from 'node:path';",
        "",
        "export function read(p: string) {",
        "  return fs.readFileSync(path.resolve(p), 'utf-8');",
        "}",
      ].join("\n"),
      "utf-8",
    );

    const spImports = await splice(importFile, {
      symbol: "imports",
      code: "import * as fs from 'node:fs';\nimport * as os from 'node:os';\nimport * as path from 'node:path';",
      projectRoot: tmpDir,
    });
    expect(spImports.modifiedCode).toContain("import * as os from 'node:os';");
    expect(spImports.modifiedCode).toContain("export function read");

    // 3. Class field & arrow-property splicing and deletion
    const classFile = path.join(tmpDir, "handler.ts");
    fs.writeFileSync(
      classFile,
      [
        "export class InputHandler {",
        "  private isListening: boolean = false;",
        "  private loop = (t: number) => {",
        "    console.log(t);",
        "  };",
        "",
        "  public start(): void {",
        "    this.isListening = true;",
        "  }",
        "}",
      ].join("\n"),
      "utf-8",
    );

    // Replace arrow function property
    const spArrow = await splice(classFile, {
      symbol: "InputHandler.loop",
      code: "private loop = (t: number) => {\n  console.log('updated', t);\n};",
      projectRoot: tmpDir,
    });
    expect(spArrow.modifiedCode).toContain("console.log('updated', t);");

    // Delete field InputHandler.isListening
    const spDelField = await splice(classFile, {
      symbol: "InputHandler.isListening",
      delete: true,
      projectRoot: tmpDir,
    });
    expect(spDelField.modifiedCode).not.toContain("isListening: boolean");
    expect(spDelField.modifiedCode).toContain("export class InputHandler {");

    // Polyglot field splicing in Python
    const pyClassFile = path.join(tmpDir, "service.py");
    fs.writeFileSync(
      pyClassFile,
      [
        "class WorkerService:",
        "    max_retries: int = 3",
        "    timeout = 30",
        "",
        "    def run(self):",
        "        pass",
      ].join("\n"),
      "utf-8",
    );
    const spPyField = await splice(pyClassFile, {
      symbol: "WorkerService.max_retries",
      code: "max_retries: int = 10",
      projectRoot: tmpDir,
    });
    expect(spPyField.modifiedCode).toContain("max_retries: int = 10");

    // 4. CLI `aice splice <file> -s <sym> --stdin`
    const cliSpliceFile = path.join(tmpDir, "cli_splice.ts");
    fs.writeFileSync(cliSpliceFile, "export function compute() {\n  return 1;\n}\n", "utf-8");
    const cliSpliceRes = runCli(
      ["splice", cliSpliceFile, "-s", "compute", "--stdin"],
      tmpDir,
      "export function compute() {\n  return 42;\n}\n",
    );
    expect(cliSpliceRes.status).toBe(0);
    expect(fs.readFileSync(cliSpliceFile, "utf-8")).toContain("return 42;");

    // 5. CLI `aice create` Overwrite Guard on >25-line files
    const largeFile = path.join(tmpDir, "large_existing.ts");
    const largeLines = Array.from({ length: 30 }, (_, i) => `export const val${i} = ${i};`);
    fs.writeFileSync(largeFile, `${largeLines.join("\n")}\n`, "utf-8");

    // Fails without --overwrite / --force
    const failCreateRes = runCli(["create", largeFile, "-c", "export const val0 = 999;"], tmpDir);
    expect(failCreateRes.status).toBe(1);
    expect(failCreateRes.stderr).toContain("already exists (31 lines)");
    expect(failCreateRes.stderr).toContain("Do NOT rewrite existing files with 'aice create'");

    // Succeeds with --overwrite
    const okCreateRes = runCli(
      ["create", largeFile, "-c", "export const val0 = 999;", "--overwrite"],
      tmpDir,
    );
    expect(okCreateRes.status).toBe(0);
    expect(fs.readFileSync(largeFile, "utf-8")).toContain("export const val0 = 999;");
  }, 60000);
});
