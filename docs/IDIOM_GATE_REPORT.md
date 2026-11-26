# R7 Empirical Idiom Layer Gate Report (`C-01..C-12`)

## 1. Evaluation Metadata

- **Evaluation Engine**: `aice` Rust binary (`v0.9.53`) + `aice_telemetry::bpe::count_both` (`bpe-openai 0.3.2`, `cl100k_base` & `o200k_base`)
- **Corpus Path**: `tests/corpus/C-01..C-12` (`12` multi-file production workloads, `32/32` supported `LanguageId`s: `23` R5 incl. Twig + `9` R6 DB/query dialects)
- **Measurement Rule**: Full emitted stdout on `aice read <files...> --full --no-idioms` vs `aice read <files...> --full --idioms` in isolated `TempWorkspace` copies (no auto-outline, no truncation), charging 100% of emitted framing headers and `// @idiom $iN(...)=...` legend tokens to `with_idioms_*`.
- **Keep Gate Threshold**: Keep `crates/aice-idioms` ONLY IF `>= 10/12` (`>= 80%`) workloads achieve `> 1.0%` net BPE reduction on BOTH `cl100k_base` and `o200k_base` on full emitted stdout AND `12/12` paired write/splice/rollback stress tests pass AND `<= 300L` per `.rs` file with `0` warnings.

**VERDICT: KILL**

---

## 2. Primary Empirical Benchmark Table (`C-01..C-12`)

| `workload_id` | `languages` | `raw_bytes` | `raw_cl100k` | `raw_o200k` | `without_idioms_cl100k` | `without_idioms_o200k` | `with_idioms_cl100k` | `with_idioms_o200k` | `legend_tokens` | `net_delta_cl100k_pct` | `net_delta_o200k_pct` | `write_splice_pass` |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| `C-01` | `TypeScript, Tsx, JavaScript` | 9278 | 2329 | 2365 | 2038 | 2070 | 1961 | 1986 | 128 | +3.78% | +4.06% | PASS |
| `C-02` | `Rust` | 7157 | 1791 | 1785 | 1689 | 1662 | 1679 | 1656 | 57 | +0.59% | +0.36% | PASS |
| `C-03` | `Python` | 7034 | 1679 | 1692 | 1663 | 1673 | 1663 | 1673 | 0 | +0.00% | +0.00% | PASS |
| `C-04` | `Go` | 5928 | 1628 | 1634 | 1491 | 1505 | 1445 | 1456 | 127 | +3.09% | +3.26% | PASS |
| `C-05` | `Java, CSharp` | 8053 | 1655 | 1677 | 1552 | 1573 | 1468 | 1476 | 186 | +5.41% | +6.17% | PASS |
| `C-06` | `C, Cpp` | 5165 | 1488 | 1500 | 1469 | 1476 | 1434 | 1436 | 147 | +2.38% | +2.71% | PASS |
| `C-07` | `Kotlin, Dart` | 6564 | 1495 | 1515 | 1295 | 1313 | 1295 | 1313 | 0 | +0.00% | +0.00% | PASS |
| `C-08` | `Php, Twig, Ruby` | 6589 | 1662 | 1677 | 1412 | 1422 | 1412 | 1422 | 0 | +0.00% | +0.00% | PASS |
| `C-09` | `Bash, Yaml, Json` | 4942 | 1379 | 1382 | 1486 | 1486 | 1472 | 1472 | 89 | +0.94% | +0.94% | PASS |
| `C-10` | `AnsiSql, PostgreSql, DbMigration` | 6172 | 1456 | 1474 | 2004 | 2017 | 2004 | 2017 | 0 | +0.00% | +0.00% | PASS |
| `C-11` | `MySql, Sqlite, TSql, Prisma, GraphQl, Cypher` | 5565 | 1439 | 1462 | 2110 | 2126 | 2060 | 2076 | 55 | +2.37% | +2.35% | PASS |
| `C-12` | `Html, Css, Markdown, Xml, Toml` | 5701 | 1612 | 1612 | 1697 | 1680 | 1694 | 1677 | 72 | +0.18% | +0.18% | PASS |
| `TOTAL` | `32 langs` | 78148 | 19613 | 19775 | 19906 | 20003 | 19587 | 19660 | 861 | +1.60% | +1.71% | 12/12 PASS |

*Supplementary `legend_o200k` counts*: `C-01=128, C-02=54, C-04=129, C-05=193, C-06=146, C-09=89, C-11=54, C-12=72` (total `865`).
Because R3 AICE IR already strips syntactic verbosity across all 32 languages, realistic 212–293 line workloads only clear the emitted `// @idiom` legend overhead by `> 1.0%` in `5/12` (`41.7%`) cases (`C-01`, `C-04`, `C-05`, `C-06`, `C-11`).

---

## 3. Keep / Kill Rule Check

- **Criterion 1** (`cl100k_base` > 1.0% net reduction in `>= 10/12` & `>= 8/10` workloads): `5/12` (`41.7%`) -> **FAIL**
- **Criterion 2** (`o200k_base` > 1.0% net reduction in `>= 10/12` & `>= 8/10` workloads): `5/12` (`41.7%`) -> **FAIL**
- **Criterion 3** (`write_splice_pass` = `PASS` for `12/12` paired round-trip & atomic rollback stress tests): `12/12` -> **PASS**
- **Criterion 4** (`modularity_gate` `<= 300L` & `0` `-D warnings`): **PASS**
- **Rule Evaluation**: `KEEP` requires Criteria 1–4 ALL `PASS`; Criteria 1 and 2 failed (`5/12 < 10/12`). Therefore **VERDICT: KILL** was triggered and executed at 100%.

