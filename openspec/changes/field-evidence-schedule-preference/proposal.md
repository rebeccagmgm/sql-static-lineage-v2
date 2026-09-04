## Why

Phase 2 `impactQuery()` correctly stops at `MULTI_WRITER_CANDIDATE_FRONTIER` without guessing writers. In practice, users inspect Horae schedule dependencies first. Frontier candidates need a **schedule recommendation** sort order without promoting Horae edges to CONFIRMED data lineage or changing `l1Eligible` / recursion rules.

## What Changes

- **FE-8** `schedule-preference.ts` — consume `horae-relation-up-depth-1.json` (or equivalent `scheduleEdges`) and annotate frontier candidates with `scheduleRelation` + `schedulePreferred`.
- **FE-8′** `impact-query.ts` — enrich `frontier[].candidates[]` at emission time; default sort puts `schedulePreferred` first; emit `SCHEDULE_PARENT_AMBIGUOUS` when multiple Horae parents match among candidates.
- **FE-8″** `FIELD_IMPACT_RESULT` 1.1.0 — additive frontier candidate fields; `l1Eligible` / CONFIRMED rules unchanged.
- **FE-8‴** Golden Case D extension + unit tests; `no-literal-anchors` covers new module.
- Doc: `execution-plan-field-evidence-v1.md` — «调度推荐 vs CONFIRMED 接续» subsection.

## Capabilities

### New Capabilities

- `field-evidence-schedule-preference`: Horae schedule recommendation on frontier candidates only; no INDEX / Phase 1 / TASK_LOCAL_PROJECTION changes.

### Modified Capabilities

（无。）

## Impact

- New `scripts/project-graph/field-evidence-v1/schedule-preference.ts`.
- Minimal diffs to `impact-query.ts`, `impact-result-contract.ts` (1.1.0), `impact-query-harness.ts`.
- Tests: `schedule-preference.test.ts`, Case D golden assertions, lint coverage.
- `npm run test:field-evidence` includes new tests.
- Horae schedule cache via `FIELD_EVIDENCE_SCHEDULE_CACHE_ROOT` or `DEFAULT_SCHEDULE_EVIDENCE_CACHE_ROOT`.

## Non-Goals

- No `l1Eligible` / `evidenceStatus` / default recursion changes.
- No TASK→TASK data edges in `TASK_LOCAL_PROJECTION`.
- No WP-8 partition matching fixes.
- No full-corpus projection run.
