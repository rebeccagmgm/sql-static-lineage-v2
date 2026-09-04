# Calcite differential baseline evidence

Recorded before implementation on 2026-08-28 (Asia/Shanghai).

## Repository state

- Branch: `codex/incremental-field-graph-v1`
- HEAD: `db51ac01368ad3f463f989d751f0aca8da23d1ac`
- Pre-implementation tracked worktree: clean.
- The new OpenSpec change was untracked planning content; subsequent implementation paths are evaluated separately.

## Existing Calcite tool

- Pinned Calcite version: `1.42.0`.
- TypeScript protocol/reconciler: `scripts/calcite-oracle/`.
- Java tool: `tools/calcite-oracle/`.
- Existing independent runtime command: `npm run test:calcite-oracle`.
- Existing direct Maven/runtime flow is documented in `tools/calcite-oracle/README.md`.
- Baseline `npm run test:calcite-oracle`: PASS (`Calcite oracle runtime checks passed`).

## Existing consumers and compatibility surface

- `tests/calcite-oracle-reconciler.test.ts` imports the old protocol and reconciler paths.
- `scripts/reconcile/consumer/target-field-causal-slice/calcite-shadow-report.ts` imports old Calcite fingerprint/protocol types.
- `scripts/reconcile/consumer/target-field-causal-slice/calcite-semantic-mapping.ts` imports old protocol types.
- `tests/target-field-causal-slice/calcite-semantic-mapping.test.ts` and its fixtures use the old protocol names.
- `package.json` exposes `test:calcite-oracle`; the default `npm test` includes the TypeScript reconciler test but does not build or start Java.

## Default-path validation baseline

- `npm run typecheck`: PASS.
- `npm test`: FAIL with six pre-existing failures in `tests/task-inspection.test.ts`; failures were reproduced before differential implementation. Representative signals are `CURRENT_L1` expected but `INVALID`, `READY` expected but `NOT_EVALUABLE`, and four dependent rendering/binding assertions. Other observed suites, including field-lineage, Plan Facts regression and existing Calcite reconciler coverage, continued running successfully.
- These six failures are baseline debt and must not be reported as Calcite regressions. New or changed failures remain regressions.

## Published 209119 artifact baseline

The following files are read-only acceptance anchors. Differential work must not overwrite them.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `field-lineage.json` | 19,792,471 | `49F4CD10B3C081430DFA4A63BD3DABF90E89679A020A667D866BF7B09579C5C6` |
| `field-lineage.html` | 2,101,364 | `D52FD694097C09997938EB1A08175290894A0C0617A55ACC94762857441093FE` |
| `target-field-causal-slice.json` | 184,420,977 | `DDB1A2C9CA1F8052C94CB48B04003879F87004252F21C07234D08FFC007AE15D` |
| `target-field-causal-slice.html` | 5,455,784 | `DD69050C1D7525ACEAA59F749AC6552B1F9B1A9EF5580C3F06CF31EA3EB4C307` |

## Isolation acceptance rule

Calcite-disabled commands must not import, build, start or read the new Java bridge. Published artifact hashes above must remain unchanged during staging differential evaluation.
