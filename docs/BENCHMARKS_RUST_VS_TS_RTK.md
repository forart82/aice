# Head-to-Head Benchmarks: Rust AICE vs Legacy TypeScript AICE vs `rtk`

> **100% Honest Live Measurements**: Every latency, memory, byte, and BPE token count below was measured live in isolated `/tmp` sandboxes (`AICE_CLI_INVOCATION_KEY=""`, isolated `HOME`/`XDG_*`/`AICE_HOME`) using external `bpe-openai 0.3.2` (`cl100k_base` & `o200k_base`) across **100% of emitted stdout** (including all framing headers, warnings, and hints). Negative token deltas are preserved verbatim without clamping.

## 1. Environment, Binaries & Methodology

- **Timestamp (UTC)**: `2026-11-26T06:32:42Z`
- **Machine / OS**: `Linux 7.0.0-44-generic (x86_64)` | CPU: `AMD Ryzen AI 7 350 w/ Radeon 860M` (`16` threads) | RAM: `30.6 GiB`
- **Toolchains**: `rustc 1.97.1 (8bab26f4f 2026-07-14)` | Node `v24.18.0` | Python `3.12.3`
- **Rust AICE**: `/home/forart/dev/aice/target/release/aice` (`0.9.53`, `102,681,928` B / `97.93` MiB)
- **Legacy TS AICE**: `node /home/forart/dev/aice/dist/aice.mjs` (`0.9.53`, `15,043,435` B / `14.35` MiB)
- **rtk**: `/home/forart/.local/bin/rtk` (`rtk 0.43.0`, `10,083,968` B / `9.62` MiB)
- **Corpus**: `tests/corpus/C-01..C-12` (`12` workloads, `44` files, `32/32` supported languages/DB dialects, `78,148` raw bytes, `19,613` `cl100k_base`, `19,775` `o200k_base`)
- **Iterations**: `warmup = 5`, `fast_iters = 50` (Tracks 1, 2, 3 single-file, 5 read), `heavy_iters = 30` (Tracks 3 & 4 per-workload/44-file sweeps, Track 5 batch splice), `rss_iters = 3` (`/usr/bin/time -f '%M'` separate pass)

## 2. Track 1 — Startup Latency & Footprint

| Command | Tool | Exit | Min (ms) | Median (ms) | Mean (ms) | P95 (ms) | Max (ms) | Peak RSS (KB / MiB) | Disk Size |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `--version` | Rust AICE | 0 | 0.740 | **1.252** | 1.308 | 1.761 | 2.027 | 4,252 / 4.15 | 97.93 MiB |
| `--version` | Legacy TS AICE | 0 | 185.874 | **201.453** | 203.224 | 223.906 | 239.638 | 141,044 / 137.74 | 14.35 MiB |
| `--version` | `rtk 0.43.0` | 0 | 0.831 | **1.842** | 1.782 | 2.329 | 2.427 | 4,012 / 3.92 | 9.62 MiB |
| `--help` | Rust AICE | 0 | 0.786 | **1.344** | 1.339 | 1.708 | 1.756 | 4,248 / 4.15 | 97.93 MiB |
| `--help` | Legacy TS AICE | 0 | 189.710 | **202.393** | 205.723 | 227.694 | 243.932 | 140,884 / 137.58 | 14.35 MiB |
| `--help` | `rtk 0.43.0` | 0 | 1.252 | **2.511** | 2.464 | 3.004 | 3.189 | 4,080 / 3.98 | 9.62 MiB |

### Representative Command Peak RSS (`/usr/bin/time -f '%M'`, median of 3)

| Operation | Rust AICE RSS | Legacy TS AICE RSS | `rtk 0.43.0` RSS |
|---|---:|---:|---:|
| `--version` | 4,252 KB (4.2 MiB) | 141,044 KB (137.7 MiB) | 4,012 KB (3.9 MiB) |
| `find` | 103,552 KB (101.1 MiB) | 410,872 KB (401.2 MiB) | 6,108 KB (6.0 MiB) |
| `search TokenBucket` | 107,532 KB (105.0 MiB) | 419,832 KB (410.0 MiB) | 7,404 KB (7.2 MiB) |
| `read C-01/api_client.ts` | 107,520 KB (105.0 MiB) | 414,060 KB (404.4 MiB) | 5,856 KB (5.7 MiB) |
| `read` 44-file sweep (`--full`) | 132,924 KB (129.8 MiB) | 430,636 KB (420.5 MiB) | 5,872 KB (5.7 MiB) |
| `splice --stdin --create` (3-target) | 106,748 KB (104.2 MiB) | 433,680 KB (423.5 MiB) | N/A |

