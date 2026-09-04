# Data Graph behavior baseline

This directory freezes small input and observed-output vectors from the useful
file-backed behavior in the sibling `scripts/data-graph` repository. It is not
a copy of that repository's contracts, projection algorithms, snapshots, or
query backend.

Source commit: `ece061ad62b2ff9e516970c48be8aca254601eb8`

The vectors were taken from these synthetic tests:

- `tests/task-local-union-continuation-v2.test.ts`
- `tests/project-topology.test.ts`
- `tests/field-evidence-graph.test.ts`
- `tests/target-causal-overlay.test.ts`
- `tests/project-topology-view.test.ts`

They preserve only observable behavior needed by the consolidated repository:
continuation matching, bounded topology/field/causal file queries, and the
offline static view.

Each vector keeps the minimum decisive input (including partition predicates
or exact query/publish invocation) beside the output observed in the old tests.
The guard test validates their references and semantic correspondence; it does
not execute a replacement projection, traversal, publisher, or search engine.

## Verification run

On 2026-09-05 the five files above were run against the old repository's real
production modules with `npm exec -- vitest run <files...>`. Vitest reported
49 passed and one failed out of 50 tests. The 49 synthetic tests passed. The one failure was the
drift-prone real-artifact assertion named
`reads 119044's current envelope, not the legacy golden projection`; its live
producer candidate set had expanded beyond the historical expectation, so it
is deliberately not used as a frozen vector here.

`git status --porcelain=v1` was empty immediately before and after the run. No
historical snapshot hash is recorded.
