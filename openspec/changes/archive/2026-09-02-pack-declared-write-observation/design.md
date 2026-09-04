## Context

`input-pack-machine-facts.ts` resolves the Pack target and partition evidence, then delegates to `machine-facts.ts`. The latter already identifies a unique enumerable query producer when a task has no explicit SQL INSERT/CTAS and creates a platform-target write. `output-field-bindings.ts` already has the required boundary, schema and partition gates, but the public record kind remains the older platform label.

The frozen architecture treats this as shape B (`PACK_DECLARED_QUERY_OUTPUT`). The source SQL must remain byte-identical; the analysis snapshot may still be a deterministic combined view for multi-slot Packs, but every Pack-declared write must point back to the original Pack SQL hash.

## Decisions

### Canonical kind with compatibility reader

Use `PACK_DECLARED_QUERY_OUTPUT` for newly emitted `dataset-io.jsonl.write_kind` and `output-field-bindings.jsonl.evidence_kind`. Define the old `PLATFORM_TARGET_QUERY_OUTPUT` value as a read-compatible legacy alias. Consumer predicates that identify the platform-target route accept both values; no existing bundle is rewritten in place.

### Source hash is explicit and immutable

Add `source_sql_sha256` to a Pack-declared write observation and propagate it to each output binding. Its value is the Input Pack provenance `sql_sha256` when available, otherwise the exact SQL snapshot hash used by the generic Facts profile. Validate it as a SHA-256 string and, for Input Pack bundles, require equality with `manifest.inputs.input_pack.sql_sha256`.

### Keep gates at the evidence boundary

The write is constructed only when the target is directly resolved and exactly one deduplicated query producer has contiguous output ordinals. Binding remains fail-closed when Pack partition status is not `NOT_PARTITIONED` or `COMPLETE`, when target Schema evidence is missing, or when the producer boundary is not proven. Each failure remains a typed `unknowns.jsonl` record with uncovered ordinals.

### Clarify S10 without changing explicit INSERT semantics

`source_as_boundary.proven` is true for CTAS and the Pack-declared query-output shape. It remains false for ordinary INSERT/INSERT OVERWRITE because those writes use explicit INSERT syntax and do not need a CTAS `AS SELECT` boundary. Validation and tests must not use that flag to reject a valid explicit INSERT binding.

### Real-pack acceptance

The focused test discovers `sql-static-lineage-data` next to the repository (or uses `WP6_REAL_DATA_ROOT`), regenerates 132028, 155939 and 176827 into a temporary directory, and asserts deterministic task success, Pack-declared write provenance/hash, resolved bindings where the gates pass, and typed gaps where they do not. `WP6_REAL_PACK_REQUIRED=1` turns a missing data root into a failure; otherwise the test is skipped outside the local evidence checkout.

## Files

- `scripts/machine-facts/machine-facts-contract.ts`: typed write/binding kind and source hash fields.
- `scripts/machine-facts/machine-facts.ts`: canonical Pack-declared write construction and hash propagation.
- `scripts/machine-facts/output-field-bindings.ts`: alias-aware gate/propagation logic.
- `scripts/machine-facts/schemas` / `schemas/machine-facts-records.schema.json`: record validation for the new fields.
- `scripts/reconcile/consumer/field-lineage/physical-field-expander.ts` and related consumers: accept both canonical and legacy platform-target kinds.
- `tests/pack-declared-write-observation.test.ts` plus focused existing Machine Facts tests.

## Rollback

The producer can be rolled back to the legacy label without changing SQL or Pack inputs. Compatibility readers remain in place so previously published bundles continue to load during the transition.
