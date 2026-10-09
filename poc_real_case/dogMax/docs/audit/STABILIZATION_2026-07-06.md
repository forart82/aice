# Stabilization Pass — 2026-07-06

This note records the status of the two repair-plan documents in this directory
so a future reader does not mistake them for a current validation of the
codebase.

`repair_plan_2026-07-06.gpt.md` and `repair_plan_2026-07-06.gemini.md` were
**historical inputs**, not live truth. Each was an independently-generated audit
of the game's state at the time it was written. Their findings were cross-checked
against the live source tree, and the confirmed items were folded into a single
stabilization plan that was executed in this session — the headless-launch crash
fix, config-value extraction, and the dead-code deletions (the automation / E2E
cluster, and the unwired Active Doge / `ActiveEvasion` helper together with its
`ACTIVE_EVASION_*` config keys), plus assorted DRY / fail-fast and naming fixes.

Treat both plans the way this project already treats other archived material
(e.g. `backup/archive/kanban-rebuild3-*.yaml`): **reference-only history, not an
authority on the current state.** Once the plan was executed the plans became a
record of what was decided and why — superseded by this session's git commit
history and by the reconciled `README.md` and `GameDesign.md`. For the true
current state of the game, read those two documents and the commit log, not these
plans.
