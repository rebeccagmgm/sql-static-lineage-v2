## 1. Executable contracts and regression tests

- [x] 1.1 Add regression tests for `lineage:all` argument parsing, duplicate Task-ID normalization, the `--with-fields` option, and fixed artifact paths.
- [x] 1.2 Add staging/publication tests for the table-only artifact set.
- [x] 1.3 Add tests for task-isolated publication, stale optional-file removal, and aggregate failure status.
- [ ] 1.4 Add failing tests for safe Windows staging, backup, rollback, and recovery paths constrained beneath the configured artifact root.

## 2. Pipeline preparation and table-level orchestration

- [x] 2.1 Add the pipeline option/result contracts and a `lineage:all` CLI that accepts one or more Task IDs, a data root, an optional artifact root, and optional field-lineage settings.
- [ ] 2.2 Implement bounded Input Pack preparation over all requested roots using existing autofill/collection behavior, retaining exact missing-evidence failures and refreshing reusable producer evidence until the request converges or reaches its bound.
- [ ] 2.3 Load one final producer context for formal generation and compose existing one-hop and multi-hop programmatic APIs without changing their standalone CLI behavior.
- [x] 2.4 Write staged `one-hop.json` and `multi-hop.json`, and render `views/table-lineage.html` only from staged multi-hop JSON.
- [x] 2.5 Add a compatible stable content hash to the formal one-hop artifact while preserving legacy fields.

## 3. Optional Machine Facts and field-lineage branch

- [x] 3.1 Derive the available Task-ID union from each multi-hop artifact and prepare the durable Machine Facts cache incrementally.
- [x] 3.2 Infer each root target from its canonical Task Pack and invoke field lineage with all target columns when no explicit field list is supplied.
- [x] 3.3 Write staged `field-lineage.json` and render `views/field-lineage.html` only from that JSON.

## 4. Fixed publication and command integration

- [x] 4.1 Implement task-scoped staging, lock, backup, replace, and rollback for `artifacts/tasks/<task-id>/`.
- [x] 4.2 Publish tasks independently, continue remaining tasks after a failure, and set the process exit code from the aggregate result.
- [x] 4.3 Add the package script for `npm run lineage:all` without changing existing stage scripts or relying on `npx`.

## 5. Verification and first formal publication

- [ ] 5.1 Run focused pipeline, one-hop, multi-hop, Machine Facts, field-lineage, and visualization tests through repository npm scripts; run typecheck and build and preserve any exact pre-existing failures.
- [ ] 5.2 Run table-level and field-enabled acceptance for Task IDs `155015`, `181058`, `176827`, and `209119` against their canonical targets, reporting each task's publication status, field evidence status, timing, and failure boundary.
- [ ] 5.3 Verify the fixed formal directories contain no manifest, run ID, loose variants, or stale optional files and that both HTML files are driven by their sibling staged JSON artifacts.
- [x] 5.4 Document the single command, fixed layout, optional field behavior, failure isolation, and the boundary between formal outputs and `experiments/`; leave existing loose artifacts untouched.
