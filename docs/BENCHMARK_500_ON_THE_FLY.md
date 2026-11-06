# AIL 2.0 Progressive 500-Case On-the-Fly Benchmark Report (`#001` -> `#500`)

## Executive Summary

- **Total Progressive Cases**: `500` (`#001` -> `#500`)
- **Strictly Increasing Complexity (`complexity[i] > complexity[i-1]`)**: `YES (500/500)`
- **AIL On-the-Fly Beats Without AIL at All**: `500/500` (`-98.48%` tokens)
- **AIL On-the-Fly Beats Without AIL On-the-Fly (Legacy Twin)**: `500/500` (`-98.28%` tokens)
- **Overall AIL On-the-Fly Win Rate**: **`500/500 (100%)`**
- **Total Tokens (Without AIL at All)**: `7,085,619`
- **Total Tokens (Without AIL On-the-Fly / Legacy Twin)**: `6,245,015`
- **Total Tokens (With AIL On-the-Fly)**: `107,532`

## Progressive Tier Breakdown (10 Tiers × 50 Cases)

| Progressive Tier | Cases | Wins | Complexity Range | Without AIL at All | Without AIL On-the-Fly | With AIL On-the-Fly | vs Without AIL | vs Without On-the-Fly |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Tier 01 (#001-#050): Single-Module Surgical Symbol & Rule/Key/Element Slicing | 50 | 50/50 | 50..565 | 68,634 | 63,299 | 5,919 | -91.38% | -90.65% |
| Tier 02 (#051-#100): Multi-Symbol Modules, Classes & Nested Config/Style Structures | 50 | 50/50 | 575..1090 | 169,189 | 151,387 | 7,088 | -95.81% | -95.32% |
| Tier 03 (#101-#150): Cross-Module Dependency Contract Resolution & Symbol Slicing | 50 | 50/50 | 1100..1615 | 284,954 | 255,268 | 8,054 | -97.17% | -96.84% |
| Tier 04 (#151-#200): Intra-Module Idiom Compression & Symbol-Scoped Context | 50 | 50/50 | 1625..2140 | 414,900 | 369,401 | 9,069 | -97.81% | -97.54% |
| Tier 05 (#201-#250): Multi-Module Idiom Mining & Cross-File Idiom Propagation | 50 | 50/50 | 2150..2665 | 565,651 | 497,977 | 10,343 | -98.17% | -97.92% |
| Tier 06 (#251-#300): Forgiving AI Input Normalization (self/this, elif, nil, $idiom) on Splice | 50 | 50/50 | 2675..3190 | 726,626 | 643,540 | 11,309 | -98.44% | -98.24% |
| Tier 07 (#301-#350): Deep Control-Flow & Guard Splices with Active Idiom Expansion | 50 | 50/50 | 3200..3715 | 904,158 | 797,615 | 12,219 | -98.65% | -98.47% |
| Tier 08 (#351-#400): Multi-Symbol & Multi-Rule Coordinated Surgical Refactoring | 50 | 50/50 | 3725..4240 | 1,105,825 | 966,319 | 13,598 | -98.77% | -98.59% |
| Tier 09 (#401-#450): Polyglot & Hybrid Subsystem Context + Surgical Native Mutation | 50 | 50/50 | 4250..4765 | 1,309,274 | 1,152,268 | 14,564 | -98.89% | -98.74% |
| Tier 10 (#451-#500): Enterprise-Scale Progressive Multi-Layer Twinless Architecture | 50 | 50/50 | 4775..5290 | 1,536,408 | 1,347,941 | 15,369 | -99% | -98.86% |

## Sample Progressive Trajectory (`#001`, `#050`, `#100`, ..., `#500`)

| Case ID | Lang | Complexity | Without AIL at All | Without AIL On-the-Fly | With AIL On-the-Fly | Savings vs Raw | Savings vs Legacy Twin | Win |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `B500-001` | `.ts` | `50` | 731 | 660 | 114 | -84.4% | -82.73% | PASS |
| `B500-025` | `.php` | `300` | 1567 | 1161 | 144 | -90.81% | -87.6% | PASS |
| `B500-050` | `.go` | `565` | 2324 | 2312 | 128 | -94.49% | -94.46% | PASS |
| `B500-075` | `.twig` | `825` | 3761 | 3631 | 154 | -95.91% | -95.76% | PASS |
| `B500-100` | `.php` | `1090` | 5268 | 3796 | 212 | -95.98% | -94.42% | PASS |
| `B500-125` | `.go` | `1350` | 5150 | 5070 | 144 | -97.2% | -97.16% | PASS |
| `B500-150` | `.twig` | `1615` | 7730 | 7453 | 206 | -97.34% | -97.24% | PASS |
| `B500-175` | `.php` | `1875` | 9169 | 6567 | 246 | -97.32% | -96.25% | PASS |
| `B500-200` | `.go` | `2140` | 9200 | 8984 | 176 | -98.09% | -98.04% | PASS |
| `B500-225` | `.twig` | `2400` | 11699 | 11275 | 232 | -98.02% | -97.94% | PASS |
| `B500-250` | `.php` | `2665` | 14970 | 10630 | 314 | -97.9% | -97.05% | PASS |
| `B500-275` | `.go` | `2925` | 13106 | 12762 | 192 | -98.54% | -98.5% | PASS |
| `B500-300` | `.twig` | `3190` | 16802 | 16189 | 284 | -98.31% | -98.25% | PASS |
| `B500-325` | `.php` | `3450` | 20371 | 14421 | 348 | -98.29% | -97.59% | PASS |
| `B500-350` | `.go` | `3715` | 18668 | 18104 | 224 | -98.8% | -98.76% | PASS |
| `B500-375` | `.twig` | `3975` | 21581 | 20791 | 310 | -98.56% | -98.51% | PASS |
| `B500-400` | `.php` | `4240` | 28272 | 19912 | 416 | -98.53% | -97.91% | PASS |
| `B500-425` | `.go` | `4500` | 23654 | 22902 | 240 | -98.99% | -98.95% | PASS |
| `B500-450` | `.twig` | `4765` | 27818 | 26797 | 362 | -98.7% | -98.65% | PASS |
| `B500-475` | `.php` | `5025` | 35173 | 24723 | 450 | -98.72% | -98.18% | PASS |
| `B500-500` | `.go` | `5290` | 30728 | 29672 | 272 | -99.11% | -99.08% | PASS |
