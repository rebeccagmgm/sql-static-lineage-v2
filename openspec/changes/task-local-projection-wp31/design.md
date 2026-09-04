## Context

Post-archive WP-3.1 patch for `TASK_LOCAL_PROJECTION` before WP-5 consumption.

**一句话：调度为 `scheduleReference`，非数据血缘。**

## Goals / Non-Goals

**Goals:** scheduleReference on all covered statuses that have schedule cache; partitionPredicateStatus; statement-scoped control→write attribution; schema 1.1.0.

**Non-Goals:** subtype derivation; WRITES split; summarizeTaskRelations; CI wiring.

## Decisions

### scheduleReference

Single TASK property object:

```json
{
  "role": "SCHEDULE_REFERENCE_ONLY",
  "topicName": "...",
  "taskName": "...",
  "upstreamTaskIds": ["..."],
  "downstreamTaskIds": ["..."],
  "source": "schedule-evidence-cache",
  "observedAt": "ISO-8601 or null"
}
```

No TASK→TASK edges. Drop reliance on bare `scheduleUpstreamTaskIds` as the primary shape; keep emitting it as a deprecated mirror of `upstreamTaskIds` only when non-empty for SCHEDULE_ONLY compatibility during 1.1.0, or remove if tests allow clean break — **clean break to scheduleReference only**.

### partitionPredicateStatus

Per READ occurrence after inspecting FILTER trees that wrap the read:

| Status | Meaning |
| --- | --- |
| `NONE` | No FILTER wraps this read |
| `LITERAL` | FILTER(s) present; every ATOM is EQ/IN with all-literal values |
| `NON_LITERAL_PRESENT` | FILTER present with ≥1 ATOM that is not literal EQ/IN |

Literal EQ/IN values still populate `partitionPredicates` under LITERAL and NON_LITERAL_PRESENT (partial prune).

### Control → write

Build `statementId → writeObservationId` from dataset-io WRITE rows (`write_statement_id` / `statement_id`), falling back to RESOLVED bindings. Attach each control to the matching TARGET_WRITE; skip if unmapped (do not fall back to sorted-first).

## Risks

- Schema bump invalidates projection cache (intended).
- Downstream schedule cache may MISS for some tasks → empty `downstreamTaskIds` is OK.
