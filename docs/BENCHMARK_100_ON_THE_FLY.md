# AIL 2.0 On-the-Fly (Twinless + Smart Multi-File Idioms) — 100-Case Deep Benchmark Report

## Executive Summary

- **Total Cases & Situations Evaluated**: **100 / 100**
- **Semantic & Zero-Twin Pass Rate**: **100 / 100 (100.0%)**
- **AIL On-the-Fly Win Rate vs. Without AIL**: **100 / 100 (100.0%)**
- **Total Tokens WITHOUT AIL (Raw Native Baseline)**: **107,453 tokens**
- **Total Tokens WITH AIL On-the-Fly**: **34,115 tokens**
- **Total Net Tokens Saved**: **73,338 tokens (68.25% overall reduction, 74.50% mean per-case reduction)**
- **Disk Pollution (`.ail` Twin Files Created)**: **0 files (100% Twinless On-the-Fly)**

## Category Breakdown

| Category | Cases | AIL Wins | Without AIL (Tokens) | With AIL On-the-Fly (Tokens) | Net Saved | Reduction % |
| :--- | :---: | :---: | ---: | ---: | ---: | ---: |
| **1. On-the-Fly Structural Outline** | 10 | 10/10 | 3,118 | 861 | 2,257 | **-72.39%** |
| **2. On-the-Fly Context & Symbol Slicing** | 10 | 10/10 | 8,265 | 4,650 | 3,615 | **-43.74%** |
| **3. Direct-to-Native Splice (AIL & $idioms)** | 10 | 10/10 | 8,500 | 383 | 8,117 | **-95.49%** |
| **4. Forgiving Frankenstein & Raw Splice** | 10 | 10/10 | 7,514 | 412 | 7,102 | **-94.52%** |
| **5. Advanced TypeScript & OOP Edge Cases** | 10 | 10/10 | 8,500 | 289 | 8,211 | **-96.60%** |
| **6. Polyglot Direct-to-Native Splice** | 10 | 10/10 | 2,730 | 387 | 2,343 | **-85.82%** |
| **7. Smart Multi-File Idioms Discovery** | 10 | 10/10 | 3,752 | 1,477 | 2,275 | **-60.63%** |
| **8. Smart Multi-File Idiom Mutation & Safety** | 10 | 10/10 | 5,165 | 198 | 4,967 | **-96.17%** |
| **9. Polyglot On-the-Fly Decompile & Compression** | 10 | 10/10 | 8,996 | 7,066 | 1,930 | **-21.45%** |
| **10. Real-World E2E, MCP, LSP & Shield** | 10 | 10/10 | 50,913 | 18,392 | 32,521 | **-63.88%** |
| **TOTAL / OVERALL** | **100** | **100/100 (100.0%)** | **107,453** | **34,115** | **73,338** | **-68.25%** |

## Complete 100-Case Benchmark Table

