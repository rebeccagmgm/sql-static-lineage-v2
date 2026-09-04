# Preflight Baseline

Captured on 2026-08-29 before direct-project implementation.

## Existing orchestration

`lineage:all --task-ids` parses multiple root IDs, but calls `runTask` once per
root in sequence. Each root independently performs these preparation stages:

1. Input Pack closure and Producer Index pinning.
2. Machine Facts generation for that root closure.
3. Horae schedule-evidence prefetch for that root closure.
4. One-hop reconciliation for that root closure.
5. Root multi-hop traversal.
6. Field-lineage generation and task-level publication.

The existing `reconcileMultiHopBatch` already reuses one prepared repository
and one-hop context across its roots. The duplicated work to remove is therefore
primarily before traversal. The legacy `lineage:all` orchestration and its task
publication contract are frozen for this change.

## Frozen real source identity

All three acceptance roots currently share:

- Input Pack fingerprint: `2a03d8a1c0aa1dd92a6956cded973adb8e8d83b0e88f28f78796802921cd03e6`
- Producer Index content hash: `935baee87b334259d76143061c46578aa53646b0a7dc8a8558231d0135e2194d`
- Terminal config: `config/multi-hop-terminal-table-rules.json`
- Terminal config SHA-256: `d06024987694e3ee3e02b04a8c5059a36c176da55b62399a1da905fd4c5d30d8`

| Root | one-hop SHA-256 | multi-hop SHA-256 | Task/Table/Read/Write/Bridge/Schedule/Terminal |
| --- | --- | --- | --- |
| 176827 | `7c3082c8c1168650313a74f432c4b5f4a4cbf465e922f04ec138c7d87228580d` | `42967f45bc3f28838531123b32e5696a994bad48c9dc833125470beae67b0ec9` | 60 / 81 / 127 / 59 / 175 / 73 / 124 |
| 181058 | `c3daa0c67c0badf7ddb58dcde06af25403da08d410dbfea79b91f458df4b6dff` | `f5de652c83bc992c6a3d460cdf3aedc707f94ffde2a56d570a881a854fedf8b0` | 64 / 88 / 140 / 64 / 218 / 81 / 144 |
| 209119 | `38b7fe0e578cd677081f92ee2eaab11b5a36c683c8451bf28f219a23a0be841f` | `e7116d2f8010366db990a2c315c9327d41e9ed9c5ffa0d03c0ab88cc0889bc20` | 79 / 104 / 164 / 78 / 239 / 109 / 174 |

Every source reports `COMPLETE_OBSERVED_EVIDENCE` and `truncated=false`.

## Mutation sentinels

Canonical task-artifact directory manifests include all four files currently
published for each root, sorted by filename and hashed from `(name, sha256,
bytes)` records:

- `176827`: 4 files, `8f9250a31c4a4a1749f3deb9123ecab1d9ef1f01b75fe5bea6e32df486aaeaf3`
- `181058`: 4 files, `fff4e13027cf9a0c8abd0f8603be31614b1a517bf99bad26ed01333c05a90859`
- `209119`: 4 files, `3c5c21e1a0084a2deb8e9860feaeeaf969dfafa9038de3661b62f6c983ed56e8`

Pre-existing unrelated dirty files are protected by exact hashes:

- `scripts/reconcile/consumer/field-lineage/physical-field-expander.ts`:
  `2e04c4c2eb3c5b645ee44a4e49f0f38ebe3dd5f8ce15151f98beff96beb64408`
- `tests/physical-field-expander.test.ts`:
  `984d60b39b54cb9ee1ddffe93e16a66e3301bd75ce7654c2cfa6a6ac891cc954`

The separate untracked `openspec/changes/project-graph-query-index/` directory
is also out of scope.
