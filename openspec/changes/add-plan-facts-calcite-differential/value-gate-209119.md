# 209119 Calcite value gate — v18 revalidation

Recorded on 2026-08-29 (Asia/Shanghai). The v4 measurements below are now
historical only. The latest v18 evidence uses the existing Plan Facts
projection and staging reports; it does not recollect Horae inputs, publish
lineage artifacts, rewrite Native decisions, or generate `PROVEN_UNRELATED`.

## Current decision

- **Controlled expansion:** the earlier GO remains valid only as a bounded
  engineering direction, not as proof that the v18 operator batch is complete.
- **Gate B / product value:** **NOT VERIFIED / REOPENED**.
- **Calcite role:** independent, read-only Plan-Facts semantic corroboration;
  Native facts and evidence mapping remain authoritative.
- **Unfinished scope:** 5.1–5.4, 6.2, 6.4 and 8–12 remain incomplete. The
  v18 result does not justify checking any of them.

## v18 provenance

The current v18 files and hashes are:

| Staging file | Bytes | SHA-256 |
| --- | ---: | --- |
| `staging/calcite-differential/209119-plan-facts-core-join-v18.gate.log` | 465 | `A88D442BADBA4D3472E54F4F6D5C21161181C916276E985AAD46AA047C4DFC19` |
| `staging/calcite-differential/209119-plan-facts-core-join-v18.requests.jsonl` | 30,550,300 | `F3FC21BCF71943E3B1EA57B95E1CDDF6C5D75DB7325094735584105A0E010C2E` |
| `staging/calcite-differential/209119-plan-facts-core-join-v18.json` | 33,646,355 | `BAF3727C4FF256D40CE3EACA4FC34082BFD53DE02B17FB22FE31D9309588DC06` |

The request stream is `PLAN_FACTS_REL_V1`, for task `209119`, with graph
version `1`. The first request records fingerprint
`9108cb46c86724fd55f1e1bf0e017cbc2c528bc46ce7c922f8284d12472cc2dc` and
statement `task:209119:slot:query:statement:0`. The bridge report records
Calcite `1.42.0` and build fingerprint
`calcite-rel-bridge/0.1.0;calcite/1.42.0;protocol/1`.

The repository does not contain the original v18 shell command or a complete
source-manifest snapshot. Therefore these staging files are auditable
evidence, but v18 invocation replayability and full input provenance remain an
explicit open boundary; no command is reconstructed or treated as fact here.

## v18 result

The projection log records 131 relations, 114 emitted requests, 114 `SUCCESS`,
17 `PARTIAL`, and 0 `UNSUPPORTED`. All 17 partial relations have issue
`PROJECT_EXPRESSION_STRUCTURE_UNSUPPORTED`.

The Calcite report records 114/114 bridge responses as `SUCCESS`, with:

| Measure | v18 result |
| --- | ---: |
| Raw SQL requests | 0/0 (not evaluated) |
| Plan Facts requests | 114/114 responses |
| Evaluated observations | 17,428 |
| `NOT_EVALUATED` observations | 1,565 |
| Exact mapping of evaluated observations | 17,428/17,428 (100% of evaluated observations only) |
| Unique observations | 3,972 |
| Observation-id content conflicts | 0 |

The 100% mapping rate is bounded to evaluated observations. It is not an
overall v18 coverage or completeness rate. The 1,565 `NOT_EVALUATED` items and
17 projection partials remain visible boundaries and cannot support positive
or negative causal conclusions.

The report safety flags are `canonicalArtifactsWritten=false` and
`causalDecisionsWritten=false`. These flags establish the intended runner
boundary for this report; they do not explain unrelated changes later observed
in the external canonical directory.

## Canonical directory status observed during v18 revalidation

The external directory
`E:/02_area/股衍数据-数据cookbook/sql-static-lineage-data/artifacts/tasks/209119`
currently contains these four JSON files, all last written around
`2026-08-28 23:51:02`:

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `field-lineage.json` | 23,290,979 | `71487CE3869A9A5F2CD125263CB8AEC1B6408E6CAD1390F507551C25C6ADC768` |
| `input-pack-closure.json` | 6,862 | `070A73B6696268EB84F9698BED76658638A2785FE32C2BF76E1B6EC7F1307217` |
| `multi-hop.json` | 1,131,889 | `E7116D2F8010366DB990A2C315C9327D41E9ED9C5FFA0D03C0AB88CC0889BC20` |
| `one-hop.json` | 10,580,252 | `38B7FE0E578CD677081F92EE2EAAB11B5A36C683C8451BF28F219A23A0BE841F` |