| # | Category | Case / Situation | Lang | Without AIL (Tok) | With AIL (Tok) | Saved (Tok) | Savings % | 0 `.ail` Disk | Result |
| :---: | :--- | :--- | :---: | ---: | ---: | ---: | ---: | :---: | :---: |
| 001 | 1. On-the-Fly Structural Outline | TypeScript class/service structural outline (`ail outline service.ts`) | TS | 850 | 262 | 588 | -69.18% | Yes | PASS (AIL Better) |
| 002 | 1. On-the-Fly Structural Outline | React TSX component props & hook skeleton (`ail outline Card.tsx`) | TSX | 263 | 54 | 209 | -79.47% | Yes | PASS (AIL Better) |
| 003 | 1. On-the-Fly Structural Outline | Python module & class method signatures (`ail outline pipeline.py`) | Py | 357 | 107 | 250 | -70.03% | Yes | PASS (AIL Better) |
| 004 | 1. On-the-Fly Structural Outline | Go struct & pointer-receiver methods (`ail outline collector.go`) | Go | 226 | 85 | 141 | -62.39% | Yes | PASS (AIL Better) |
| 005 | 1. On-the-Fly Structural Outline | Rust struct & impl block signatures (`ail outline limiter.rs`) | Rust | 228 | 83 | 145 | -63.60% | Yes | PASS (AIL Better) |
| 006 | 1. On-the-Fly Structural Outline | C++ class & out-of-line method skeleton (`ail outline controller.cpp`) | C++ | 232 | 95 | 137 | -59.05% | Yes | PASS (AIL Better) |
| 007 | 1. On-the-Fly Structural Outline | C# namespace & class contract outline (`ail outline LedgerProcessor.cs`) | C# | 171 | 54 | 117 | -68.42% | Yes | PASS (AIL Better) |
| 008 | 1. On-the-Fly Structural Outline | Kotlin primary constructor & method outline (`ail outline SessionTracker.kt`) | Kotlin | 172 | 47 | 125 | -72.67% | Yes | PASS (AIL Better) |
| 009 | 1. On-the-Fly Structural Outline | PHP class & typed method signatures (`ail outline PaymentGateway.php`) | PHP | 176 | 42 | 134 | -76.14% | Yes | PASS (AIL Better) |
| 010 | 1. On-the-Fly Structural Outline | CSS3 design system selector outline (`ail outline design-system.css`) | CSS | 443 | 32 | 411 | -92.78% | Yes | PASS (AIL Better) |
| 011 | 2. On-the-Fly Context & Symbol Slicing | 1-hop native TS context + dependency outlines + callers (`ail context service.ts`) | TS | 1226 | 1111 | 115 | -9.38% | Yes | PASS (AIL Better) |
| 012 | 2. On-the-Fly Context & Symbol Slicing | 2-hop transitive native dependency graph (`ail context checkout-controller.ts -d 2`) | TS | 1226 | 742 | 484 | -39.48% | Yes | PASS (AIL Better) |
| 013 | 2. On-the-Fly Context & Symbol Slicing | Symbol-scoped TS method context (`ail context service.ts -s OrderOrchestrator.validateOrder`) | TS | 850 | 131 | 719 | -84.59% | Yes | PASS (AIL Better) |
| 014 | 2. On-the-Fly Context & Symbol Slicing | Symbol-scoped Python method context (`ail context pipeline.py -s FeatureAggregator.record_sample`) | Py | 357 | 106 | 251 | -70.31% | Yes | PASS (AIL Better) |
| 015 | 2. On-the-Fly Context & Symbol Slicing | Symbol-scoped Go receiver method context (`ail context collector.go -s CollectorService.RecordMetric`) | Go | 226 | 94 | 132 | -58.41% | Yes | PASS (AIL Better) |
| 016 | 2. On-the-Fly Context & Symbol Slicing | Symbol-scoped Rust impl method context (`ail context limiter.rs -s RateLimiter::try_acquire`) | Rust | 228 | 70 | 158 | -69.30% | Yes | PASS (AIL Better) |
| 017 | 2. On-the-Fly Context & Symbol Slicing | Outline-only target + 1-hop contracts (`ail context service.ts --outline-target`) | TS | 1226 | 656 | 570 | -46.49% | Yes | PASS (AIL Better) |
| 018 | 2. On-the-Fly Context & Symbol Slicing | Token-budgeted context packaging (`ail context service.ts --max-tokens 350`) | TS | 1226 | 288 | 938 | -76.51% | Yes | PASS (AIL Better) |
| 019 | 2. On-the-Fly Context & Symbol Slicing | On-the-fly context with active `$idioms` collapsed (`ail context service.ts --idioms`) | TS | 850 | 717 | 133 | -15.65% | Yes | PASS (AIL Better) |
| 020 | 2. On-the-Fly Context & Symbol Slicing | On-the-fly context with `--no-idioms` flag (`ail context service.ts --no-idioms`) | TS | 850 | 735 | 115 | -13.53% | Yes | PASS (AIL Better) |
| 021 | 3. Direct-to-Native Splice (AIL & $idioms) | Splice native TS method using `$guard_non_empty` statement idiom | TS | 850 | 40 | 810 | -95.29% | Yes | PASS (AIL Better) |
| 022 | 3. Direct-to-Native Splice (AIL & $idioms) | Splice native TS method using `$bump_stats` multi-statement block idiom | TS | 850 | 34 | 816 | -96.00% | Yes | PASS (AIL Better) |
| 023 | 3. Direct-to-Native Splice (AIL & $idioms) | Splice native TS method with `$clamp_metric` expression idiom in arithmetic | TS | 850 | 34 | 816 | -96.00% | Yes | PASS (AIL Better) |
| 024 | 3. Direct-to-Native Splice (AIL & $idioms) | Body-only `--body` splice preserving method signature and `@Decorators` | TS | 850 | 31 | 819 | -96.35% | Yes | PASS (AIL Better) |
| 025 | 3. Direct-to-Native Splice (AIL & $idioms) | Splice `async` method with `await` call and ternary return in AIL | TS | 850 | 53 | 797 | -93.76% | Yes | PASS (AIL Better) |
| 026 | 3. Direct-to-Native Splice (AIL & $idioms) | Splice `static` class method preserving `static` modifier in native TS | TS | 850 | 31 | 819 | -96.35% | Yes | PASS (AIL Better) |
| 027 | 3. Direct-to-Native Splice (AIL & $idioms) | Splice `private` class method (`prv fn`) in native TS | TS | 850 | 39 | 811 | -95.41% | Yes | PASS (AIL Better) |
| 028 | 3. Direct-to-Native Splice (AIL & $idioms) | Splice top-level `export function normalizeEndpoint` in native TS | TS | 850 | 20 | 830 | -97.65% | Yes | PASS (AIL Better) |
| 029 | 3. Direct-to-Native Splice (AIL & $idioms) | Surgical `--delete` removal of dead class method in native TS | TS | 850 | 17 | 833 | -98.00% | Yes | PASS (AIL Better) |
| 030 | 3. Direct-to-Native Splice (AIL & $idioms) | Multi-idiom composition (`$guard` + `$clamp` + `$bump`) in single method splice | TS | 850 | 84 | 766 | -90.12% | Yes | PASS (AIL Better) |
| 031 | 4. Forgiving Frankenstein & Raw Splice | Pure raw TypeScript method spliced directly into native `.ts` file | TS | 850 | 44 | 806 | -94.82% | Yes | PASS (AIL Better) |
| 032 | 4. Forgiving Frankenstein & Raw Splice | Frankenstein hybrid: TS signature & braces + AIL `:=`, `$idiom`, and `ret` | TS | 850 | 47 | 803 | -94.47% | Yes | PASS (AIL Better) |
| 033 | 4. Forgiving Frankenstein & Raw Splice | Frankenstein hybrid: AIL `pub fn` header + JS `const` & semicolons | TS | 850 | 25 | 825 | -97.06% | Yes | PASS (AIL Better) |
| 034 | 4. Forgiving Frankenstein & Raw Splice | Frankenstein hybrid: AIL `::=` binding + `$clamp_metric` + object literal | TS | 850 | 53 | 797 | -93.76% | Yes | PASS (AIL Better) |
| 035 | 4. Forgiving Frankenstein & Raw Splice | Frankenstein Python `def` header + AIL `:=`, `$clamp_unit_py`, and `ret` | Py | 357 | 68 | 289 | -80.95% | Yes | PASS (AIL Better) |
| 036 | 4. Forgiving Frankenstein & Raw Splice | Hybrid `--body` splice mixing JS `const`, `$clamp_metric`, `$bump_stats`, and `ret` | TS | 850 | 40 | 810 | -95.29% | Yes | PASS (AIL Better) |
| 037 | 4. Forgiving Frankenstein & Raw Splice | Cross-language `self.field` -> `this.field` auto-normalization when splicing TS | TS | 850 | 25 | 825 | -97.06% | Yes | PASS (AIL Better) |
| 038 | 4. Forgiving Frankenstein & Raw Splice | Cross-language `this.field` -> `self.field` auto-normalization when splicing Python | Py | 357 | 48 | 309 | -86.55% | Yes | PASS (AIL Better) |
| 039 | 4. Forgiving Frankenstein & Raw Splice | Stale AI Memory Grace: `$clamp_metric` still expands in `splice` when `idioms off` | TS | 850 | 31 | 819 | -96.35% | Yes | PASS (AIL Better) |
| 040 | 4. Forgiving Frankenstein & Raw Splice | Auto-reindentation of column-0 snippet to match enclosing class indentation | TS | 850 | 31 | 819 | -96.35% | Yes | PASS (AIL Better) |
| 041 | 5. Advanced TypeScript & OOP Edge Cases | Splice overloaded TS method while keeping overload signatures intact above | TS | 850 | 36 | 814 | -95.76% | Yes | PASS (AIL Better) |
| 042 | 5. Advanced TypeScript & OOP Edge Cases | Preserve stacked `@LogExecution` & `@AuthorizeRole` decorators when snippet omits them | TS | 850 | 33 | 817 | -96.12% | Yes | PASS (AIL Better) |
| 043 | 5. Advanced TypeScript & OOP Edge Cases | Replace existing `@Decorators` cleanly when snippet supplies new `@Decorator` | TS | 850 | 42 | 808 | -95.06% | Yes | PASS (AIL Better) |
| 044 | 5. Advanced TypeScript & OOP Edge Cases | Surgical splice of class `constructor` with `$bump_stats` idiom in native TS | TS | 850 | 29 | 821 | -96.59% | Yes | PASS (AIL Better) |
| 045 | 5. Advanced TypeScript & OOP Edge Cases | Disambiguate `set count` vs `get count` accessor when splicing native TS class | TS | 850 | 29 | 821 | -96.59% | Yes | PASS (AIL Better) |
| 046 | 5. Advanced TypeScript & OOP Edge Cases | Splice class arrow-function property (`summarizeBatch = (...) => ...`) in native TS | TS | 850 | 19 | 831 | -97.76% | Yes | PASS (AIL Better) |
| 047 | 5. Advanced TypeScript & OOP Edge Cases | Splice top-level `export const formatCurrency = (...) =>` in native TS | TS | 850 | 27 | 823 | -96.82% | Yes | PASS (AIL Better) |
| 048 | 5. Advanced TypeScript & OOP Edge Cases | Splice top-level `interface ServiceConfig` using AIL `pub type` in native TS | TS | 850 | 30 | 820 | -96.47% | Yes | PASS (AIL Better) |
| 049 | 5. Advanced TypeScript & OOP Edge Cases | Positional `--insert-after` and class `--append` in native TS without full rewrite | TS | 850 | 13 | 837 | -98.47% | Yes | PASS (AIL Better) |
| 050 | 5. Advanced TypeScript & OOP Edge Cases | 100% bit-identical byte preservation before & after spliced method in native TS | TS | 850 | 31 | 819 | -96.35% | Yes | PASS (AIL Better) |
| 051 | 6. Polyglot Direct-to-Native Splice | Python top-level function surgical splice with `$clamp_unit_py` idiom | Py | 357 | 43 | 314 | -87.96% | Yes | PASS (AIL Better) |
| 052 | 6. Polyglot Direct-to-Native Splice | Python `@staticmethod` class method splice in `FeatureAggregator` | Py | 357 | 20 | 337 | -94.40% | Yes | PASS (AIL Better) |
| 053 | 6. Polyglot Direct-to-Native Splice | Python `async def flush_metrics` surgical `--body` splice | Py | 357 | 26 | 331 | -92.72% | Yes | PASS (AIL Better) |
| 054 | 6. Polyglot Direct-to-Native Splice | Go top-level function `SanitizeMetricName` surgical splice in `.go` | Go | 226 | 22 | 204 | -90.27% | Yes | PASS (AIL Better) |
| 055 | 6. Polyglot Direct-to-Native Splice | Go pointer-receiver method `CollectorService.ResetCollector` spliced from AIL | Go | 226 | 33 | 193 | -85.40% | Yes | PASS (AIL Better) |
| 056 | 6. Polyglot Direct-to-Native Splice | Rust top-level `pub fn clamp_tokens` surgical splice from AIL | Rust | 228 | 48 | 180 | -78.95% | Yes | PASS (AIL Better) |
| 057 | 6. Polyglot Direct-to-Native Splice | Rust `impl RateLimiter` method `try_acquire` surgical splice from AIL | Rust | 228 | 41 | 187 | -82.02% | Yes | PASS (AIL Better) |
| 058 | 6. Polyglot Direct-to-Native Splice | C++ out-of-line `PidController::saturateOutput` method splice from AIL | C++ | 232 | 45 | 187 | -80.60% | Yes | PASS (AIL Better) |
| 059 | 6. Polyglot Direct-to-Native Splice | C# class method `LedgerProcessor.ResetLedger` surgical splice from AIL | C# | 171 | 37 | 134 | -78.36% | Yes | PASS (AIL Better) |
| 060 | 6. Polyglot Direct-to-Native Splice | Kotlin (`SessionTracker.clearSessions`) & PHP (`PaymentGateway.resetGateway`) splices | Kotlin/PHP | 348 | 72 | 276 | -79.31% | Yes | PASS (AIL Better) |
| 061 | 7. Smart Multi-File Idioms Discovery | Native-first `ail idioms scan` across 4 `.ts` files with zero `.ail` files on disk | TS | 546 | 345 | 201 | -36.81% | Yes | PASS (AIL Better) |
| 062 | 7. Smart Multi-File Idioms Discovery | Native-first `ail idioms scan` across 3 `.py` files with zero `.ail` files | Py | 177 | 96 | 81 | -45.76% | Yes | PASS (AIL Better) |
| 063 | 7. Smart Multi-File Idioms Discovery | Anti-unification extracts `$0`, `$1`, `$2` parameters across varying call-sites | TS | 546 | 19 | 527 | -96.52% | Yes | PASS (AIL Better) |
| 064 | 7. Smart Multi-File Idioms Discovery | Sliding statement window mines repeated 2-statement telemetry update block | TS | 546 | 16 | 530 | -97.07% | Yes | PASS (AIL Better) |
| 065 | 7. Smart Multi-File Idioms Discovery | Compound expression anti-unification mines nested `Math.max(..., Math.min(...))` | TS | 120 | 48 | 72 | -60.00% | Yes | PASS (AIL Better) |
| 066 | 7. Smart Multi-File Idioms Discovery | BPE token gate rejects trivial `a + 1` idioms that would bloat token count | TS | 51 | 45 | 6 | -11.76% | Yes | PASS (AIL Better) |
| 067 | 7. Smart Multi-File Idioms Discovery | SHA-256 provenance cache auto-invalidates & refreshes when human edits native file | TS | 546 | 275 | 271 | -49.63% | Yes | PASS (AIL Better) |
| 068 | 7. Smart Multi-File Idioms Discovery | Subdirectory `scan src/` resolves project root and stores relative paths cleanly | TS | 546 | 275 | 271 | -49.63% | Yes | PASS (AIL Better) |
| 069 | 7. Smart Multi-File Idioms Discovery | `ail idioms read` lists template, parameters, and every file:line occurrence | TS | 546 | 275 | 271 | -49.63% | Yes | PASS (AIL Better) |
| 070 | 7. Smart Multi-File Idioms Discovery | Instant `ail idioms off` / `ail idioms on` switch toggles `$idiom` collapsing in RAM | TS | 128 | 83 | 45 | -35.16% | Yes | PASS (AIL Better) |
| 071 | 8. Smart Multi-File Idiom Mutation & Safety | `ail idioms update` rewrites all occurrences across 4 native `.ts` files in one shot | TS | 546 | 23 | 523 | -95.79% | Yes | PASS (AIL Better) |
| 072 | 8. Smart Multi-File Idiom Mutation & Safety | `ail idioms update` propagates new template across 3 native Python `.py` files | Py | 81 | 15 | 66 | -81.48% | Yes | PASS (AIL Better) |
| 073 | 8. Smart Multi-File Idiom Mutation & Safety | `ail idioms update` with parameter reordering & `$0` duplication across files | TS | 546 | 16 | 530 | -97.07% | Yes | PASS (AIL Better) |
| 074 | 8. Smart Multi-File Idiom Mutation & Safety | `ail idioms update` with arity reduction (dropping unused `$0`, `$1` placeholders) | TS | 546 | 14 | 532 | -97.44% | Yes | PASS (AIL Better) |
| 075 | 8. Smart Multi-File Idiom Mutation & Safety | `ail idioms update` arity expansion (`$3=0.5`) backfilling existing 3-arg call sites | TS | 546 | 17 | 529 | -96.89% | Yes | PASS (AIL Better) |
| 076 | 8. Smart Multi-File Idiom Mutation & Safety | Capture-avoiding hygiene alpha-renames colliding template local `clamped` to `clamped_2` | TS | 108 | 22 | 86 | -79.63% | Yes | PASS (AIL Better) |
| 077 | 8. Smart Multi-File Idiom Mutation & Safety | Direct recursion cycle (`$a -> $a`) rejected immediately by `IdiomCycleError` | TS | 850 | 12 | 838 | -98.59% | Yes | PASS (AIL Better) |
| 078 | 8. Smart Multi-File Idiom Mutation & Safety | Mutual recursion cycle (`$mutual_a <-> $mutual_b`) rejected by `IdiomCycleError` | TS | 850 | 7 | 843 | -99.18% | Yes | PASS (AIL Better) |
| 079 | 8. Smart Multi-File Idiom Mutation & Safety | Atomic multi-file rollback restores all native files & config on mid-flight error | TS | 546 | 8 | 538 | -98.53% | Yes | PASS (AIL Better) |
| 080 | 8. Smart Multi-File Idiom Mutation & Safety | `spliceBatch` applies 4-file surgical update & atomically rolls back on failure | TS | 546 | 64 | 482 | -88.28% | Yes | PASS (AIL Better) |
| 081 | 9. Polyglot On-the-Fly Decompile & Compression | React TSX component on-the-fly decompile (`decompileToSource` in RAM) | TSX | 263 | 136 | 127 | -48.29% | Yes | PASS (AIL Better) |
| 082 | 9. Polyglot On-the-Fly Decompile & Compression | CSS3 design system on-the-fly decompile to `style <selector>:` blocks | CSS | 443 | 435 | 8 | -1.81% | Yes | PASS (AIL Better) |
| 083 | 9. Polyglot On-the-Fly Decompile & Compression | HTML5 document on-the-fly decompile (`examples/enterprise_portal.html`) | HTML | 7102 | 5883 | 1219 | -17.16% | Yes | PASS (AIL Better) |
| 084 | 9. Polyglot On-the-Fly Decompile & Compression | JSON & YAML configuration files on-the-fly structural outline | JSON/YAML | 339 | 6 | 333 | -98.23% | Yes | PASS (AIL Better) |
| 085 | 9. Polyglot On-the-Fly Decompile & Compression | Twig template (`examples/templates/card.twig`) on-the-fly structural outline | Twig | 175 | 4 | 171 | -97.71% | Yes | PASS (AIL Better) |
| 086 | 9. Polyglot On-the-Fly Decompile & Compression | TypeScript `switch`/`case` & `try`/`catch`/`finally` on-the-fly AIL decompile | TS | 92 | 86 | 6 | -6.52% | Yes | PASS (AIL Better) |
| 087 | 9. Polyglot On-the-Fly Decompile & Compression | Python list comprehension & `try`/`except` on-the-fly AIL decompile | Py | 84 | 79 | 5 | -5.95% | Yes | PASS (AIL Better) |
| 088 | 9. Polyglot On-the-Fly Decompile & Compression | Go `struct` & `if err != nil` error handling on-the-fly AIL decompile | Go | 226 | 207 | 19 | -8.41% | Yes | PASS (AIL Better) |
| 089 | 9. Polyglot On-the-Fly Decompile & Compression | Rust `struct` & `impl` methods on-the-fly AIL decompile | Rust | 228 | 189 | 39 | -17.11% | Yes | PASS (AIL Better) |
| 090 | 9. Polyglot On-the-Fly Decompile & Compression | Tiny `< 15` line native `.ts` function decompiles with positive token savings | TS | 44 | 41 | 3 | -6.82% | Yes | PASS (AIL Better) |
| 091 | 10. Real-World E2E, MCP, LSP & Shield | Real-World `poc_real_case/snake_ts` 4-module on-the-fly structural outline | TS | 17702 | 9323 | 8379 | -47.33% | Yes | PASS (AIL Better) |
| 092 | 10. Real-World E2E, MCP, LSP & Shield | Real-World `snake_ts` Twinless idiom scan + 1-hop context on `Vec2.ts` | TS | 9461 | 5551 | 3910 | -41.33% | Yes | PASS (AIL Better) |
| 093 | 10. Real-World E2E, MCP, LSP & Shield | Real-World `snake_ts/src/core/Vec2.ts` surgical native method splice (`Vec2.set`) | TS | 4383 | 30 | 4353 | -99.32% | Yes | PASS (AIL Better) |
| 094 | 10. Real-World E2E, MCP, LSP & Shield | Real-World `poc_real_case/dogMax/src/app/GameSession.cpp` C++20 on-the-fly outline | C++ | 7957 | 498 | 7459 | -93.74% | Yes | PASS (AIL Better) |
| 095 | 10. Real-World E2E, MCP, LSP & Shield | Real-World `poc_real_case/snake_pp/source/Game.cpp` C++20 on-the-fly outline | C++ | 781 | 80 | 701 | -89.76% | Yes | PASS (AIL Better) |
| 096 | 10. Real-World E2E, MCP, LSP & Shield | Twinless Shield (`applyShield({ twinless: true })` + `interceptPreToolUse` on `.ts`) | TS | 850 | 45 | 805 | -94.71% | Yes | PASS (AIL Better) |
| 097 | 10. Real-World E2E, MCP, LSP & Shield | MCP Server (`ail_outline`, `ail_context -s`, `ail_idioms`, `ail_splice`) on native `.ts` | TS | 2550 | 986 | 1564 | -61.33% | Yes | PASS (AIL Better) |
| 098 | 10. Real-World E2E, MCP, LSP & Shield | LSP `AilAnalyzer` zero-diagnostic `$idiom` validation, hover card & completion | TS | 850 | 29 | 821 | -96.59% | Yes | PASS (AIL Better) |
| 099 | 10. Real-World E2E, MCP, LSP & Shield | 5-Turn Autonomous Agent Session (Outline -> Context -> Idiom Read/Update -> Splice) | Multi | 5544 | 1710 | 3834 | -69.16% | Yes | PASS (AIL Better) |
| 100 | 10. Real-World E2E, MCP, LSP & Shield | 10-File Polyglot (5 TS + 5 Python) Idiom Scan + Atomic `spliceBatch` Stress Test | Multi | 835 | 140 | 695 | -83.23% | Yes | PASS (AIL Better) |
