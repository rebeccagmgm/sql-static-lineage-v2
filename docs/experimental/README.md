# Experimental / paused work

Code under `scripts/reconcile/consumer/target-table-upstream-causal-closure/` remains
for regression and optional CLI use. It is **not** the current product mainline.

## WP-10 `closure-on-union` (paused 2026-09-03)

- **Status**: paused; do not extend for L1-count KPIs or legacy-closure diff gates.
- **OpenSpec archive**:
  `openspec/changes/archive/2026-09-03-closure-on-union-paused/`
- **Execution plan (historical)**:
  `docs/experimental/execution-plan-closure-on-union.md`
  （旧路径 `docs/execution-plan-closure-on-union.md` 为重定向桩）
- **Still useful**: union-v2 attachment + `UNION_CONTINUATION_INDEX` adapter as a
  library; **case-first continuation** should use a thin WP-8 slice only.

## Current mainline (2026-09-03)

金样调查页: four DM_RSK_N anchors, one union batch; **primary deliverable** is consumable JSON (`batch-manifest`, per-task projections, `union-continuation-index.json`, `gold-case-gaps.jsonl`). HTML optional.
