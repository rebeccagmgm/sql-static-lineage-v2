# Phase 3 query index migration

The Phase 3 query-index consumer, Neo4j integration and related commands have
moved to the standalone `data-graph` consumer. This source repository no
longer provides the former query-index command surface.

`sql-static-lineage` remains the canonical producer of the versioned SQL,
Machine Facts, one-hop, multi-hop and field-lineage artifacts. The consumer
must read those published artifacts through the stable contract; it must not
import producer source code or become a facts authority.

See the [data-graph README](E:/02_area/股衍数据-数据cookbook/scripts/data-graph/README.md)
(`E:\02_area\股衍数据-数据cookbook\scripts\data-graph\README.md`) for the
current commands, entrypoints and acceptance boundary.
