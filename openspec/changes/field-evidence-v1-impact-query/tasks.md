## 1. OpenSpec & docs

- [x] 1.1 `openspec validate field-evidence-v1-impact-query --strict`
- [x] 1.2 Patch `docs/execution-plan-field-evidence-v1.md` §6.2/§6.3/Case E + phase table (Phase 1 done, Phase 2 in progress)
- [x] 1.3 One-line pointer in `architecture-evidence-lineage-overview.md` and `execution-plan-asset-graph.md`

## 2. FE-4 FieldEdgeIndex + resolveReadField

- [x] 2.1 `field-edge-index.ts` — indexes by binding and read-field; embeds relation tree from Facts bundle
- [x] 2.2 `resolve-read-field.ts` — four states; INDEX reasonCode passthrough
- [x] 2.3 Unit tests for resolve four states (synthetic INDEX, no real task ids in derivation)

## 3. FE-5 Impact Query

- [x] 3.1 `impact-result-contract.ts` — `FIELD_IMPACT_RESULT` 1.0.0 types + validate
- [x] 3.2 `control-scope.ts` — relation-tree scope per §6.3
- [x] 3.3 `impact-query.ts` — full algorithm, budget, materialization passthrough, CONTRACT_TOO_OLD
- [x] 3.4 Extend `no-literal-anchors.test.ts` for new modules

## 4. FE-6 Golden cases A–E

- [x] 4.1 Test harness: live 1.3.0 projections + INDEX path env (`FIELD_EVIDENCE_INDEX_PATH`)
- [x] 4.2 Run queries; freeze `tests/fixtures/field-evidence-v1/{a,b,c,d,e}/expected.json` invariants
- [x] 4.3 `npm run test:field-evidence` + `FIELD_EVIDENCE_GOLDEN_REQUIRED` support

## 5. FE-7 Stop-loss

- [x] 5.1 `stop-loss-cli.ts` — ten Greek columns, §9 decision output
- [x] 5.2 `npm run field-evidence:stop-loss`

## 6. Validation

- [x] 6.1 `npm run typecheck`
- [x] 6.2 `npm run test:task-local-projection` (Phase 1 regression)
- [x] 6.3 `npm run test:field-evidence`

## 7. Follow-up (non-blocking)

- [x] 7.1 Two additional setop/materialization invariant cases from shadow evaluation slice (fixture paths only)
