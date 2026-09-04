## Context

`field-evidence-v1-impact-query` (Phase 2) ships `FIELD_IMPACT_RESULT` with honest CANDIDATE frontiers. Multi-writer reads stay at `MULTI_WRITER_CANDIDATE_FRONTIER` by default. Horae depth-1 upstream is already cached at `schedule-evidence/tasks/<taskId>/horae-relation-up-depth-1.json` and mirrored as `scheduleEdges` on multi-hop artifacts — the same source used by union-v2 whitelist logic (`createUnionV2ScheduleRelationLookup`).

## Goals / Non-Goals

**Goals:** Frontier candidate schedule annotation; stable sort with preferred parent first; `SCHEDULE_PARENT_AMBIGUOUS` gap; Case D golden; Phase 2 regression lock on CONFIRMED / `l1Eligible`.

**Non-Goals:** Promote schedule to CONFIRMED; change INDEX; auto depth+1 via Horae; WP-8 partition work; literals in derivation code.

## Decisions

### D1. Horae is presentation-only on frontiers

`schedulePreferred` and `scheduleRelation` are emitted only on `frontier[].candidates[]`. They do not alter `resolveReadField`, `l1Eligible`, `evidenceStatus`, or default recursion.

### D2. Lookup sources

1. **Cache path (default harness):** `readHoraeRelationCache(taskId, cacheRoot, "up")` → upstream neighbor task ids (`task_id` / `taskId` on rows).
2. **Schedule edges (tests / optional):** `createHoraeScheduleRelationLookupFromScheduleEdges(scheduleEdges)` — same shape as multi-hop `scheduleEdges`.

Per consumer task:

| Lookup status | Candidate `scheduleRelation` |
| ------------- | --------------------------- |
| Cache miss / invalid | `HORAE_UNAVAILABLE` |
| Available, task in upstream list | `DIRECT_PARENT` |
| Available, task not in list | `NOT_IN_HORAE_UPSTREAM` |

### D3. schedulePreferred rule

`schedulePreferred === true` only when exactly one frontier candidate is `DIRECT_PARENT` for that read. Multiple Horae parents among candidates → all `schedulePreferred: false` + gap `SCHEDULE_PARENT_AMBIGUOUS`.

### D4. Sorting

After enrichment, candidates sort with `schedulePreferred` first; ties preserve original INDEX candidate order (stable).

### D5. Schema bump

`FIELD_IMPACT_RESULT` → `1.1.0` with required `schedulePreferred` + `scheduleRelation` on every frontier candidate.

### D6. Harness wiring

`createFieldEvidenceQueryContext` always passes `scheduleRelationLookup` from cache root (`FIELD_EVIDENCE_SCHEDULE_CACHE_ROOT` override). Missing cache degrades to `HORAE_UNAVAILABLE` on all candidates — no throw unless `FIELD_EVIDENCE_GOLDEN_REQUIRED=1` on Case D.

## Migration Plan

1. Land OpenSpec; `openspec validate field-evidence-schedule-preference --strict`.
2. Implement `schedule-preference.ts` + wire `impact-query` / harness / contract 1.1.0.
3. Unit + Case D golden tests; extend `no-literal-anchors`.
4. Minimal doc patch §6.

## Open Questions

（无。）
