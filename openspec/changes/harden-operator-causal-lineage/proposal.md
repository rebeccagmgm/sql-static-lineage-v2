## Why

The existing causal-slice implementation has strong operator facts and fail-closed traversal, but semantic dependency applications are not yet scoped end to end to the selected write occurrence, and most operator assertions start from hand-built Plan Facts instead of real SQL. That leaves a cross-write contamination risk and prevents a defensible precision/recall claim even though the mechanism tests are green.

## What Changes

- Carry an explicit semantic scope from the selected `write_observation_id` through statement, relation, expression, dependency definition/application, edge, gap, and proof identities.
- Restrict causal-slice Plan inputs and output roots to the selected write occurrence; reject ambiguous or mismatched scope instead of merging statements by task/table/field name.
- Add validators and adversarial tests that prove zero dependency leakage between multiple writes to the same physical table and field.
- Add a genuine SQL-to-Plan-Facts-to-semantic-dependency gold harness with schema-backed inputs, exact occurrence-aware expectations, explicit gap expectations, and deterministic snapshots.
- Freeze the initial hardening corpus around existing supported behavior; do not expand the operator support matrix in this change.
- Preserve the legacy field-lineage artifact, canonical Machine Facts, existing producer selection, and default-off Calcite differential behavior.

## Capabilities

### New Capabilities

- `occurrence-scoped-operator-lineage`: Generate and validate operator-aware semantic dependencies that are scoped to one selected write occurrence and verified from real SQL through an end-to-end gold corpus.

### Modified Capabilities

None.

## Impact

- Affects the target-field causal-slice semantic dependency contract, normalization orchestration, artifact validation, and focused test fixtures.
- Introduces a breaking `TARGET_FIELD_CAUSAL_SLICE` schema `2.0.0`; existing `1.0.0` artifacts remain untouched but must be rebuilt from matching canonical inputs before they can be treated as occurrence-safe.
- Does not modify parser semantics, Machine Facts authority, legacy field-lineage outputs, producer-index decisions, full collection behavior, or runtime data claims.
- Adds no production dependency and does not promote Calcite or OpenLineage into the canonical decision path.