## 3. Track 2 — Discovery & Search (`find`, `search`)

| Task | Tool & Command | Exit | Median (ms) | Mean (ms) | P95 (ms) | Stdout Bytes | `cl100k` | `o200k` | Notes |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| Project `find` | Rust `aice find` | 0 | 46.804 | 46.990 | 52.370 | 1,058 | 360 | 357 | All 44 files with line counts |
| Project `find` | TS `aice find` | 0 | 725.492 | 737.037 | 816.531 | 1,058 | 360 | 357 | All 44 files with line counts |
| Project `find` | `rtk find .` | 0 | 5.348 | 5.197 | 5.857 | 819 | 235 | 232 | Compact dir-grouped file list |
| Depth `find -d 1` | Rust `aice find -d 1` | 0 | 46.555 | 47.816 | 55.396 | 72 | 48 | 48 | Top-level corpus dirs |
| Depth `find -d 1` | TS `aice find -d 1` | 0 | 716.668 | 740.455 | 886.808 | 83 | 48 | 48 | Top-level corpus dirs |
| Filter `find --search api` | Rust `aice find --search api` | 0 | 46.196 | 47.399 | 56.590 | 49 | 20 | 20 | Matches `C-01/api_client.ts`, `C-11/api.graphql` |
| Filter `find --search api` | TS `aice find --search api` | 0 | 698.443 | 698.382 | 720.675 | 49 | 20 | 20 | Matches `C-01/api_client.ts`, `C-11/api.graphql` |
| Symbol search | Rust `aice search TokenBucket` | 0 | 48.067 | 49.350 | 57.040 | 117 | 35 | 35 | AST-enriched AICE IR declarations |
| Symbol search | TS `aice search TokenBucket` | 0 | 754.827 | 1286.501 | 2582.420 | 73 | 24 | 24 | Raw matched lines |
| Symbol search | `rtk rg TokenBucket .` | 0 | 11.472 | 11.519 | 13.437 | 83 | 29 | 29 | Raw `rg` matches (no AST) |
| Symbol search | `rtk grep -rn TokenBucket .` | 0 | 7.286 | 7.352 | 8.344 | 83 | 29 | 29 | Proxies `/usr/bin/grep -rn` |
| Context search `-C 2` | Rust `aice search TokenBucket -C 2` | 0 | 48.237 | 50.639 | 60.985 | 392 | 112 | 105 | Context lines around hits |
| Context search `-C 2` | TS `aice search TokenBucket -C 2` | 0 | 723.006 | 743.622 | 860.723 | 316 | 117 | 117 | Context lines around hits |

- **`rtk tree -L 2` live probe**: exited `1` (`rtk: tree command not found. Install it first:` because native `/usr/bin/tree` is not installed).
- **`rtk grep -n TokenBucket .` live probe**: exited `2` (`/usr/bin/grep: .: est un dossier` — requires explicit `-rn` for directory targets).

## 4. Track 3 — Lossless Semantic Read (`C-01..C-12`, 44 Files, 32 Languages)

### 4.1 Representative Single-File Cold CLI Reads

