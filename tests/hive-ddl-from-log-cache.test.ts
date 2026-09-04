import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  extractHiveDdlFromHoraeLog,
  parseHiveDdlFromLogCache,
  writeHiveDdlFromLogCache,
} from "../scripts/input/mainline/hive-ddl-from-log-cache.ts";
import { fillHiveDdlFromLogCache } from "../scripts/input/mainline/fill-hive-ddl-from-log-cache.ts";
import {
  bucketCollectSummary,
  inventoryPartialGapsFromSummaries,
  inventoryPartialGapsFromSummaryFiles,
  parseCollectSummaryLine,
  selectHiveDdlLogHealCandidates,
} from "../scripts/input/shared/partial-gap-from-summaries.ts";
import { HIVE_DDL_FROM_LOG_TASK_TYPES } from "../scripts/input/mainline/fill-hive-ddl-from-log-cache.ts";
import { parseHealHiveTargetDdlFromLogArgs } from "../scripts/input/mainline/heal-hive-target-ddl-from-log.ts";
import { assembleCacheTaskEvidence } from "../scripts/input/shared/cache-task-evidence.ts";
import { writeHoraeTaskTypeCache } from "../scripts/reconcile/consumer/one-hop/schedule-evidence-cache.ts";

const SAMPLE_LOG = `[2026-08-27 23:26:28]-[INFO] [t1, main, HiveAssistant] Process hive ddl:
"USE odata_ygt;
 CREATE EXTERNAL TABLE IF NOT EXISTS odata_ygt.nygt_t_coverstockjour
(
\`busi_date\` string, 
\`init_date\` double, 
\`serial_no\` double, 
\`data_time\` string
); 
"
[INFO] [08-27 23:26:30] [t1, main, HiveAssistant] Hive DDL finished in 2224ms, exit value=0
`;

