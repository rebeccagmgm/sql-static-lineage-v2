## Why

The target-table causal-closure consumer currently receives table-level
multi-hop producer edges but cannot consume the partition-scoped continuation
evidence produced by WP-8.1. As a result, multi-write producers can be fanned
out by table and bridge counts can report false resolutions. This change adds
an opt-in, replayable union-v2 attachment path while keeping the legacy path
and its artifact hashes unchanged.

## What Changes

- Add the `CandidateBranch.continuation` contract and union continuation stats.
- Add a read-only adapter for `UNION_CONTINUATION_INDEX` 1.0.0 keyed by
  `(consumerTaskId, readOccurrenceId)`.
- Add `--candidate-source legacy|union-v2` (default `legacy`) and
  `--continuation-index <path>` to the target-table closure CLI.
- In union-v2, attach exact write observations and scopes, prune `DISJOINT`,
  suppress `SCHEDULE_ONLY` producer branches, and count L1/L2/ambiguous gaps
  without resolving a multi-write table fan-out.
- Add focused synthetic and real-index-shaped regression coverage for 119044
  and 105387.

## Capabilities

### New Capabilities

- `closure-on-union`: Consumes WP-8.1 continuation-index evidence in the
  target-table closure consumer with explicit compatibility and counting
  behavior.

### Modified Capabilities

None.

## Impact

- Affected consumer code is under
  `scripts/reconcile/consumer/target-table-upstream-causal-closure/` plus the
  shared `CandidateBranch` type.
- The default CLI path remains legacy and does not load or hash the new index.
- Union-v2 consumes only the JSON index; it does not import data-graph code,
  recalculate partition matches, call `producer-index-query`, or change the
  WP-8/WP-8.1 kernels.
