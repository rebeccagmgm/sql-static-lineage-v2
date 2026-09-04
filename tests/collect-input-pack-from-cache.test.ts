import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { collectInputPackFromCache } from "../scripts/input/mainline/collect-input-pack-from-cache.ts";
import { writeHiveTaskSqlCache } from "../scripts/input/mainline/hive-task-sql-cache.ts";
import { writeSzdataScheduleDetailCache } from "../scripts/input/mainline/szdata-schedule-detail-cache.ts";
import { writeHoraeTaskTypeCache } from "../scripts/reconcile/consumer/one-hop/schedule-evidence-cache.ts";
import { writeTaskInput } from "../scripts/input/shared/input-pack.ts";

const observedAt = "2026-09-02T00:00:00.000Z";

function writeJsonl(dir: string, name: string, lines: readonly unknown[]): string {
  const path = join(dir, name);
  writeFileSync(
    path,
    lines.length === 0
      ? ""
      : `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
    "utf8",
  );
  return path;
}

function fixtureRoots() {
  const dataRoot = mkdtempSync(join(tmpdir(), "from-cache-data-"));
  const cacheRoot = mkdtempSync(join(tmpdir(), "from-cache-cache-"));
  const catalogDir = mkdtempSync(join(tmpdir(), "from-cache-jsonl-"));
  return {
    dataRoot,
    cacheRoot,
    hiveMetadataPath: writeJsonl(catalogDir, "hive-meta.jsonl", [
      {
        guid: "cd47666f-573f-44df-a106-b60fb73096e2",
        qualifiedname_clean: "odata_n_uip.q_md_institution",
        datasource: "gfhive",
        status: "ACTIVE",
        type_name: "hive_table",
      },
    ]),
    hiveDdlPath: writeJsonl(catalogDir, "hive-ddl.jsonl", [
      {
        qualifiedname: "odata_n_uip.q_md_institution@gfhive:1",
        querytext:
          "CREATE TABLE odata_n_uip.q_md_institution (party_id string) COMMENT '机构主表' PARTITIONED BY (busi_date string)",
      },
    ]),
    rdbmsCorePath: writeJsonl(catalogDir, "rdbms-core.jsonl", [
      {
        qualifiedname:
          "TITANS_TRADEFLOW.TRANS_SMT_ATP_T_REPORT@gforacle_gftzdb#gftzdb",
        type_name: "gf_rdbms_table",
      },
    ]),
    rdbmsDdlPath: writeJsonl(catalogDir, "rdbms-ddl.jsonl", [
      {
        qualifiedname:
          "TITANS_TRADEFLOW.TRANS_SMT_ATP_T_REPORT@gforacle_gftzdb#gftzdb",
        ddl: 'CREATE TABLE "TITANS_TRADEFLOW"."TRANS_SMT_ATP_T_REPORT" ("ID" NUMBER)',
      },
    ]),
  };
}

function collect(
  roots: ReturnType<typeof fixtureRoots>,
  taskIds: readonly string[],
  extra: { force?: boolean } = {},
) {
  return collectInputPackFromCache({
    ...roots,
    taskIds,
    force: extra.force,
    now: () => new Date(observedAt),
  });
}

describe("collect input pack from cache", () => {
  it("writes mysql2hive task and hive table from name-matched ddl", () => {
    const roots = fixtureRoots();
    writeHoraeTaskTypeCache(
      "62190",
      observedAt,
      {
        id: "62190",
        taskType: "mysql2hive",
        name: "odata_n_uip.q_md_institution_f",
        source: "mysql_uip_datayes",
        querySql: "select party_id from md_institution",
        syncInfo: {
          hiveDb: "odata_n_uip",
          hiveTable: "q_md_institution",
          hivePartition: "${YYYY-MM-DD}",
          querySql: "select party_id from md_institution",
          targetTable: "odata_n_uip.q_md_institution",
          sourceServer: "mysql_uip_datayes",
        },
      },
      roots.cacheRoot,
    );
    const [summary] = collect(roots, ["62190"]);
    expect(summary?.collectionStatus).toBe("SUCCESS");
    expect(summary?.tablesWritten).toBe(1);
    const taskPath = join(
      roots.dataRoot,
      "tasks",
      "mysql2hive",
      "62190",
      "task.json",
    );
    expect(existsSync(taskPath)).toBe(true);
    const task = JSON.parse(readFileSync(taskPath, "utf8")) as {
      evidenceProvider: string;
      source: string;
      target: { platform: string; qualifiedName: string; dataSource: string };
      partition: Record<string, string>;
    };
    expect(task.evidenceProvider).toContain("local:schedule-evidence");
    expect(task.source).toBe("mysql_uip_datayes");
    expect(task.target).toEqual({
      platform: "hive",
      qualifiedName: "odata_n_uip.q_md_institution",
      dataSource: "gfhive",
    });
    expect(task.partition).toEqual({ busi_date: "${YYYY-MM-DD}" });
    const table = JSON.parse(
      readFileSync(
        join(
          roots.dataRoot,
          "tables",
          "hive",
          "odata_n_uip.q_md_institution__gfhive",
          "table.json",
        ),
        "utf8",
      ),
    ) as {
      guid?: string;
      description?: string;
      partitionFields?: string[];
    };
    expect(table.guid).toBeUndefined();
    expect(table.description).toBe("机构主表");
    expect(table.partitionFields).toEqual(["busi_date"]);
  });

  it("writes hive2oracle identity as PARTIAL when query is missing", () => {
    const roots = fixtureRoots();
    writeHoraeTaskTypeCache(
      "180065",
      observedAt,
      {
        id: "180065",
        taskType: "hive2oracle",
        hiveDb: "dm_otc_n",
        hivePartition: "${YYYY-MM-DD}",
        syncInfo: {
          hiveDb: "dm_otc_n",
          hiveTable: "trd_sso_exch_scr_mtch_day",
          loadMode: "append",
          targetTable: "TITANS_TRADEFLOW.TRANS_SMT_ATP_T_REPORT",
        },
      },
      roots.cacheRoot,
    );
    writeSzdataScheduleDetailCache(
      "180065",
      observedAt,
      {
        taskId: "180065",
        taskType: "24",
        taskName: "TITANS_TRADEFLOW.TRANS_SMT_ATP_T_REPORT",
        topicName: "DM_OTC_N",
        status: "Y",
        insertMode: "append",
        targetTable:
          "TITANS_TRADEFLOW.TRANS_SMT_ATP_T_REPORT@gforacle_gftzdb#gftzdb",
        truncateSql:
          "delete from TITANS_TRADEFLOW.TRANS_SMT_ATP_T_REPORT where TRADE_DATE = to_date('${yyyy-MM-dd}', 'yyyy-MM-dd');",
      },
      roots.cacheRoot,
    );
    const [summary] = collect(roots, ["180065"]);
    expect(summary?.collectionStatus).toBe("PARTIAL");
    expect(summary?.reason ?? "").not.toMatch(/OPENCLI|opencli/i);
    expect(
      existsSync(
        join(
          roots.dataRoot,
          "tables",
          "oracle",
          "TITANS_TRADEFLOW.TRANS_SMT_ATP_T_REPORT__gforacle_gftzdb#gftzdb",
          "ddl.sql",
        ),
      ),
    ).toBe(true);
    expect(
      existsSync(
        join(roots.dataRoot, "tasks", "hive2oracle", "180065", "task.json"),
      ),
    ).toBe(true);
  });

  it("writes sparkIndex create, query, and prepare when create only lives in prepareSql", () => {
    const roots = fixtureRoots();
    const create =
      "CREATE TABLE IF NOT EXISTS dm_index_n.index_grp_assm_trust_auth_end_date( grp_id STRING ) COMMENT '失效日期' PARTITIONED BY ( busi_date STRING, tag_id STRING ) STORED AS ORC;";
    writeSzdataScheduleDetailCache(
      "100931",
      observedAt,
      {
        taskId: "100931",
        taskType: "64",
        taskName: "dm_index_n.index_grp_assm_trust_auth_end_date",
        topicName: "DM_INDEX_N",
        status: "Y",
        targetTable: "dm_index_n.index_grp_assm_trust_auth_end_date",
        insertMode: "overwrite",
        prepareSql: `${create}\nALTER TABLE dm_index_n.index_grp_assm_trust_auth_end_date DROP IF EXISTS PARTITION (busi_date='\${YYYY-MM-DD}' );`,
        querySql: "SELECT 1 AS grp_id",
      },
      roots.cacheRoot,
    );
    const [summary] = collect(roots, ["100931"]);
    expect(summary?.collectionStatus).toBe("SUCCESS");
    const directory = join(roots.dataRoot, "tasks", "sparkIndex", "100931");
    const task = JSON.parse(readFileSync(join(directory, "task.json"), "utf8")) as {
      sqlFiles: { slot: string }[];
    };
    expect(task.sqlFiles.map((file) => file.slot)).toEqual([
      "create",
      "query",
      "prepare",
    ]);
    expect(readFileSync(join(directory, "sql", "create.sql"), "utf8")).toContain(
      "CREATE TABLE IF NOT EXISTS",
    );
    expect(readFileSync(join(directory, "sql", "prepare.sql"), "utf8")).toContain(
      "ALTER TABLE",
    );
  });

  it("writes hiveTask create and query plus the CREATE table pack", () => {
    const roots = fixtureRoots();
    writeHoraeTaskTypeCache(
      "100078",
      observedAt,
      {
        id: "100078",
        taskType: "hiveTask",
        hiveDb: "pdata_n",
        name: "财务预算调整申请事件",
      },
      roots.cacheRoot,
    );
    writeSzdataScheduleDetailCache(
      "100078",
      observedAt,
      {
        taskId: "100078",
        taskType: "59",
        taskName: "PDATA_N.T05_FIN_BDGT_ADJ_APP_EVT_HBM002",
        topicName: "EDW_EVT",
        status: "Y",
        database: "pdata_n",
      },
      roots.cacheRoot,
    );
    writeHiveTaskSqlCache(
      "100078",
      observedAt,
      {
        source: "LOCAL_CODE",
        sqlStatus: "AVAILABLE",
        scriptPath: "EVT/demo.py",
        hiveDb: "pdata_n",
        createSql: `CREATE TABLE IF NOT EXISTS T05_FIN_BDGT_ADJ_APP_EVT(
    Evt_Id STRING
)COMMENT '财务预算调整申请事件'
PARTITIONED BY (SRC_TBL STRING, BUSI_DATE STRING)
STORED AS ORC;

INSERT OVERWRITE TABLE T05_FIN_BDGT_ADJ_APP_EVT PARTITION(SRC_TBL='\${src_table}',BUSI_DATE='\${data_day_str}')
SELECT 1;`,
        querySql: null,
      },
      roots.cacheRoot,
    );
    const [summary] = collect(roots, ["100078"]);
    expect(summary?.collectionStatus).toBe("SUCCESS");
    const directory = join(roots.dataRoot, "tasks", "hiveTask", "100078");
    const task = JSON.parse(readFileSync(join(directory, "task.json"), "utf8")) as {
      sqlFiles: { slot: string }[];
      target: { qualifiedName: string; platform: string; dataSource: string };
      targetEvidenceKind?: string;
    };
    expect(task.sqlFiles.map((file) => file.slot)).toEqual(["create", "query"]);
    expect(task.target).toEqual({
      platform: "hive",
      qualifiedName: "pdata_n.t05_fin_bdgt_adj_app_evt",
      dataSource: "gfhive",
    });
    expect(task.targetEvidenceKind).toBeUndefined();
    expect(
      existsSync(
        join(
          roots.dataRoot,
          "tables",
          "hive",
          "pdata_n.t05_fin_bdgt_adj_app_evt__gfhive",
          "table.json",
        ),
      ),
    ).toBe(true);
  });

  it("skips an existing valid pack and does not overwrite", () => {
    const roots = fixtureRoots();
    writeHoraeTaskTypeCache(
      "62190",
      observedAt,
      {
        id: "62190",
        taskType: "mysql2hive",
        name: "odata_n_uip.q_md_institution_f",
        source: "mysql_uip_datayes",
        querySql: "select party_id from md_institution",
        syncInfo: {
          hiveDb: "odata_n_uip",
          hiveTable: "q_md_institution",
          targetTable: "odata_n_uip.q_md_institution",
        },
      },
      roots.cacheRoot,
    );
    expect(collect(roots, ["62190"])[0]?.collectionStatus).toBe("SUCCESS");
    const second = collect(roots, ["62190"]);
    expect(second[0]).toMatchObject({
      collectionStatus: "SKIPPED",
      reason: "EXISTING_VALID_PACK",
    });
  });

  it("excludes tasks missing both identity caches", () => {
    const roots = fixtureRoots();
    const [summary] = collect(roots, ["404"]);
    expect(summary).toMatchObject({
      collectionStatus: "EXCLUDED",
      reason: "HORAE_TASK_NOT_FOUND",
    });
  });

  it("excludes frozen tasks without materializing them in the main root", () => {
    const roots = fixtureRoots();
    writeTaskInput(roots.dataRoot, {
      taskId: "67485",
      taskCategory: "hiveTask",
      evidenceProvider: "fixture:frozen-task",
    });
    writeSzdataScheduleDetailCache(
      "67485",
      observedAt,
      {
        taskId: "67485",
        taskType: "59",
        taskName: "hold_inc_fin_cnt",
        status: "F",
      },
      roots.cacheRoot,
    );

    const [summary] = collect(roots, ["67485"]);

    expect(summary).toMatchObject({
      collectionStatus: "EXCLUDED",
      reason: "MANUAL_OR_FROZEN",
    });
    expect(
      existsSync(join(roots.dataRoot, "tasks", "hiveTask", "67485")),
    ).toBe(false);
    expect(
      existsSync(
        join(
          `${roots.dataRoot}.manual-tasks`,
          "tasks",
          "hiveTask",
          "67485",
          "task.json",
        ),
      ),
    ).toBe(true);
    const status = JSON.parse(
      readFileSync(`${roots.dataRoot}.input-pack-status.json`, "utf8"),
    ) as { tasks: Record<string, { status: string; exclusionReason?: string }> };
    expect(status.tasks["67485"]).toMatchObject({
      status: "EXCLUDED",
      exclusionReason: "MANUAL_OR_FROZEN",
    });
  });
});
