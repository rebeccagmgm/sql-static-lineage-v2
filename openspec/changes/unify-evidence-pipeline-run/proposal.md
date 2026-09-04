## Why

The repository already produces Input Packs, Machine Facts, producer indexes, one-hop and multi-hop reconciliation, field-lineage JSON, and HTML, but callers must assemble the commands and manually choose among loose experimental files. One command and one fixed publication layout are needed so a task's current formal JSON and HTML outputs are generated together without turning the continuously expanding Input Pack into a permanently frozen repository snapshot.

## What Changes

- Add one `lineage:all` command that accepts one or more Task IDs, auto-completes required Input Pack evidence, establishes the bounded input view used by that attempt, and orchestrates Machine Facts, the internal Producer Index, one-hop, and multi-hop in dependency order.
- Add an optional field-lineage branch that combines multi-hop JSON with Machine Facts before rendering field-level HTML; table-level HTML renders directly from multi-hop JSON.
- Publish formal outputs to fixed per-task paths under `artifacts/tasks/<task-id>/`: `one-hop.json`, `multi-hop.json`, optional `field-lineage.json`, and the corresponding files under `views/`.
- Build each task in staging and replace its formal task directory only after that task's requested JSON and HTML outputs validate; one failed task must not corrupt successful tasks or overwrite its previous formal outputs.
- Keep the Input Pack appendable. A later Input Pack expansion takes effect after the relevant reusable evidence is refreshed and does not retroactively invalidate an already published task directory.
- Do not add a run ID or `manifest.json`; formal JSON artifacts remain self-describing and fixed filenames define the publication set.
- Keep experimental depth, field-subset, probe, and comparison variants outside formal task directories under `experiments/`.
- Keep Producer Index as an internal required stage rather than exposing it as a sixth product step.
- Preserve the existing standalone stage commands and their output contracts; the new command composes them rather than replacing their legacy entry points.
- Use Task IDs `155015`, `181058`, `176827`, and `209119` and their canonical Task-Pack targets as the first end-to-end acceptance set.

## Capabilities

### New Capabilities

- `evidence-pipeline-run`: One-command orchestration, fixed per-task publication, task-isolated staging, optional field projection, and fact-only HTML rendering over a continuously expanding Input Pack.

### Modified Capabilities

None.

## Impact

- Adds a pipeline orchestrator, package script, publication helper, and focused tests without adding a run-manifest schema.
- Reuses the existing Input Pack, Machine Facts, producer-index, one-hop, multi-hop, field-lineage, and visualization modules through programmatic APIs where available.
- Requires small extraction seams where a current CLI still owns reusable orchestration logic, without changing existing CLI behavior or canonical SQL content.
- Produces fixed formal outputs under the configured data root, never discovers inputs through mutable `latest` filenames, and leaves historical loose artifacts untouched until a separately approved migration.