| Target | Tool / Mode | Exit | Median (ms) | P95 (ms) | Bytes | `cl100k` (Δ vs Raw) | `o200k` (Δ vs Raw) |
|---|---|---:|---:|---:|---:|---:|---:|
| `C-01/api_client.ts` (TypeScript (111L)) | Raw Disk | — | — | — | 3,933 | 1,011 | 1,021 |
| `C-01/api_client.ts` | Rust `aice read` | 0 | 47.364 | 58.268 | 3,497 | 911 (+9.89%) | 924 (+9.50%) |
| `C-01/api_client.ts` | TS `read` (default) | 0 | 730.042 | 843.894 | 3,933 | 1,011 (+0.00%) | 1,021 (+0.00%) |
| `C-01/api_client.ts` | TS `read --dsl` | 0 | 736.649 | 792.576 | 3,202 | 832 (+17.71%) | 845 (+17.24%) |
| `C-01/api_client.ts` | `rtk read` (`-l none`) | 0 | 4.283 | 5.186 | 3,933 | 1,011 (+0.00%) | 1,021 (+0.00%) |
| `C-01/api_client.ts` | `rtk read -l minimal` | 0 | 4.769 | 5.447 | 3,932 | 1,011 (+0.00%) | 1,021 (+0.00%) |
| `C-02/bucket.rs` (Rust (98L)) | Raw Disk | — | — | — | 2,805 | 682 | 675 |
| `C-02/bucket.rs` | Rust `aice read` | 0 | 46.369 | 56.126 | 2,240 | 636 (+6.74%) | 614 (+9.04%) |
| `C-02/bucket.rs` | TS `read` (default) | 0 | 735.950 | 817.205 | 2,805 | 682 (+0.00%) | 675 (+0.00%) |
| `C-02/bucket.rs` | TS `read --dsl` | 0 | 714.094 | 793.497 | 3,409 | 898 (-31.67%) | 891 (-32.00%) |
| `C-02/bucket.rs` | `rtk read` (`-l none`) | 0 | 4.711 | 5.674 | 2,805 | 682 (+0.00%) | 675 (+0.00%) |
| `C-02/bucket.rs` | `rtk read -l minimal` | 0 | 4.820 | 5.679 | 2,804 | 682 (+0.00%) | 675 (+0.00%) |
| `C-10/schema_ansi.sql` (ANSI SQL (56L)) | Raw Disk | — | — | — | 1,809 | 435 | 441 |
| `C-10/schema_ansi.sql` | Rust `aice read` | 0 | 48.301 | 60.367 | 2,090 | 604 (-38.85%) | 607 (-37.64%) |
| `C-10/schema_ansi.sql` | TS `read` (default) | 0 | 727.124 | 829.403 | 1,809 | 435 (+0.00%) | 441 (+0.00%) |
| `C-10/schema_ansi.sql` | TS `read --dsl` | 0 | 703.527 | 782.577 | 1,834 | 444 (-2.07%) | 450 (-2.04%) |
| `C-10/schema_ansi.sql` | `rtk read` (`-l none`) | 0 | 4.530 | 5.141 | 1,809 | 435 (+0.00%) | 441 (+0.00%) |
| `C-10/schema_ansi.sql` | `rtk read -l minimal` | 0 | 4.762 | 5.313 | 1,808 | 435 (+0.00%) | 441 (+0.00%) |
| `C-04/handler.go (default auto-outline)` (Go (127L > 120L)) | Raw Disk | — | — | — | 3,442 | 966 | 980 |
| `C-04/handler.go (default auto-outline)` | Rust `aice read` | 0 | 46.449 | 59.674 | 926 | 255 (+73.60%) | 256 (+73.88%) |
| `C-04/handler.go (default auto-outline)` | TS `read` (default) | 0 | 732.075 | 788.416 | 1,088 | 351 (+63.66%) | 353 (+63.98%) |
| `C-04/handler.go (default auto-outline)` | TS `read --dsl` | 0 | 738.513 | 796.650 | 1,088 | 351 (+63.66%) | 353 (+63.98%) |
| `C-04/handler.go (default auto-outline)` | `rtk read` (`-l none`) | 0 | 4.834 | 5.246 | 3,442 | 966 (+0.00%) | 980 (+0.00%) |
| `C-04/handler.go (default auto-outline)` | `rtk read -l minimal` | 0 | 4.869 | 5.310 | 3,441 | 966 (+0.00%) | 980 (+0.00%) |
| `C-04/handler.go (--full)` (Go (127L, forced full)) | Raw Disk | — | — | — | 3,442 | 966 | 980 |
| `C-04/handler.go (--full)` | Rust `aice read` | 0 | 49.275 | 60.236 | 3,358 | 912 (+5.59%) | 927 (+5.41%) |
| `C-04/handler.go (--full)` | TS `read` (default) | 0 | 708.476 | 739.104 | 3,467 | 978 (-1.24%) | 992 (-1.22%) |
| `C-04/handler.go (--full)` | TS `read --dsl` | 0 | 722.307 | 739.547 | 3,066 | 810 (+16.15%) | 818 (+16.53%) |
| `C-04/handler.go (--full)` | `rtk read` (`-l none`) | 0 | 4.320 | 5.226 | 3,442 | 966 (+0.00%) | 980 (+0.00%) |
| `C-04/handler.go (--full)` | `rtk read -l minimal` | 0 | 4.625 | 5.274 | 3,441 | 966 (+0.00%) | 980 (+0.00%) |

