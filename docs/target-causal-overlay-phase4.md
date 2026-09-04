# Phase 4 target causal overlay migration

The target-causal overlay projection, file queries and query-index consumer
have moved to the standalone `data-graph` consumer. This source repository no
longer provides the former overlay consumer command surface.

`sql-static-lineage` still owns and publishes the canonical
`target-table-upstream-causal-closure`, including cross-task propagation,
certainty, witnesses, budgets, task rollups, `UNKNOWN`/gaps,
`write_observation_id` and evidence references. The overlay is a rebuildable
consumer projection and must not turn into a facts source or rerun runtime
conclusions.

See the [data-graph README](E:/02_area/股衍数据-数据cookbook/scripts/data-graph/README.md)
(`E:\02_area\股衍数据-数据cookbook\scripts\data-graph\README.md`) for the
current commands, entrypoints and acceptance boundary.
