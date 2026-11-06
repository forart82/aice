# AIL 2.0 Progressive 500-Case On-the-Fly Benchmark Report (`#001` -> `#500`)

## Executive Summary

- **Total Progressive Cases**: `500` (`#001` -> `#500`)
- **Strictly Increasing Complexity (`complexity[i] > complexity[i-1]`)**: `YES (500/500)`
- **AIL On-the-Fly Beats Without AIL at All**: `500/500` (`-97.63%` tokens)
- **AIL On-the-Fly Beats Without AIL On-the-Fly (Legacy Twin)**: `500/500` (`-97.25%` tokens)
- **Overall AIL On-the-Fly Win Rate**: **`500/500 (100%)`**
- **Total Tokens (Without AIL at All)**: `4 592 533`
- **Total Tokens (Without AIL On-the-Fly / Legacy Twin)**: `3 969 306`
- **Total Tokens (With AIL On-the-Fly)**: `108 994`

## Progressive Tier Breakdown (10 Tiers × 50 Cases)

| Progressive Tier | Cases | Wins | Complexity Range | Without AIL at All | Without AIL On-the-Fly | With AIL On-the-Fly | vs Without AIL | vs Without On-the-Fly |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| Tier 01 (#001-#050): Single-Module Surgical Symbol & Rule/Key/Element Slicing | 50 | 50/50 | 140..5065 | 40 438 | 37 269 | 6 061 | -85.01% | -83.74% |
| Tier 02 (#051-#100): Multi-Symbol Modules, Classes & Nested Config/Style Structures | 50 | 50/50 | 5185..10110 | 89 220 | 78 570 | 7 230 | -91.9% | -90.8% |
| Tier 03 (#101-#150): Cross-Module Dependency Contract Resolution & Symbol Slicing | 50 | 50/50 | 10230..15155 | 151 785 | 133 305 | 8 210 | -94.59% | -93.84% |
| Tier 04 (#151-#200): Intra-Module Idiom Compression & Symbol-Scoped Context | 50 | 50/50 | 15275..20200 | 235 279 | 205 314 | 9 211 | -96.09% | -95.51% |
| Tier 05 (#201-#250): Multi-Module Idiom Mining & Cross-File Idiom Propagation | 50 | 50/50 | 20320..25245 | 336 576 | 289 776 | 10 485 | -96.88% | -96.38% |
| Tier 06 (#251-#300): Forgiving AI Input Normalization (self/this, elif, nil, $idiom) on Splice | 50 | 50/50 | 25365..30290 | 445 293 | 386 073 | 11 465 | -97.43% | -97.03% |
| Tier 07 (#301-#350): Deep Control-Flow & Guard Splices with Active Idiom Expansion | 50 | 50/50 | 30410..35335 | 582 976 | 504 390 | 12 361 | -97.88% | -97.55% |
| Tier 08 (#351-#400): Multi-Symbol & Multi-Rule Coordinated Surgical Refactoring | 50 | 50/50 | 35455..40380 | 737 571 | 631 671 | 13 740 | -98.14% | -97.82% |
| Tier 09 (#401-#450): Polyglot & Hybrid Subsystem Context + Surgical Native Mutation | 50 | 50/50 | 40500..45425 | 889 866 | 768 441 | 14 720 | -98.35% | -98.08% |
| Tier 10 (#451-#500): Enterprise-Scale Progressive Multi-Layer Twinless Architecture | 50 | 50/50 | 45545..50470 | 1 083 529 | 934 497 | 15 511 | -98.57% | -98.34% |

## Sample Progressive Trajectory (`#001`, `#050`, `#100`, ..., `#500`)

| Case ID | Lang | Complexity | Without AIL at All | Without AIL On-the-Fly | With AIL On-the-Fly | Savings vs Raw | Savings vs Legacy Twin | Win |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `B500-001` | `.ts` | `140` | 710 | 636 | 116 | -83.66% | -81.76% | PASS |
| `B500-025` | `.php` | `2550` | 1064 | 780 | 146 | -86.28% | -81.28% | PASS |
| `B500-050` | `.go` | `5065` | 1368 | 1356 | 130 | -90.5% | -90.41% | PASS |
| `B500-075` | `.twig` | `7595` | 1599 | 1526 | 163 | -89.81% | -89.32% | PASS |
| `B500-100` | `.php` | `10110` | 3319 | 2322 | 214 | -93.55% | -90.78% | PASS |
| `B500-125` | `.go` | `12640` | 2899 | 2819 | 146 | -94.96% | -94.82% | PASS |
| `B500-150` | `.twig` | `15155` | 3436 | 3265 | 215 | -93.74% | -93.42% | PASS |
| `B500-175` | `.php` | `17685` | 5897 | 4095 | 248 | -95.79% | -93.94% | PASS |
| `B500-200` | `.go` | `20200` | 5613 | 5397 | 178 | -96.83% | -96.7% | PASS |
| `B500-225` | `.twig` | `22730` | 5484 | 5216 | 241 | -95.61% | -95.38% | PASS |
| `B500-250` | `.php` | `25245` | 10312 | 7110 | 316 | -96.94% | -95.56% | PASS |
| `B500-275` | `.go` | `27775` | 8338 | 7994 | 194 | -97.67% | -97.57% | PASS |
| `B500-300` | `.twig` | `30290` | 8545 | 8134 | 293 | -96.57% | -96.4% | PASS |
| `B500-325` | `.php` | `32820` | 14510 | 9993 | 350 | -97.59% | -96.5% | PASS |
| `B500-350` | `.go` | `35335` | 12621 | 12057 | 226 | -98.21% | -98.13% | PASS |
| `B500-375` | `.twig` | `37865` | 11583 | 11039 | 319 | -97.25% | -97.11% | PASS |
| `B500-400` | `.php` | `40380` | 21085 | 14481 | 418 | -98.02% | -97.11% | PASS |
| `B500-425` | `.go` | `42910` | 16540 | 15788 | 242 | -98.54% | -98.47% | PASS |
| `B500-450` | `.twig` | `45425` | 15868 | 15136 | 371 | -97.66% | -97.55% | PASS |
| `B500-475` | `.php` | `47955` | 26903 | 18474 | 452 | -98.32% | -97.55% | PASS |
| `B500-500` | `.go` | `50470` | 22392 | 21336 | 274 | -98.78% | -98.72% | PASS |