### 4.2 Per-Workload Multi-File Batch Reads (`C-01..C-12`, Full Lossless Modes)

> **Mode Clarification**: Rust `aice read --full` outputs full lossless AICE IR across all 32 languages. TS `read` (default) emits raw native source `<=120L` (auto-outlining `C-04/handler.go` 127L); TS `read --dsl --full` attempts AICE IR (falling back to line-numbered raw on unsupported Go expressions/types and raw SQL on `C-10`/`C-11`). `rtk read` (`-l none`) is 100% raw passthrough; `rtk read -l minimal` strips comments/trailing newline.

| Workload | Languages | Raw `cl100k` / `o200k` | Rust `--full` `cl100k` (Δ) / `o200k` (Δ) | Rust Med (ms) | TS Default `cl100k` (Δ) | TS `--dsl --full` `cl100k` (Δ) | TS Med (ms) | `rtk -l minimal` `cl100k` (Δ) | `rtk` Med (ms) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `C-01` | TypeScript, Tsx, JavaScript | 2,329 / 2,365 | **2,052 (+11.89%)** / 2,084 (+11.88%) | 50.8 | 1,662 (+28.64%) | 1,771 (+23.96%) | 743.8 | 2,329 (+0.00%) | 10.01 |
| `C-02` | Rust | 1,791 / 1,785 | **1,700 (+5.08%)** / 1,673 (+6.27%) | 49.7 | 1,827 (-2.01%) | 2,286 (-27.64%) | 717.8 | 1,791 (+0.00%) | 8.76 |
| `C-03` | Python | 1,679 / 1,692 | **1,675 (+0.24%)** / 1,684 (+0.47%) | 48.2 | 1,716 (-2.20%) | 2,051 (-22.16%) | 781.6 | 1,676 (+0.18%) | 8.29 |
| `C-04` | Go | 1,628 / 1,634 | **1,502 (+7.74%)** / 1,516 (+7.22%) | 50.2 | 1,036 (+36.36%) | 1,757 (-7.92%) | 821.1 | 1,628 (+0.00%) | 25.24 |
| `C-05` | CSharp, Java | 1,655 / 1,677 | **1,564 (+5.50%)** / 1,584 (+5.55%) | 112.3 | 1,098 (+33.66%) | 1,871 (-13.05%) | 735.2 | 1,655 (+0.00%) | 8.93 |
| `C-06` | C, Cpp | 1,488 / 1,500 | **1,485 (+0.20%)** / 1,492 (+0.53%) | 50.6 | 1,540 (-3.49%) | 1,341 (+9.88%) | 728.0 | 1,486 (+0.13%) | 10.12 |
| `C-07` | Kotlin, Dart | 1,495 / 1,515 | **1,306 (+12.64%)** / 1,324 (+12.61%) | 54.0 | 1,535 (-2.68%) | 1,799 (-20.33%) | 718.5 | 1,495 (+0.00%) | 8.89 |
| `C-08` | Php, Ruby, Twig | 1,662 / 1,677 | **1,424 (+14.32%)** / 1,434 (+14.49%) | 50.9 | 1,701 (-2.35%) | 1,532 (+7.82%) | 710.3 | 1,547 (+6.92%) | 9.07 |
| `C-09` | Bash, Json, Yaml | 1,379 / 1,382 | **1,496 (-8.48%)** / 1,497 (-8.32%) | 50.0 | 1,713 (-24.22%) | 1,705 (-23.64%) | 723.6 | 1,371 (+0.58%) | 8.87 |
| `C-10` | AnsiSql, DbMigration, PostgreSql | 1,456 / 1,474 | **2,017 (-38.53%)** / 2,030 (-37.72%) | 49.5 | 1,516 (-4.12%) | 1,500 (-3.02%) | 697.8 | 1,456 (+0.00%) | 9.39 |
| `C-11` | Cypher, GraphQl, MySql, Prisma, Sqlite, TSql | 1,439 / 1,462 | **2,129 (-47.95%)** / 2,147 (-46.85%) | 50.4 | 1,515 (-5.28%) | 1,491 (-3.61%) | 695.4 | 1,438 (+0.07%) | 14.20 |
| `C-12` | Css, Html, Markdown, Toml, Xml | 1,612 / 1,612 | **1,715 (-6.39%)** / 1,698 (-5.33%) | 49.8 | 1,671 (-3.66%) | 1,652 (-2.48%) | 709.2 | 1,609 (+0.19%) | 12.45 |