describe("hive-ddl-from-log-cache", () => {
  it("extracts CREATE EXTERNAL TABLE from AnyLoader Process hive ddl block", () => {
    const extracted = extractHiveDdlFromHoraeLog(SAMPLE_LOG);
    expect(extracted.qualifiedName).toBe("odata_ygt.nygt_t_coverstockjour");
    expect(extracted.hiveDb).toBe("odata_ygt");
    expect(extracted.createSql).toMatch(
      /CREATE\s+EXTERNAL\s+TABLE\s+IF\s+NOT\s+EXISTS\s+odata_ygt\.nygt_t_coverstockjour/i,
    );
    expect(extracted.createSql).toMatch(/`busi_date`\s+string/i);
    expect(extracted.createSql?.trim().endsWith(";")).toBe(true);
  });

  it("round-trips AVAILABLE cache and feeds assembleToHive create slot", () => {
    const cacheRoot = mkdtempSync(join(tmpdir(), "hive-ddl-log-"));
    writeHiveDdlFromLogCache(
      "68",
      "2026-09-02T00:00:00.000Z",
      {
        source: "HORAE_LOG",
        ddlStatus: "AVAILABLE",
        dataDate: "2026-08-27",
        createSql: extractHiveDdlFromHoraeLog(SAMPLE_LOG).createSql,
        qualifiedName: "odata_ygt.nygt_t_coverstockjour",
        hiveDb: "odata_ygt",
        hiveTable: "nygt_t_coverstockjour",
      },
      cacheRoot,
    );
    const parsed = parseHiveDdlFromLogCache("68", cacheRoot);
    expect(parsed.status).toBe("HIT");
    if (parsed.status !== "HIT") return;
    expect(parsed.evidence.ddlStatus).toBe("AVAILABLE");
    expect(parsed.evidence.createSql).toContain("nygt_t_coverstockjour");

    writeHoraeTaskTypeCache(
      "68",
      "2026-09-02T00:00:00.000Z",
      {
        id: "68",
        taskType: "oracle2hive",
        name: "odata_ygt.nygt_t_coverstockjour",
        source: "oracle_rbjygl_85.236",
        querySql:
          "SELECT BUSI_DATE, INIT_DATE FROM HS_OPT.COVERSTOCKJOUR",
        syncInfo: {
          hiveDb: "odata_ygt",
          hiveTable: "nygt_t_coverstockjour",
          targetTable: "odata_ygt.nygt_t_coverstockjour",
          sourceServer: "oracle_rbjygl_85.236",
          querySql:
            "SELECT BUSI_DATE, INIT_DATE FROM HS_OPT.COVERSTOCKJOUR",
        },
      },
      cacheRoot,
    );
    const assembled = assembleCacheTaskEvidence("68", cacheRoot);
    expect(assembled.kind).toBe("EVIDENCE");
    if (assembled.kind !== "EVIDENCE") return;
    expect(assembled.cacheArtifacts).toContain("hive-target-ddl.sql");
    const create = assembled.evidence.sql?.create;
    expect(create && typeof create !== "string" ? create.content : undefined).toMatch(
      /CREATE\s+EXTERNAL\s+TABLE/i,
    );
    expect(create && typeof create !== "string" ? create.evidenceProvider : undefined).toContain(
      "hive-target-ddl",
    );
  });

  it("fillHiveDdlFromLogCache writes from logRunner without OpenCLI", async () => {
    const cacheRoot = mkdtempSync(join(tmpdir(), "hive-ddl-fill-"));
    const summary = await fillHiveDdlFromLogCache({
      cacheRoot,
      taskIds: ["68"],
      dataDate: "2026-08-27",
      minIntervalMs: 0,
      logRunner: async () => SAMPLE_LOG,
    });
    expect(summary).toMatchObject({
      total: 1,
      cached: 1,
      empty: 0,
      errors: 0,
    });
    const parsed = parseHiveDdlFromLogCache("68", cacheRoot);
    expect(parsed.status).toBe("HIT");
    if (parsed.status !== "HIT") return;
    expect(parsed.evidence.createSql).toContain("busi_date");
  });

  it("force retries unavailable cache and safely overwrites it", async () => {
    const cacheRoot = mkdtempSync(join(tmpdir(), "hive-ddl-force-"));
    writeHiveDdlFromLogCache(
      "68",
      "2026-09-02T00:00:00.000Z",
      {
        source: "HORAE_LOG",
        ddlStatus: "UNAVAILABLE",
        dataDate: "2026-08-27",
        createSql: null,
        qualifiedName: null,
        hiveDb: null,
        hiveTable: null,
      },
      cacheRoot,
    );

    const missing = await fillHiveDdlFromLogCache({
      cacheRoot,
      taskIds: ["68"],
      dataDate: "2026-08-27",
      minIntervalMs: 0,
      force: true,
      logRunner: () => {
        throw new Error("HORAE_LOG_INSTANCE_MISSING:68:2026-08-27");
      },
    });
    expect(missing).toMatchObject({ total: 1, cached: 0, empty: 1, errors: 0 });

    const recovered = await fillHiveDdlFromLogCache({
      cacheRoot,
      taskIds: ["68"],
      dataDate: "2026-08-27",
      minIntervalMs: 0,
      force: true,
      logRunner: () => SAMPLE_LOG,
    });
    expect(recovered).toMatchObject({ total: 1, cached: 1, empty: 0, errors: 0 });
    const parsed = parseHiveDdlFromLogCache("68", cacheRoot);
    expect(parsed.status).toBe("HIT");
    if (parsed.status !== "HIT") return;
    expect(parsed.evidence.ddlStatus).toBe("AVAILABLE");
    expect(parsed.evidence.createSql).toContain("busi_date");
  });
});

