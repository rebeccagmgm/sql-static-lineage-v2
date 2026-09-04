## Why

The Input Pack path already has a structured branch for tasks whose runtime contract is “the query output is written to the Pack target”. It currently publishes that observation under the generic `PLATFORM_TARGET_QUERY_OUTPUT` label and does not carry the source SQL hash on the write/binding records. The frozen graph-accuracy architecture names this evidence shape explicitly as `PACK_DECLARED_QUERY_OUTPUT` and requires provenance plus an immutable link to the original SQL.

WP-6 makes that existing path an explicit, auditable Facts contract. It is the first decision gate before changing graph identity, read-occurrence projection or cross-task closure.

## What Changes

- Emit `PACK_DECLARED_QUERY_OUTPUT` as the canonical write-observation kind for a Pack-declared query output.
- Preserve the Pack target evidence, producer statement identity, provenance and original Input Pack SQL SHA-256 on the write observation and its output bindings.
- Keep the structured path fail-closed for target identity, unique query boundary, target schema and partition evidence; retain typed `unknowns.jsonl` gaps instead of guessing.
- Make explicit SQL writes retain their `source_as_boundary.proven=false` semantics where applicable; that flag describes a CTAS/query boundary, not whether an INSERT write is valid.
- Continue reading existing `PLATFORM_TARGET_QUERY_OUTPUT` Facts as a compatibility input, while new Facts use the explicit kind.
- Add real-pack regression coverage for the representative sparkIndex tasks 132028, 155939 and 176827 without modifying their canonical Input Pack SQL.

## Non-Goals

- No synthetic INSERT or rewritten SQL/span is introduced.
- No new parser, task-name/catalog heuristic, identity/partition status redesign, UNION projection or closure propagation is included.
- No change to the legacy root snapshots or reference query contracts.

## Impact

- Touches the Machine Facts contract, platform-target write construction, output-binding validation/propagation, compatibility predicates and focused tests.
- Newly generated Facts change only the semantic kind/hash fields for Pack-declared writes; old bundles remain loadable.
- Real-pack checks write to an isolated temporary output root and do not overwrite the shared evidence pack.