### 4.3 Combined 44-File Sweep (`C-01..C-12`, All 32 Languages)

| Tool / Mode | Exit | Min (ms) | Median (ms) | Mean (ms) | P95 (ms) | Max (ms) | Stdout Bytes | `cl100k` (Δ vs Raw) | `o200k` (Δ vs Raw) |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Raw Disk (44 files) | — | — | — | — | — | — | 78,148 | 19,613 | 19,775 |
| Rust `aice read --full` | 0 | 80.671 | **86.188** | 86.713 | 91.184 | 96.081 | 73,542 | 20,067 (-2.31%) | 20,159 (-1.94%) |
| TS `read` (default) | 0 | 812.433 | **837.946** | 841.580 | 878.972 | 888.819 | 80,416 | 20,471 (-4.37%) | 20,592 (-4.13%) |
| TS `read --dsl --full` | 0 | 855.345 | **892.119** | 895.495 | 924.515 | 1076.374 | 79,543 | 20,756 (-5.83%) | 20,864 (-5.51%) |
| `rtk read` (`-l none`) | 0 | 66.302 | **75.211** | 76.578 | 88.382 | 91.569 | 78,148 | 19,612 (+0.01%) | 19,775 (+0.00%) |
| `rtk read -l minimal` | 0 | 79.664 | **84.388** | 84.503 | 89.670 | 92.339 | 77,596 | 19,482 (+0.67%) | 19,643 (+0.67%) |

## 5. Track 4 — Outline & Summary Mode (`--outline` vs `rtk -l aggressive` / `rtk smart`)

| Workload | Raw `cl100k` | Rust `--outline` `cl100k` (Δ) | Rust Med (ms) | TS `--outline` `cl100k` (Δ) | TS Med (ms) | `rtk -l aggressive` `cl100k` (Δ) | `rtk smart` `cl100k` (Δ) |
|---|---:|---:|---:|---:|---:|---:|---:|
| `C-01` | 2,329 | **515 (+77.89%)** | 50.6 | 949 (+59.25%) | 740.7 | 618 (+73.47%) | 114 (+95.11%) |
| `C-02` | 1,791 | **565 (+68.45%)** | 49.8 | 227 (+87.33%) | 735.3 | 755 (+57.84%) | 77 (+95.70%) |
| `C-03` | 1,679 | **403 (+76.00%)** | 52.2 | 502 (+70.10%) | 723.9 | 300 (+82.13%) | 69 (+95.89%) |
| `C-04` | 1,628 | **540 (+66.83%)** | 49.1 | 449 (+72.42%) | 728.4 | 193 (+88.14%) | 69 (+95.76%) |
| `C-05` | 1,655 | **714 (+56.86%)** | 51.4 | 318 (+80.79%) | 719.4 | 545 (+67.07%) | 45 (+97.28%) |
| `C-06` | 1,488 | **575 (+61.36%)** | 49.3 | 911 (+38.78%) | 728.7 | 102 (+93.15%) | 46 (+96.91%) |
| `C-07` | 1,495 | **822 (+45.02%)** | 51.0 | 336 (+77.53%) | 717.1 | 525 (+64.88%) | 33 (+97.79%) |
| `C-08` | 1,662 | **451 (+72.86%)** | 47.8 | 336 (+79.78%) | 726.6 | 1,255 (+24.49%) | 33 (+98.01%) |
| `C-09` | 1,379 | **2,637 (-91.23%)** | 49.6 | 110 (+92.02%) | 708.8 | 1,377 (+0.15%) | 33 (+97.61%) |
| `C-10` | 1,456 | **507 (+65.18%)** | 48.5 | 638 (+56.18%) | 695.3 | 1,456 (+0.00%) | 44 (+96.98%) |
| `C-11` | 1,439 | **483 (+66.44%)** | 47.6 | 863 (+40.03%) | 705.7 | 1,438 (+0.07%) | 66 (+95.41%) |
| `C-12` | 1,612 | **2,270 (-40.82%)** | 49.7 | 537 (+66.69%) | 707.2 | 1,610 (+0.12%) | 55 (+96.59%) |

