## 1. Lock the compatibility and dependency boundaries

- [ ] 1.1 Add a failing focused test that imports the canonical evidence module and verifies the legacy one-hop path exposes the same public API; verify the test fails because the canonical module does not yet exist.
- [ ] 1.2 Add a source-boundary test that rejects imports from `scripts/input/` to the one-hop cache path while allowing the compatibility facade itself; verify the test detects the current reverse dependencies before migration.

## 2. Relocate the implementation

- [ ] 2.1 Add `scripts/evidence/schedule-evidence-cache.ts` with the existing implementation unchanged except for its relative Machine Facts contract import; verify the focused cache behavior tests pass against the canonical module.
- [ ] 2.2 Replace `scripts/reconcile/consumer/one-hop/schedule-evidence-cache.ts` with an implementation-free compatibility re-export; verify the compatibility test passes and the facade contains no cache logic.
- [ ] 2.3 Migrate every repository-owned production import to the canonical evidence path; verify a bounded `rg` search leaves the legacy path only in the facade and compatibility/boundary test.
- [ ] 2.4 Migrate repository-owned test imports to the canonical evidence path except the explicit compatibility assertion; verify the source-boundary test passes.

## 3. Verify behavior and scope

- [ ] 3.1 Run `npm test`, `npm run test:input-pack:from-cache`, `npm run test:reconcile-one-hop`, `npm run test:reconcile-multi-hop`, and `npm run test:lineage-all`; verify cache, Input Pack, one-hop, multi-hop, and pipeline behavior remain green without remote collection.
- [ ] 3.2 Set `TASK_LOCAL_GOLDEN_REQUIRED=1`, run `npm run test:task-local-projection`, then clear the environment variable; verify schedule-backed project projections and available real-Facts goldens do not skip or regress.
- [ ] 3.3 Run `npm run typecheck` and the final import-boundary search; verify no new dependency cycle, unresolved import, schema change, generated artifact, or `docs/` edit exists.
- [ ] 3.4 Review the complete change for API/export drift, cache path/hash/error changes, accidental semantic edits, and missing tests; resolve findings and rerun only affected gates.
