# Task 209119 bounded validation evidence

Date: 2026-08-27

## Execution boundary

The run used the existing Input Pack, Machine Facts, pinned Producer Index, and
matching table multi-hop artifact. It invoked only
`reconcile-target-field-causal-slice`; it did not invoke Task collection,
Machine Facts generation, Producer Index build/update, table multi-hop
reconciliation, or legacy field-lineage reconciliation.

Root identity:

- Task: `209119`
- Table: `dm_rsk_n.otc_opt_sub_trd_info`
- Write observation: `write-observation:209119:platform-target:0`

## Canonical result

- Artifact content hash:
  `eaacf4fa15f5ce6e9d15a1c3e739043ab3483d3ebc62645311f57da24f9dc430`
- Task-scoped input fingerprint:
  `ec4e5337c676f6675244f668603d9e66d24e4a16b4fe5153c120779a25f76bf5`
- Root target fields: 137
- Candidate branches: 549
- Assessment pairs: 75,213 (exactly `137 x 549`)
- `CONDITIONAL_RELATED`: 137
- `UNKNOWN`: 75,076
- `CONFIRMED_RELATED`: 0
- `PROVEN_UNRELATED`: 0
- Minimum confirmed rerun Tasks: 0
- Conservative safety rerun Tasks: 79
- Confirmed evidence closure: `NOT_APPLICABLE`
- Closed decision coverage: `0 / 75,213`
- Precision and Recall: `NOT_EVALUATED`
- Value/control limits: not truncated

The empty minimum set is not a claim that nothing must rerun. The observed
table universe is incomplete and the root Machine Facts are legacy, so the
result deliberately exposes uncertainty instead of manufacturing certainty.

## Publication and compatibility

The new files are published independently as
`target-field-causal-slice.json/.txt/.html`. Publication completed without a
lock, staging, backup, or journal residue.

The legacy artifacts remained byte-identical:

- `field-lineage.json` SHA-256:
  `49F4CD10B3C081430DFA4A63BD3DABF90E89679A020A667D866BF7B09579C5C6`
- `field-lineage.html` SHA-256:
  `D52FD694097C09997938EB1A08175290894A0C0617A55ACC94762857441093FE`

## Scalability boundary

The full-field run required a 16 GiB Node heap, peaked above 11 GiB working
set, and took about 12 minutes. The canonical JSON is about 184 MB. This is a
known V1 scalability limit of materializing every target-field/branch pair in
one object. Per-target-field sharding or a streaming artifact writer is a
follow-up optimization; it does not change the evidence result above.

Calcite sidecar evidence and its independent NO_GO decision are recorded in
`calcite-validation-evidence.md`.
