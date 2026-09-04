## 1. OpenSpec & docs

- [x] 1.1 `openspec validate field-evidence-schedule-preference --strict`
- [x] 1.2 Patch `docs/execution-plan-field-evidence-v1.md` — «调度推荐 vs CONFIRMED 接续»

## 2. FE-8 schedule preference

- [x] 2.1 `schedule-preference.ts` — Horae lookup from cache + scheduleEdges; enrich + sort
- [x] 2.2 `impact-result-contract.ts` — `FIELD_IMPACT_RESULT` 1.1.0 frontier fields
- [x] 2.3 `impact-query.ts` — enrich at frontier emission; `SCHEDULE_PARENT_AMBIGUOUS` gap
- [x] 2.4 `impact-query-harness.ts` — load schedule cache; pass lookup

## 3. Tests

- [x] 3.1 `schedule-preference.test.ts` — mock edges, sort, ambiguous, CONFIRMED regression
- [x] 3.2 Case D golden — `schedulePreferred` + rank when cache available
- [x] 3.3 `no-literal-anchors.test.ts` — include `schedule-preference.ts`
- [x] 3.4 `npm run test:field-evidence`

## 4. Validation

- [x] 4.1 `npm run typecheck`
- [x] 4.2 `npm run test:field-evidence`