### 5.1 Combined 44-File Outline & Directory Outline (`C-01`)

| Mode / Scope | Median (ms) | P95 (ms) | Bytes | `cl100k` (Δ vs Raw) | `o200k` (Δ vs Raw) | Semantic Integrity |
|---|---:|---:|---:|---:|---:|---|
| Rust `aice read --outline` (44 files) | **78.715** | 86.402 | 35,439 | 10,482 (+46.56%) | 10,479 (+47.01%) | 32/32 languages AST-outlined |
| TS `read --outline` (44 files) | 806.374 | 840.153 | 14,837 | 4,564 (+76.73%) | 4,544 (+77.02%) | Fallback on unsupported SQL/Go |
| `rtk read -l aggressive` (44 files) | 82.944 | 105.497 | 40,231 | 10,175 (+48.12%) | 10,250 (+48.17%) | **10/44** empty-output raw fallbacks; **13/44** zero-reduction raw; drops OOP/C/Go bodies |
| `rtk smart <file>` (44 single-file calls) | — | — | 2,537 | 684 (+96.51%) | 683 (+96.55%) | **23/44** generic `Code code` / `Data code` 2-line stubs |
| Directory outline `C-01 --outline` (Rust) | **50.083** | 60.270 | 1,857 | 515 (+77.89%) | 512 | 4/4 C-01 files AST-outlined |
| Directory outline `C-01 --outline` (TS) | 715.543 | 741.796 | 2,984 | 949 (+59.25%) | 962 | TS directory outline |

- **`rtk read -l aggressive` empty-output raw fallbacks (10/44)**: `C-01/types.ts`, `C-05/ReconcileEngine.cs`, `C-07/SyncState.kt`, `C-08/CartController.php`, `C-08/invoice_summary.twig`, `C-09/release.sh`, `C-11/graph.cypher`, `C-11/schema.prisma`, `C-12/index.html`, `C-12/tokens.css`
- **`rtk read -l aggressive` zero-reduction raw passthroughs (13/44)**: `C-09/deploy.yaml`, `C-09/service_manifest.json`, `C-10/V001__init_ledger.sql`, `C-10/V002__settlement_views.sql`, `C-10/audit_triggers_pg.sql`, `C-10/schema_ansi.sql`, `C-11/api.graphql`, `C-11/mysql_ledger.sql`, `C-11/sqlite_cache.sql`, `C-11/tsql_sync.sql`, `C-12/architecture.md`, `C-12/pipeline.toml`, `C-12/plugin.xml`
- **`rtk smart` generic `Code code`/`Data code` stubs (23/44)**: `C-05/ReconcileEngine.cs`, `C-07/SyncState.kt`, `C-07/SyncViewModel.kt`, `C-07/form_controller.dart`, `C-08/CartController.php`, `C-08/invoice_summary.twig`, `C-09/deploy.yaml`, `C-09/service_manifest.json`, `C-10/V001__init_ledger.sql`, `C-10/V002__settlement_views.sql`, `C-10/audit_triggers_pg.sql`, `C-10/schema_ansi.sql`, `C-11/api.graphql`, `C-11/graph.cypher`, `C-11/mysql_ledger.sql`, `C-11/schema.prisma`, `C-11/sqlite_cache.sql`, `C-11/tsql_sync.sql`, `C-12/architecture.md`, `C-12/index.html`, `C-12/pipeline.toml`, `C-12/plugin.xml`, `C-12/tokens.css`

