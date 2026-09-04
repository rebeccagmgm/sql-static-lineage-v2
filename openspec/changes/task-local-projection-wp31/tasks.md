## 1. Schema and scheduleReference

- [x] 1.1 Bump `TASK_LOCAL_PROJECTION` schemaVersion to `1.1.0`.
- [x] 1.2 Extend schedule context with downstream ids + observedAt; emit `scheduleReference` on PROJECTED and SCHEDULE_ONLY.
- [x] 1.3 Validator: scheduleReference task ids must not appear on data-edge endpoints; add unit test.

## 2. partitionPredicateStatus

- [x] 2.1 Classify NONE / LITERAL / NON_LITERAL_PRESENT per READ occurrence; keep literal predicates when present.
- [x] 2.2 Unit tests for the three statuses.

## 3. Control → write attribution

- [x] 3.1 Map statement id → write_observation_id; attach DATASET_CONTROL to matching TARGET_WRITE.
- [x] 3.2 Golden / focused test: 105387 controls do not all hang on one write.

## 4. Verification

- [x] 4.1 `npm run test:task-local-projection` and `npm run typecheck` green.
- [x] 4.2 Document `TASK_LOCAL_GOLDEN_REQUIRED=1` in `AGENTS.md` for CI jobs that mount Facts (no `.github` workflow in this repo yet).
