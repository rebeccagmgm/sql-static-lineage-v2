import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  lookupConfirmedProducersFor,
  resolveWriterLookup,
  writerLookupMeta,
} from "../scripts/query/table-writer-lookup.ts";
import {
  catalogWritersFromDatasetIo,
  openWriterCatalog,
  upsertTaskWriters,
} from "../scripts/query/writer-catalog.ts";

describe("table writer lookup", () => {
  it("resolves confirmed producers from a writer catalog", () => {
    const root = mkdtempSync(join(tmpdir(), "table-writer-lookup-"));
    const handle = openWriterCatalog(join(root, "writer-catalog.sqlite"));
    upsertTaskWriters(handle, {
      taskId: "144127",
      taskCategory: "sparkIndex",
      taskContentHash: "task-hash",
      factsManifestSha256: "manifest-hash",
      factsStatus: "SUCCESS",
      writes: catalogWritersFromDatasetIo({
        taskId: "144127",
        taskCategory: "sparkIndex",
        records: [
          {
            task_id: "144127",
            direction: "WRITE",
            dataset_id: "ds",
            physical_dataset: "demo.target",
            provenance: "SQL_PARSE",
            resolution_status: "RESOLVED",
            write_observation_id: "write-observation:144127:0",
            write_kind: "INSERT_OVERWRITE",
            field_producing: true,
          },
        ],
      }),
    });

    const lookup = resolveWriterLookup({ writerCatalog: handle });
    expect(lookup?.kind).toBe("catalog");
    const edges = lookupConfirmedProducersFor(lookup!, {
      platform: "hive",
      dataSource: "gfhive",
      qualifiedName: "demo.target",
    });
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      taskId: "144127",
      taskContentHash: "task-hash",
      table: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "demo.target",
      },
    });
    expect(edges[0]?.writes[0]).toMatchObject({
      dataPathRole: "PRODUCER",
      sqlWriteKind: "INSERT_OVERWRITE",
    });
    const meta = writerLookupMeta(lookup!);
    expect(meta.status).toBe("VALID_SUCCESS");
    expect(meta.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(meta.inputFingerprint).toBeNull();
  });
});
