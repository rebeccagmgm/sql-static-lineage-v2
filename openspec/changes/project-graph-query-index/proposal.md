## Why

Phase 1 and Phase 2 now publish validated immutable topology and field-evidence projections with deterministic file-backed queries, but every query still scans local snapshot files and there is no database index whose freshness and results are proven against those reference implementations. Phase 3 should add Neo4j only as a replaceable query index, now that two concrete projection contracts and six reference query primitives have been accepted.

## What Changes

- Add Phase 3 `QUERY_INDEX`, an optional Neo4j index built only from validated immutable `PROJECT_TOPOLOGY` and `FIELD_EVIDENCE` projection snapshots.
- Bind every index build to exact projection snapshot IDs, manifest hashes and file hashes; reject changed, corrupt or incoherent source directories before any database publication.
- Import each build into an isolated staging namespace, validate counts, endpoints and source identities, then switch the project index pointer atomically. Failed or incomplete builds never become current.
- Add Neo4j-backed adapters for the existing six reference queries: project topology retrieval, project-upstream tracing, topology-edge explanation, field-evidence retrieval, field-value tracing and field-record explanation.
- Add deterministic parity fixtures and real-snapshot checks that compare normalized Neo4j query envelopes with the existing file-backed results, including status, warnings, limits, ordering, boundaries and truncation behavior.
- Detect missing or stale current indexes and fail closed. Callers may invoke the existing file implementation explicitly, but the Neo4j adapter does not silently combine database and file results.
- Keep credentials and connection details outside projection and index artifacts, and keep the historical knowledge graph, canonical task artifacts, evidence caches and old inference rules outside the import path.
- Explicitly exclude UI work, causal/business overlays, cross-project semantic inference, changes to Phase 1/2 contracts and a generic publication/query framework refactor.

## Capabilities

### New Capabilities

- `project-graph-query-index`: Defines source-bound Neo4j index publication, stale-index detection, controlled query adapters and parity with immutable file-backed graph queries.

### Modified Capabilities

None. Phase 1 and Phase 2 projection and reference-query behavior remain unchanged and serve as the source and parity baseline.

## Impact

- Adds isolated code under `scripts/project-graph/query-index/`, focused fixtures/tests and explicit CLI/package entries for index build, status and parity validation.
- Adds the Neo4j JavaScript driver as an optional Phase 3 runtime dependency; normal lineage generation, projection publication and file-backed queries remain database-independent.
- Writes only index-owned records in a dedicated Neo4j namespace selected by project key and index-build identity. It does not clear a database, replace historical KG projects or mutate canonical JSON/JSONL evidence.
- Requires an explicitly configured Neo4j endpoint and credentials for live import/query acceptance; secrets are never written to manifests, logs or test fixtures.