## 6. Track 5 — Multi-File Batch Read & Atomic Batch Write/Splice (AICE vs `rtk` N/A)

| Capability Benchmark | Rust Exit / Med (ms) / `cl100k` | TS Exit / Med (ms) / `cl100k` | `rtk 0.43.0` | Verified Behavior |
|---|---|---|:---:|---|
| Dependency ordering (api_client.ts types.ts --deps) | exit `0` / **61.70 ms** / `1181` tok | exit `0` / 726.26 ms / `1623` tok | N/A | `types.ts` before `api_client.ts`: `True` |
| Dependency ordering inside C-02 (bucket.rs error.rs --deps) | exit `0` / **48.48 ms** / `1000` tok | exit `0` / 718.20 ms / `1149` tok | N/A | `error.rs` before `bucket.rs` (crate-local): `True` |
| Water-filling --max-tokens 120 (C-02 3 files) | exit `0` / **49.55 ms** / `80` tok | exit `0` / 704.56 ms / `101` tok | N/A | Water-filling token budget enforcement |
| Water-filling --max-tokens 400 (C-02 3 files) | exit `0` / **50.29 ms** / `364` tok | exit `0` / 815.98 ms / `315` tok | N/A | Water-filling token budget enforcement |
| Intra-function AST slice (:TokenBucket.try_acquire@if) | exit `0` / **45.44 ms** / `101` tok | exit `0` / 794.19 ms / `133` tok | N/A | Rust slices exact `if` branch; TS dumps whole fn |
| Intra-function slice (:TokenBucket.try_acquire@first) | exit `0` / **45.04 ms** / `154` tok | exit `0` / 818.38 ms / `41` tok | N/A | Rust emits first method IR; TS emits 1 signature line |
| # symbol selector (C-01/api_client.ts#fetchOrders) | exit `0` / **45.80 ms** / `247` tok | exit `1` / 799.26 ms / `0` tok | N/A | Rust supports `#` selector; TS fails (`exit 1`) |
| Fuzzy symbol guessing (C-02/bucket.rs:try_acq) | exit `0` / **47.25 ms** / `172` tok | exit `0` / 851.70 ms / `268` tok | N/A | Rust auto-resolves AICE IR; TS falls back to warning + native |
| Fuzzy path guessing (C-02/buckt.rs) | exit `0` / **47.19 ms** / `660` tok | exit `1` / 681.17 ms / `0` tok | N/A | Rust auto-resolves path; TS fails (`exit 1`) |
| Atomic `splice --stdin --create` (3 targets across 3 files) | exit `0` / **49.98 ms** (p95 `56.39`) | exit `0` / 731.74 ms (p95 `782.53`) | N/A | Edit + create committed atomically |
| Pre-write SyntaxFirewall + atomic rollback (valid + broken TS) | exit `1` / **18.93 ms** / SHA-256 intact `True` | exit `1` / 742.00 ms / SHA-256 intact `True` | N/A | 0 bytes mutated on disk |

## 7. Honest Telemetry Cross-Check (`gains.jsonl` vs External `bpe-openai 0.3.2`)

| Probe | Op | Logged `n1` / `a1` (`cl100k`) | External `a1` | Logged `n2` / `a2` (`o200k`) | External `a2` | Exact Match |
|---|---|---:|---:|---:|---:|:---:|
| `find` | `context` | 339 / 360 | 360 | 337 / 357 | 357 | PASS |
| `search` | `context` | 28 / 35 | 35 | 28 / 35 | 35 | PASS |
| `read_c01_api` | `read` | 1,011 / 911 | 911 | 1,021 / 924 | 924 | PASS |
| `read_c04_outline` | `read` | 966 / 255 | 255 | 980 / 256 | 256 | PASS |
| `read_c01_full` | `context` | 2,329 / 2,052 | 2,052 | 2,365 / 2,084 | 2,084 | PASS |
| `read_c10_full` | `context` | 1,456 / 2,017 | 2,017 | 1,474 / 2,030 | 2,030 | PASS |

