import {
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  repairInputPackPartials,
} from "../scripts/input/mainline/repair-input-pack-partials.ts";
import {
  writeTableInput,
  type TableEvidence,
} from "../scripts/input/shared/input-pack.ts";
import { writeHoraeTaskTypeCache } from "../scripts/reconcile/consumer/one-hop/schedule-evidence-cache.ts";

function fixture(
  taskIds: readonly string[],
  taskType = "exeSql",
): { readonly dataRoot: string; readonly cacheRoot: string; readonly inventoryPath: string } {
  const dataRoot = mkdtempSync(join(tmpdir(), "partial-repair-data-"));
  const cacheRoot = mkdtempSync(join(tmpdir(), "partial-repair-cache-"));
  for (const taskId of taskIds)
    writeHoraeTaskTypeCache(
      taskId,
      "2026-09-03T00:00:00.000Z",
      {
        id: taskId,
        taskType,
        name: `${taskId}.task`,
        targetTable: `${taskId}.target_table`,
        querySql: `INSERT OVERWRITE TABLE ${taskId}.target_table SELECT 1`,
      },
      cacheRoot,
    );
  const inventoryPath = join(dataRoot, "inventory.json");
  writeFileSync(
    inventoryPath,
    JSON.stringify({
      artifactType: "INPUT_PACK_PARTIAL_INVENTORY",
      rows: taskIds.map((taskId) => ({ taskId, taskCategory: taskType })),
    }),
    "utf8",
  );
  return { dataRoot, cacheRoot, inventoryPath };
}

function tableEvidence(
  qualifiedName: string,
  dataSource = "gfhive",
): TableEvidence {
  return {
    guid: `guid-${qualifiedName}`,
    platform: dataSource === "gfhive" ? "hive" : "oracle",
    dataSource,
    qualifiedName,
    schema: qualifiedName.split(".")[0],
    name: qualifiedName.split(".")[1],
    objectType: "hive_table",
    partitionFields: [],
    ddl: `CREATE TABLE ${qualifiedName} (ID INT)`,
    evidenceProvider: "opencli:szdata table+table-ddl",
  };
}

describe("repair input-pack partials", () => {
  it("records a local table hit without calling the online lookup", async () => {
    const paths = fixture(["local1"]);
    writeTableInput(paths.dataRoot, tableEvidence("local1.target_table"));
    let calls = 0;
    const summary = await repairInputPackPartials({
      ...paths,
      manifestPath: join(paths.dataRoot, "manifest.jsonl"),
      catalog: { horaeDatasource: undefined },
      tableLookup: () => {
        calls += 1;
        return undefined;
      },
    });
    expect(summary).toMatchObject({
      taskCount: 1,
      tableResolvedLocal: 1,
      tableRepairedOnline: 0,
      tableFailures: 0,
    });
    expect(calls).toBe(0);
    expect(readFileSync(summary.manifestPath, "utf8")).toContain('"route":"LOCAL"');
  });

  it("uses an exact online fallback, writes Table Pack evidence, and is idempotent", async () => {
    const paths = fixture(["online1"]);
    const manifestPath = join(paths.dataRoot, "manifest.jsonl");
    const lookup = (qualifiedName: string): TableEvidence | undefined =>
      tableEvidence(qualifiedName);
    const first = await repairInputPackPartials({
      ...paths,
      manifestPath,
      allowOnlineBackup: true,
      catalog: { horaeDatasource: undefined },
      tableLookup: lookup,
    });
    expect(first).toMatchObject({
      tableResolvedLocal: 0,
      tableRepairedOnline: 1,
      tableFailures: 0,
    });
    expect(existsSync(join(paths.dataRoot, "tables", "hive"))).toBe(true);
    const second = await repairInputPackPartials({
      ...paths,
      manifestPath,
      allowOnlineBackup: true,
      catalog: { horaeDatasource: undefined },
      tableLookup: lookup,
    });
    expect(second).toMatchObject({
      tableResolvedLocal: 1,
      tableRepairedOnline: 0,
      tableFailures: 0,
    });
  });

  it("does not call the online table lookup when backup is disabled", async () => {
    const paths = fixture(["offline1"]);
    let calls = 0;
    const summary = await repairInputPackPartials({
      ...paths,
      manifestPath: join(paths.dataRoot, "manifest.jsonl"),
      catalog: { horaeDatasource: undefined },
      tableLookup: () => {
        calls += 1;
        throw new Error("online lookup must not run");
      },
    });
    expect(summary).toMatchObject({
      taskCount: 1,
      tableResolvedLocal: 0,
      tableRepairedOnline: 0,
      tableFailures: 1,
    });
    expect(calls).toBe(0);
    expect(readFileSync(summary.manifestPath, "utf8")).toContain(
      '"failureClass":"ONLINE_BACKUP_DISABLED"',
    );
  });

  it("keeps exact failures explicit and restricts the workset to requested task IDs", async () => {
    const paths = fixture(["good1", "excluded1"]);
    const manifestPath = join(paths.dataRoot, "manifest.jsonl");
    const summary = await repairInputPackPartials({
      ...paths,
      taskIds: ["good1"],
      manifestPath,
      allowOnlineBackup: true,
      catalog: { horaeDatasource: undefined },
      tableLookup: () => {
        throw new Error("403 Forbidden");
      },
    });
    expect(summary).toMatchObject({ taskCount: 1, tableFailures: 1 });
    const manifest = readFileSync(manifestPath, "utf8");
    expect(manifest).toContain('"taskId":"good1"');
    expect(manifest).not.toContain("excluded1");
    expect(manifest).toContain('"failureClass":"UPSTREAM_403"');
  });

  it("reuses an exact online result across tasks with the same table identity", async () => {
    const paths = fixture(["memo1", "memo2"]);
    for (const taskId of ["memo1", "memo2"])
      writeHoraeTaskTypeCache(
        taskId,
        "2026-09-03T00:00:00.000Z",
        {
          id: taskId,
          taskType: "exeSql",
          name: `${taskId}.task`,
          targetTable: "shared.target_table",
          querySql: "INSERT OVERWRITE TABLE shared.target_table SELECT 1",
        },
        paths.cacheRoot,
      );
    let calls = 0;
    const summary = await repairInputPackPartials({
      ...paths,
      manifestPath: join(paths.dataRoot, "manifest.jsonl"),
      allowOnlineBackup: true,
      catalog: { horaeDatasource: undefined },
      tableLookup: (qualifiedName) => {
        calls += 1;
        return tableEvidence(qualifiedName);
      },
    });
    expect(summary).toMatchObject({
      taskCount: 2,
      tableRepairedOnline: 2,
      tableFailures: 0,
    });
    expect(calls).toBe(1);
  });

  it("can run a table-only pass without backfilling category log evidence", async () => {
    const paths = fixture(["table-only1"], "oracle2hive");
    let calls = 0;
    const summary = await repairInputPackPartials({
      ...paths,
      tableOnly: true,
      allowOnlineBackup: true,
      manifestPath: join(paths.dataRoot, "manifest.jsonl"),
      catalog: { horaeDatasource: undefined },
      tableLookup: (qualifiedName) => {
        calls += 1;
        return tableEvidence(qualifiedName);
      },
    });
    expect(summary.taskCount).toBe(1);
    expect(summary.tableRepairedOnline).toBeGreaterThan(0);
    expect(calls).toBeGreaterThan(0);
    expect(readFileSync(summary.manifestPath, "utf8")).not.toContain(
      '"evidenceKind":"HIVE_DDL"',
    );
  });
});
