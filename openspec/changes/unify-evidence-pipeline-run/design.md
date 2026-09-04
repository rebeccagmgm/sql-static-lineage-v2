## Context

See `proposal.md` for motivation and `specs/evidence-pipeline-run/spec.md` for observable behavior. The repository already exposes programmatic entry points for Input Pack Machine Facts, producer-index construction, one-hop, multi-hop, field lineage, and both renderers, but their CLIs publish unrelated paths and current loose outputs cannot be selected reliably by filename. The checkout also contains uncommitted changes owned by another task, so implementation must preserve them and use the current exported contracts rather than reverting files.

The Input Pack is a continuously expanding fact store rooted at `tasks/` and `tables/`. A global repository fingerprint is useful while building a consistent Producer Index but is not a permanent product identity and will not be exposed in the formal artifact layout.

## Goals / Non-Goals

**Goals:**

- Provide a single programmatic orchestrator and package command for one or many root tasks.
- Reuse existing stage implementations rather than reproducing SQL parsing or lineage logic.
- Publish a complete fixed task directory only after its requested artifacts validate.
- Support a cheap table-only path and an opt-in all-fields path.
- Make the four named tasks the first real-data acceptance set.

**Non-Goals:**

- Migrating, deleting, or declaring a winner among existing loose `final`, `probe`, `after-fix`, or dated artifacts.
- Adding a run manifest, public run ID, scheduler, daemon, or general workflow engine.
- Making Input Pack contents immutable between separate commands.
- Changing lineage evidence semantics, canonical SQL bytes, or existing standalone CLI contracts.

## Decisions

### Add a thin orchestrator over programmatic APIs

Create a pipeline module and CLI that imports existing stage functions. Do not shell out to package scripts for normal composition because child-process JSON parsing would duplicate contracts and make it harder to share prepared catalogs and producer context.

Alternative considered: invoke each existing CLI as a subprocess. This preserves isolation but cannot safely share the selected producer context, adds path-based coupling, and makes failure attribution and testing weaker.

### Separate preparation from formal generation

For all requested roots, run a bounded preparation loop that uses existing autofill behavior to discover missing required packs, collects them when authorized by existing collectors, and refreshes reusable producer evidence. Intermediate indexes may be rebuilt while the Input Pack expands. After preparation converges for the current request, load one final producer context and use it for the formal one-hop and multi-hop generation in that attempt.

This is an execution-scoped read view, not a promise that the entire Input Pack remains unchanged forever. If a required pack changes while the stage reads it, existing fail-closed checks remain authoritative and that task does not publish.

Alternative considered: require the whole data root to keep one fingerprint indefinitely. This was rejected because unrelated Input Pack growth would make every published task stale.

### Derive field work from the formal multi-hop task set

The table-only path stops after table HTML. With field output enabled, collect the union of task identities reached by the staged multi-hop artifact, prepare Machine Facts incrementally for those available Task Packs, and then run field projection using the canonical root target inferred from the Task Pack. An omitted field list uses the existing `ALL_TARGET_COLUMNS` behavior. Evidence gaps remain explicit `PARTIAL` or `BLOCKED`; the orchestrator does not invent fields or downgrade the facts policy.

Alternative considered: generate Machine Facts for every Task Pack before multi-hop. This wastes work on unrelated tasks and does not improve the requested projection.

### Publish a whole fixed directory per task

Use an internal staging root under the configured artifact root. Each task receives a unique temporary directory that mirrors the final layout. Validate staged one-hop and multi-hop JSON, optional field-lineage JSON, renderer inputs, task identity, and expected files before publication.

Publication takes a task-scoped lock. On Windows, move an existing formal directory to a validated backup location, move staging into the fixed final path, and restore the backup if the second move fails. Delete the backup only after the final directory is readable and validates. All resolved staging, backup, and final paths must remain under the configured artifact root.

Alternative considered: overwrite files individually. This can expose mixed generations and retain stale optional field files, so it is rejected.

### Keep batch success task-local

Process task publications independently and collect structured outcomes. Continue after a task failure when the remaining tasks are safe to run. Exit zero only when every requested task publishes or is deterministically reused as an identical valid formal result; otherwise exit non-zero with all failures reported.

### Keep formal JSON self-describing

No manifest is added. Each existing artifact validator remains the authority. Where a formal JSON contract lacks a stable content hash needed for staging validation, add it compatibly without removing legacy fields or changing standalone default paths. Fixed filenames express the publication relationship, while renderers consume the staged JSON directly.

## Risks / Trade-offs

- [Input Pack changes repeatedly during preparation] → Bound retries, retain exact failure reasons, and leave previous formal outputs untouched.
- [A multi-hop graph contains Task IDs whose packs cannot support current Machine Facts] → Publish table lineage when valid; when field output was requested, report explicit field failure and do not publish a mixed task directory.
- [A process crash occurs between Windows directory moves] → Keep task-scoped backup and staging names under the artifact root and add recovery checks before the next publication.
- [Existing dirty changes alter stage contracts during implementation] → Inspect the live diff before editing, add narrow adapter seams, and never reset or replace unrelated work.
- [Four real tasks are large] → Use targeted unit fixtures first, then run the four-task acceptance with bounded output and report per-task timing and failures.

## Migration Plan

1. Add tests and the orchestrator without changing existing CLI defaults.
2. Publish fixture-based outputs to temporary artifact roots and verify atomic replacement and failure isolation.
3. Run the four-task acceptance against the current Input Pack and a separate formal artifact root under the data root.
4. Document the single command and fixed output layout.
5. Leave existing loose artifacts untouched; any later classification or move requires a separate approved migration.

Rollback consists of removing the new package script and orchestrator files. Existing stage commands and historical artifacts remain usable throughout.