The expected acceptance files `field-lineage.html`,
`target-field-causal-slice.json`, and `target-field-causal-slice.html` are
absent. `field-lineage.json` also differs from the historical baseline
(`19,792,471` bytes and hash
`49F4CD10B3C081430DFA4A63BD3DABF90E89679A020A667D866BF7B09579C5C6`). The
source of this external-directory state is not attributed by the available
repository evidence. It is therefore **not** evidence that 7.3 passed, and it
must not be repaired, deleted, or overwritten as part of this differential
change.

## Default-path and isolation verification

- The production pipeline under `scripts/pipeline` has no Calcite import,
  bridge startup, or differential-report input.
- `package.json` exposes the differential runner as an explicit command; the
  default production path does not invoke the Java bridge. The default test
  list includes an existing TypeScript Calcite protocol test, which is not a
  bridge startup and does not publish artifacts.
- `E:\02_area\股衍数据-数据cookbook\scripts\Calcite\sidecar-runner.mjs` reads
  canonical artifacts and writes an independent report; the sidecar's own
  candidate batch keeps all canonical/causal writes false.
- v18 itself reports both canonical and causal writes as false.

This preserves the intended default-off boundary, but formal 6.4 and 11.x
acceptance tasks remain open until their dedicated tests and command transcript
are recorded.

## Historical v4 result (superseded)

Decision: **GO for controlled broader operator expansion, with Calcite remaining an independent semantic corroboration lane.**

The Plan Facts lane now proves that Calcite can consume the repository's structured facts without a Hive SQL rewrite and that its evaluated observations can be mapped back to exact Native physical identities. It is not allowed to rewrite canonical field lineage or make a rerun decision by itself. The controlled expansion can therefore proceed for operator semantics, while canonical decisions remain Native-owned and evidence-conservative.

| Measure | Raw SQL lane | Plan Facts core lane |
| --- | ---: | ---: |
| Input outcome | Not used in this gate | 92/92 requests succeeded |
| Relation coverage | N/A | 92 successful projections; 39 explicit partial projection boundaries; 0 unsupported requests |
| Calcite observation occurrences | N/A | 8,684 |
| Unique Calcite evidence objects | N/A | 3,723 |
| Evaluated observations | N/A | 8,024/8,684 |
| Exact mapping of evaluated observations | N/A | 8,024/8,024 (100%) |
| Not evaluated observations | N/A | 660, each retained as an explicit boundary |
| Sidecar failures/conflicts | N/A | 0 process/protocol failures; 0 observation-id content conflicts |
| Native corroboration on `contr_status` | N/A | 8 exact Calcite proof refs attached without changing Native dependency IDs |
| Measured Native Unknown reduction | Not evaluated | Not claimed: the Calcite lane does not create or rewrite Native decisions |

The Plan Facts observations comprise expression lineage, predicates, unique keys, functional dependencies, table occurrences and row-count/cardinality metadata. The causal adapter maps the evaluated subset to exact physical fields or relation occurrences; 48 observations that cannot be assigned a valid operator descriptor are explicit `CALCITE_OPERATOR_MAPPING_UNSUPPORTED` boundaries, not dependencies. None is converted to unrelated evidence.

## Safety check

The independent reports are `staging/calcite-differential/209119-plan-facts-core-join-v4.json` and `staging/calcite-differential/209119-causal-evidence-v4.json`. The explicit Native overlay is `staging/calcite-differential/209119-contr-status-calcite-v4.json`. None is a canonical published artifact; the differential runner cannot write causal decisions or `PROVEN_UNRELATED`.

All four published 209119 acceptance hashes remained equal to `baseline-evidence.md` after the run:

- `field-lineage.json`: `49F4CD10B3C081430DFA4A63BD3DABF90E89679A020A667D866BF7B09579C5C6`
- `field-lineage.html`: `D52FD694097C09997938EB1A08175290894A0C0617A55ACC94762857441093FE`
- `target-field-causal-slice.json`: `DDB1A2C9CA1F8052C94CB48B04003879F87004252F21C07234D08FFC007AE15D`
- `target-field-causal-slice.html`: `DD69050C1D7525ACEAA59F749AC6552B1F9B1A9EF5580C3F06CF31EA3EB4C307`

## Expansion condition

The value gate is met for controlled expansion because the evaluated observations have a 100% exact mapping rate and provide measurable operator metadata, with no evidence-identity loss or canonical-path regression. This does not claim a Native `UNKNOWN` reduction: the overlay is intentionally proof-only. Future batches must retain the same exact-identity, explicit-boundary and default-off rules.