describe("partial-gap-from-summaries", () => {
  it("buckets ONLY_HIVE_TARGET_GAP from summaries.jsonl", () => {
    const dir = mkdtempSync(join(tmpdir(), "partial-gap-"));
    const path = join(dir, "summaries.jsonl");
    writeFileSync(
      path,
      [
        JSON.stringify({
          taskId: "68",
          collectionStatus: "PARTIAL",
          warnings: ["odata_ygt.nygt_t_coverstockjour:TABLE_JSONL_MISS"],
        }),
        JSON.stringify({
          taskId: "124",
          collectionStatus: "PARTIAL",
          warnings: [
            "CRMII.TAPP_CHANNELTYPE:RDBMS_CORE_AMBIGUOUS",
            "odata_jgj.jgj_c_tapp_channeltype:TABLE_JSONL_MISS",
          ],
        }),
        JSON.stringify({
          taskId: "1",
          collectionStatus: "SUCCESS",
          warnings: [],
        }),
      ].join("\n"),
      "utf8",
    );
    const inventory = inventoryPartialGapsFromSummaries(path);
    expect(inventory.byBucket.get("ONLY_HIVE_TARGET_GAP")).toEqual(["68"]);
    expect(inventory.byBucket.get("HAS_AMBIGUOUS")).toEqual(["124"]);
    expect(inventory.byBucket.get("SUCCESS")).toEqual(["1"]);
    expect(
      bucketCollectSummary(parseCollectSummaryLine(readFileSync(path, "utf8").split("\n")[0]!)!),
    ).toBe("ONLY_HIVE_TARGET_GAP");
  });

  it("merges multiple summaries and selects *2hive heal candidates", () => {
    const dir = mkdtempSync(join(tmpdir(), "partial-gap-merge-"));
    const a = join(dir, "a.jsonl");
    const b = join(dir, "b.jsonl");
    writeFileSync(
      a,
      [
        JSON.stringify({
          taskId: "100",
          collectionStatus: "PARTIAL",
          taskCategory: "mysql2hive",
          warnings: ["odata_n_uip.t1:HIVE_DDL_MISS"],
        }),
        JSON.stringify({
          taskId: "200",
          collectionStatus: "PARTIAL",
          taskCategory: "hiveTask",
          warnings: ["pdata_n.t2:HIVE_DDL_MISS"],
        }),
      ].join("\n"),
      "utf8",
    );
    writeFileSync(
      b,
      JSON.stringify({
        taskId: "100",
        collectionStatus: "SUCCESS",
        taskCategory: "mysql2hive",
        warnings: [],
      }) + "\n",
      "utf8",
    );
    const inventory = inventoryPartialGapsFromSummaryFiles([a, b]);
    expect(inventory.byBucket.get("SUCCESS")).toEqual(["100"]);
    expect(inventory.byBucket.get("ONLY_HIVE_TARGET_GAP")).toEqual(["200"]);

    const beforeForce = inventoryPartialGapsFromSummaryFiles([a]);
    const selection = selectHiveDdlLogHealCandidates(
      beforeForce.rows,
      HIVE_DDL_FROM_LOG_TASK_TYPES,
    );
    expect(selection.eligibleIds).toEqual(["100"]);
    expect(selection.skippedIds).toEqual(["200"]);
    expect(selection.eligibleByCategory).toEqual({ mysql2hive: 1 });
    expect(selection.skippedByCategory).toEqual({ hiveTask: 1 });

    // cold RDBMS TABLE_JSONL_MISS on *2hive is not a log-DDL heal target
    const cold = selectHiveDdlLogHealCandidates(
      [
        {
          taskId: "557",
          collectionStatus: "PARTIAL",
          taskCategory: "oracle2hive",
          warnings: ["KDBASE.T_YGZCY:TABLE_JSONL_MISS"],
        },
      ],
      HIVE_DDL_FROM_LOG_TASK_TYPES,
    );
    expect(cold.eligibleIds).toEqual([]);
    expect(cold.skippedIds).toEqual(["557"]);
  });
});

describe("heal-hive-target-ddl-from-log args", () => {
  it("parses repeated --from-summaries and dry-run", () => {
    const parsed = parseHealHiveTargetDdlFromLogArgs([
      "node",
      "heal-hive-target-ddl-from-log.ts",
      "--data-root",
      "D:\\data",
      "--from-summaries",
      "a.jsonl,b.jsonl",
      "--from-summaries",
      "c.jsonl",
      "--dry-run",
      "--data-date",
      "2026-08-27",
    ]);
    expect(parsed.dataRoot).toBe("D:\\data");
    expect(parsed.summariesPaths).toEqual(["a.jsonl", "b.jsonl", "c.jsonl"]);
    expect(parsed.dryRun).toBe(true);
    expect(parsed.dataDate).toBe("2026-08-27");
  });
});
