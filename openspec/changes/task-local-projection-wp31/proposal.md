# Proposal: task-local-projection-wp31

## Why

WP-3 delivered per-task projections, but PROJECTED tasks drop schedule neighbors, empty `partitionPredicates` conflate "no predicate" with "non-literal", and multi-write tasks hang all `DATASET_CONTROL` on the first sorted TARGET_WRITE. These block human readability and safe WP-5 pruning.

## What Changes

1. Attach `scheduleReference` (upstream + downstream + topic/source/observedAt, `role: SCHEDULE_REFERENCE_ONLY`) on both `PROJECTED` and `SCHEDULE_ONLY` TASK nodes.
2. Validator rejects schedule reference task ids as data-edge endpoints (with tests).
3. READS edges carry `partitionPredicateStatus`: `NONE` | `LITERAL` | `NON_LITERAL_PRESENT`, while still emitting extractable literal predicates.
4. Attribute `DATASET_CONTROL` by statement → `write_observation_id`; golden 105387 locks per-write ownership.

Bump projection schema to `1.1.0` (cache invalidation).

## Capabilities

- `task-local-graph-projection`: extend schedule reference, predicate status, and control-write attribution.

## Non-Goals

- `summarizeTaskRelations` intersection
- `FIELD_DIRECT.subtype` derivation (WP-4)
- Splitting `WRITES` edge types (WP-5)
- Full GitHub Actions wiring when no data pack is mounted (document `TASK_LOCAL_GOLDEN_REQUIRED=1` for jobs that have Facts)