---

## 4. Write/Splice Round-Trip Stress Suite Summary

| `workload_id` | Paired Modality | Target(s) | Exit Code | Post-Write `SyntaxFirewall` | Disk / Tmp Cleanliness | Result |
|---|---|---|---:|---|---|---|
| `C-01` | `:Sym` + `<<< === >>>` hunk + Atomic Rollback | `api_client.ts:fetchOrders`, `validators.js:validateOrder`, rollback batch | 0 / 0 / 1 | Valid (`TypeScript`, `JavaScript`) | 0 `.aice.tmp*`/`.bak`, 0 rollback mutations | PASS |
| `C-02` | `:Sym` (+ `$idiom` Phase A) + `<<< === >>>` hunk | `bucket.rs:TokenBucket.try_acquire`, `wal_record.rs:WalFrame.encode` | 0 / 0 | Valid (`Rust`) | Clean | PASS |
| `C-03` | Multi-file heredoc `=== path:Sym ===` | `models.py:JobPayload`, `dispatcher.py:dispatch_batch` | 0 | Valid (`Python`) | Clean | PASS |
| `C-04` | Multi-file heredoc `=== path:Sym ===` | `types.go:SettlementRequest`, `handler.go:HandleSettlement` | 0 | Valid (`Go`) | Clean | PASS |
| `C-05` | `:Sym` + Javadoc preservation | `SettlementService.java:SettlementService.settle` | 0 | Valid (`Java`) | Clean | PASS |
| `C-06` | JSON `--batch` | `ring_buffer.c:rb_push`, `physics_grid.cpp:Grid.step` | 0 | Valid (`C`, `Cpp`) | Clean | PASS |
| `C-07` | JSON `--edits` | `SyncViewModel.kt:SyncViewModel.pendingCount`, `form_controller.dart:FormController.completeSubmit` | 0 | Valid (`Kotlin`, `Dart`) | Clean | PASS |
| `C-08` | `:Sym` + PHPDoc preservation + `:L` splice & overlap guard | `CartController.php:CartController.calculateTotal`, `invoice_summary.twig:L3-L8` | 0 / 0 / 1 | Valid (`Php`, `Twig`) | Clean | PASS |
| `C-09` | Contextual Hunk `<<< === >>>` | `release.sh:deploy_service` | 0 | Valid (`Bash`) | Clean | PASS |
| `C-10` | Multi-file heredoc `=== path:Sym ===` | `schema_ansi.sql:accounts`, `audit_triggers_pg.sql:audit_balance_change` | 0 | Valid (`AnsiSql`, `PostgreSql`) | Clean | PASS |
| `C-11` | JSON `--batch` | `schema.prisma:Invoice`, `api.graphql:Query` | 0 | Valid (`Prisma`, `GraphQl`) | Clean | PASS |
| `C-12` | `:L` range splice + overlap rejection | `tokens.css:L5-L8`, `pipeline.toml:L3-L5` | 0 / 0 / 1 | Valid (`Css`, `Toml`) | Clean | PASS |

---

## 5. 100% KILL Cleanup Verification

1. **Crate & Manifest Removal**: Deleted `crates/aice-idioms/` (`Cargo.toml` and `src/*.rs`), removed `aice-idioms` from root `Cargo.toml` and `crates/{aice-batch-read,aice-batch-write,aice-pipeline}/Cargo.toml`.
2. **Dead Flag & Field Removal**: Removed `ReadOp.idioms`, `idioms_enabled`/`idioms`/`set_project_idioms_enabled`/`idiomsEnabled`/`idiomsCount`/`activeIdiomsCount`/`idiomsUsed` across `aice-governance`, `aice-telemetry`, `aice-batch-read`, `aice-batch-write`, `aice-pipeline`, and `aice-cli` (including `--idioms`, `--no-idioms`, `--idiom`, `--idioms-on`, `--idioms-off`, and MCP schema `idioms`/`inlineIdioms`), leaving `rg -n -i "idiom" Cargo.toml crates/*/src` at `0` matches.
3. **Config Backward-Compatibility (`extra_fields`)**: Preserved unknown-field tolerance in `aice-governance/src/{config_discovery.rs,config.rs}` so legacy `"idiomsEnabled"` and `"idioms"` keys (including malformed entries) in `aice.config.json` load without error and are preserved verbatim across `status`, `disable`, and `enable`.
4. **Gate & Test Updates**: Updated `tests/integration/modularity_gate.rs` (`11 -> 10` crates), `crates/aice-governance/tests/config_parity.rs`, `crates/aice-batch-write/tests/batch_write_specs.rs` (`14 -> 13` JSON keys), `crates/aice-pipeline/tests/seal_enforcement.rs`, `crates/aice-find-engine/tests/walker_security_and_parity.rs`, `tests/integration/w2_m4_pipeline_cli.rs` (`GOV-01`, `GOV-03` retired flag rejection, `GOV-06` `extra_fields`), and added `tests/integration/w4_m4_r7_idiom_gate.rs` (zero `aice_idioms` imports).
