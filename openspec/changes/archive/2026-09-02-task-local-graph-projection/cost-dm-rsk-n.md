# TL-8 cost record — `DM_RSK_N` + goldens

Measured: 2026-09-02 (local Windows worktree).
Command shape: topic `DM_RSK_N` + `--also-task-ids 105387,119044,176827`, `--no-prepare-facts`.
Inputs:

- data-root: `sql-static-lineage-data`
- facts-root: `sql-static-lineage-data/field-facts`
- schedule-cache: `sql-static-lineage-cache`

Selection size: **65** tasks (63 topic + 105387 / 119044; 176827 already in topic).

## Coverage (this Facts snapshot)

| status | count |
| --- | ---: |
| `PROJECTED` | 6 |
| `SCHEDULE_ONLY` | 59 |
| `COLLECTION_FAILED` | 0 |

Most `DM_RSK_N` cache tasks still lack Current L1 Facts under `field-facts`; they correctly stay `SCHEDULE_ONLY` without prepare. The six projected tasks include the three goldens plus other tasks that already have packs/facts in this snapshot.

## Cold batch (empty projection cache)

| metric | value |
| --- | ---: |
| wall clock | **65.3 s** |
| cache | 0 hits / 65 misses |
| single-task p50 | **819 ms** |
| single-task p95 | **3988 ms** |
| single-task max | 4279 ms (`181058`) |

Slowest projected tasks (cold): `181058`, `155015`, `176827`, `119044`, `105387` (≈3.3–4.3 s).

## Warm batch (second full pass)

| metric | value |
| --- | ---: |
| wall clock | **30.9 s** |
| cache | **65 hits / 0 misses** |
| single-task p50 | **461 ms** |
| single-task p95 | **569 ms** |

Second pass is a full content-hash cache hit. Remaining per-task cost is mostly cache-key fingerprint I/O (pack / facts manifest), not re-projection.

## Notes

- Numbers are wall-clock on a developer machine; treat as order-of-magnitude for expanding to `DM_OTC_N` / `ODATA_N_TIT`, not a CI gate.
- Raising `PROJECTED` share requires Facts coverage, not CLI changes.
- Raw machine JSON for this run: `sql-static-lineage-cache/task-local-projection-tl8/tl8-cost-report.json` (local cache; not committed).
