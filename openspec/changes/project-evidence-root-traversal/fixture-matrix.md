# Frozen Fixture Matrix

The direct path deliberately reuses the existing multi-hop kernel. Its compact
fixture gate is therefore the union of the established kernel fixtures and the
new direct-project fixtures, rather than a second copy of lineage semantics.

| Required behavior | Frozen fixture evidence |
| --- | --- |
| Shared Task at different root depths | `tests/project-topology.test.ts` — “merges shared stable identities but retains root-scoped depths” |
| Shared Task evaluated once | Source `tests/input-pack-closure.test.ts` — canonical Input Pack closure; standalone `E:\02_area\股衍数据-数据cookbook\scripts\data-graph\tests\project-topology.test.ts` covers legacy-pair projection |
| Cycle and diamond deduplication | `tests/reconcile-multi-hop.test.ts` — self/two-task cycles and diamond Task cases |
| Terminal/reference-config stop | `tests/reconcile-multi-hop.test.ts` — configured reference/config stop; direct fixture uses `pdata_n.ref_source_table` |
| Schedule-only parent and layer separation | `tests/reconcile-multi-hop.test.ts` root depth-1 schedule case and `tests/project-topology.test.ts` isolated traversal case |
| PRIMARY / ADDITIONAL / UNKNOWN / CANDIDATE | `tests/reconcile-multi-hop.test.ts` primary-only BFS, occurrence-specific candidate bridges and non-confirmed candidate cases |
| Partition-aware decisions | `tests/reconcile-multi-hop.test.ts` partition-unknown primary and `tests/reconcile-one-hop.test.ts` disjoint partition cases |
| checkdbflag exclusion | `tests/lineage-all.test.ts` formal snapshot exclusion; direct path calls the same exported filter |
| Per-root depth/Task/edge limits | `tests/reconcile-multi-hop.test.ts` deterministic limits plus direct-project partial-boundary fixture |
| Boundary loss / stronger role / source-root leak rejection | Historical direct parity gate is deferred; standalone legacy-pair projection is covered by `E:\02_area\股衍数据-数据cookbook\scripts\data-graph\tests\project-topology.test.ts` |

No fixture introduces a direct-project traversal rule. Any kernel behavior
change must continue to pass the legacy fixtures and the direct projection gate.
