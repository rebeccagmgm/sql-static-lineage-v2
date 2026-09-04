# Continuation rules checklist

1. Add a rule id constant and implementation under `rules/`.
2. Register the rule in `registry.ts` with a fixed `ContinuationStage` (do not read stage order from policy JSON).
3. Set `ContinuationCapability` in the rule file comment; enforce: `PRUNE_ONLY` must never set `continuationEligible=true`.
4. Wire the rule in `applyRegistryRules` for its stage; policy only enables/disables via `enabledRuleIds`.
5. Never invent writers outside the INDEX candidate list.
6. `MAY_MARK_ELIGIBLE` overlap must come from `matchProducersByReadScope` only.
7. Add a focused unit test under `tests/project-graph/field-evidence-v1/continuation/`.
8. Run `npm run test:field-evidence` and `npm run typecheck`.
9. Update `docs/execution-plan-field-evidence-v1.md` §6.2.2 if behavior is user-visible.
10. Keep task/table/column literals out of derivation code (no-literal-anchors lint).