## 8. Architectural Capability Matrix (Rust AICE vs Legacy TS AICE vs `rtk 0.43.0`)

| Capability | Rust AICE (`0.9.53`) | Legacy TS AICE (`0.9.53`) | `rtk 0.43.0` |
|---|:---:|:---:|:---:|
| Zero-dependency native Linux binary | YES | NO (requires Node.js) | YES |
| Universal AICE IR on read (`<=120L` + `--full`) | YES (32/32 languages) | Opt-in `--dsl` (skips SQL, breaks Go/TSX) | NO |
| R6 DB & query AST + IR (`SQL`, `Prisma`, `GraphQL`, `Cypher`) | YES (9 dialects) | NO (raw passthrough) | NO |
| Intra-function AST slicing (`@if`, `@loop`, `@first`) | YES | Partial (`@first` 1L; `@if` falls back) | NO |
| `#` & `:` symbol selectors + fuzzy target guessing | YES (auto-resolves path & symbol) | Partial (`:` only; fuzzy path fails) | NO |
| Dependency-ordered multi-file context (`--deps`, `--callers`) | YES | YES | NO |
| Water-filling token budget (`--max-tokens`) | YES | YES | NO |
| Atomic multi-target `splice` + pre-write `SyntaxFirewall` + rollback | YES (32/32 languages) | Partial (no SQL/DB firewall) | NO |
| Ingress governance (`aice.config.json`, binary/root guard) | YES (unbypassable typestate) | YES | NO |
| 2-tool MCP stdio server (`aice_read`, `aice_splice`) | YES | YES | NO |
| Honest `bpe-openai` `cl100k`/`o200k` metering on full stdout | YES (0 drift) | NO (chars/4 + inflated `find` baseline) | NO (heuristic) |
| Shell command output filtering (`git`, `cargo`, `pytest`, `docker`) | NO (file/AST I/O specialist) | NO | YES |

## 9. Key Empirical Takeaways & Reproducibility

- **Startup & Memory**: Rust AICE starts in **1.25 ms** (`--version`, `4,252` KB RSS) vs Legacy TS AICE **201.45 ms** (`160.9x` faster startup, `141,044` KB RSS) and matches `rtk 0.43.0` (`1.84 ms`, `4,012` KB RSS).
- **44-File Full Semantic Sweep**: Rust `aice read --full` transforms all 32 languages in **86.19 ms** (`10.4x` faster than TS `read --dsl --full` at `892.12 ms`). On the 8 general-purpose code workloads (`C-01..C-08`), lossless AICE IR wins `8/8` (`13,727 -> 12,708` `cl100k`, `+7.42%`); on compact config/schema/DB workloads (`C-09..C-12`), structured AICE IR trades modest token expansion (`-2.31%` overall across all 44 files) for uniform AST/IR queryability and round-trip safety.
- **Outline Compression**: Rust `aice read --outline` compresses the 44-file corpus by **+46.56%** (`19,613 -> 10,482` `cl100k`) in **78.72 ms** across all 32 languages, whereas `rtk read -l aggressive` triggers empty-output raw fallbacks on `10/44` files and zero-reduction raw passthrough on `13/44` files while dropping method bodies on Java/C/Go/Kotlin, and `rtk smart` falls back to generic `Code code`/`Data code` stubs on `23/44` files.
- **Telemetry Honesty & Capabilities**: `6/6` `gains.jsonl` probes match external `bpe-openai 0.3.2` (`cl100k_base` & `o200k_base`) with `0` drift; Rust AICE uniquely provides `#` selectors, intra-function `@if` slicing, fuzzy path/symbol guessing, dependency-ordered reads, and atomic multi-file `splice` (`49.98 ms`) with SHA-256-verified rollback (`18.93 ms`).

### Reproduction Command

```bash
python3 tools/bench_vs_ts_rtk.py --warmup 5 --iters 30 --md-out docs/BENCHMARKS_RUST_VS_TS_RTK.md
```
