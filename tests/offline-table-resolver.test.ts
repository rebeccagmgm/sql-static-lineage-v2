import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  extractOfflineTableCandidates,
  loadOfflineTableCatalog,
  parsePhysicalTableName,
  platformFromDataSource,
  resolveOfflineTables,
} from "../scripts/input/shared/offline-table-resolver.ts";
import {
  isKnownHoraeDatasourceLabel,
  loadHoraeDatasourceIndex,
  preferredRdbmsDataSourceFromTaskSource,
} from "../scripts/input/shared/horae-datasource-cache.ts";
import { writeTableInput, type TaskEvidence } from "../scripts/input/shared/input-pack.ts";

function writeJsonl(dir: string, name: string, lines: readonly unknown[]): string {
  const path = join(dir, name);
  writeFileSync(
    path,
    `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
    "utf8",
  );
  return path;
}

function task(overrides: Partial<TaskEvidence> = {}): TaskEvidence {
  return {
    taskId: "100931",
    taskCategory: "sparkIndex",
    target: "dm_index_n.hold_tag_relation",
    sql: {
      query: "SELECT id FROM dm_index_n.hold_tag_relation",
    },
    ...overrides,
  };
}

describe("offline table name helpers", () => {
  it("strips hive ddl timestamp from dataSource", () => {
    expect(
      parsePhysicalTableName(
        "dm_index_n.hold_tag_relation@gfhive:1739783191128",
      ),
    ).toEqual({
      qualifiedName: "dm_index_n.hold_tag_relation",
      dataSource: "gfhive",
    });
  });

  it("maps gfhive and oracle prefixes", () => {
    expect(platformFromDataSource("gfhive")).toBe("hive");
    expect(platformFromDataSource("gforacle_gftzdb#gftzdb")).toBe("oracle");
  });

  it("skips *2hive source datasource labels as table candidates", () => {
    const names = extractOfflineTableCandidates(
      task({
        taskId: "68",
        taskCategory: "oracle2hive",
        source: "oracle_rbjygl_85.236",
        target: "odata_ygt.nygt_t_coverstockjour",
        sql: {
          query:
            "SELECT 1 FROM HS_OPT.COVERSTOCKJOUR WHERE INIT_DATE = '${YYYY-MM-DD}'",
        },
      }),
    ).map((item) => item.qualifiedName.toLowerCase());
    expect(names).toContain("odata_ygt.nygt_t_coverstockjour");
    expect(names).toContain("hs_opt.coverstockjour");
    expect(names).not.toContain("oracle_rbjygl_85.236");
  });

  it("still includes source table candidates for non-*2hive tasks", () => {
    const names = extractOfflineTableCandidates(
      task({
        taskCategory: "hive2oracle",
        source: "pdata_n.some_src",
        target: "HS_USER.STKCODE",
        sql: { query: "SELECT 1 FROM pdata_n.some_src" },
      }),
    ).map((item) => item.qualifiedName.toLowerCase());
    expect(names).toContain("pdata_n.some_src");
  });

  it("filters only a unique exact datasource label and keeps unknown physical values", () => {
    const horaeDatasource = {
      byServerTag: new Map([
        [
          "oracle_known_1",
          {
            serverTag: "oracle_known_1",
            serverType: "oracle",
            service: "known",
          },
        ],
      ]),
    };
    const known = extractOfflineTableCandidates(
      task({
        taskCategory: "oracle2hive",
        source: "oracle_known_1",
        target: "odata.target",
        sql: { query: "SELECT 1 FROM schema.read_table" },
      }),
      horaeDatasource,
    ).map((item) => item.qualifiedName.toLowerCase());
    expect(known).not.toContain("oracle_known_1");

    const unknownPhysical = extractOfflineTableCandidates(
      task({
        taskCategory: "oracle2hive",
        source: "schema.read_table@gforacle_unknown#unknown",
        target: "odata.target",
        sql: { query: "SELECT 1 FROM schema.read_table" },
      }),
      horaeDatasource,
    );
    expect(unknownPhysical).toContainEqual({
      qualifiedName: "schema.read_table",
      dataSource: "gforacle_unknown#unknown",
    });
  });

  it("marks conflicting Horae server tags ambiguous instead of choosing a row", () => {
    const cacheRoot = mkdtempSync(join(tmpdir(), "horae-datasource-conflict-"));
    const directory = join(cacheRoot, "schedule-evidence", "horae-datasource");
    mkdirSync(directory, { recursive: true });
    writeFileSync(
      join(directory, "rows.jsonl"),
      [
        { server_tag: "oracle_conflict", server_type: "oracle", service: "a" },
        { server_tag: "oracle_conflict", server_type: "oracle", service: "b" },
      ].map((row) => JSON.stringify(row)).join("\n") + "\n",
      "utf8",
    );
    const index = loadHoraeDatasourceIndex(cacheRoot);
    expect(index?.ambiguousServerTags).toEqual(new Set(["oracle_conflict"]));
    expect(isKnownHoraeDatasourceLabel("oracle_conflict", index)).toBe(false);
    expect(preferredRdbmsDataSourceFromTaskSource("oracle_conflict", index)).toBe(
      undefined,
    );
    const mysqlIndex = {
      byServerTag: new Map([
        [
          "mysql_sag_sagg",
          { serverTag: "mysql_sag_sagg", serverType: "mysql", service: "sagg" },
        ],
      ]),
    };
    expect(preferredRdbmsDataSourceFromTaskSource("mysql_sag_sagg", mysqlIndex)).toBe(
      "gfmysql_sagg",
    );
    expect(
      preferredRdbmsDataSourceFromTaskSource("postgres_fxjs_85.234", {
        byServerTag: new Map([
          [
            "postgres_fxjs_85.234",
            {
              serverTag: "postgres_fxjs_85.234",
              serverType: "postgre",
              service: "risk",
            },
          ],
        ]),
      }),
    ).toBe("gfpostgre_risk#risk");
  });
});

describe("RDBMS disambiguation via horae-datasource", () => {
  it("resolves ambiguous Oracle core rows using server_tag → service", () => {
    const dir = mkdtempSync(join(tmpdir(), "offline-rdbms-amb-"));
    const catalog = loadOfflineTableCatalog({
      hiveMetadataPath: writeJsonl(dir, "hive-meta.jsonl", []),
      hiveDdlPath: writeJsonl(dir, "hive-ddl.jsonl", [
        {
          qualifiedname: "odata_ygt.nygt_t_coverstockjour@gfhive",
          querytext:
            "CREATE TABLE odata_ygt.nygt_t_coverstockjour (id string)",
        },
      ]),
      rdbmsCorePath: writeJsonl(dir, "rdbms-core.jsonl", [
        {
          qualifiedname: "HS_OPT.COVERSTOCKJOUR@gforacle_gfufjy2#gfufjy",
          name: "COVERSTOCKJOUR",
          type_name: "gf_rdbms_table",
        },
        {
          qualifiedname: "HS_OPT.COVERSTOCKJOUR@gforacle_jyglrac#jyglrac",
          name: "COVERSTOCKJOUR",
          type_name: "gf_rdbms_table",
        },
      ]),
      rdbmsDdlPath: writeJsonl(dir, "rdbms-ddl.jsonl", [
        {
          qualifiedname: "HS_OPT.COVERSTOCKJOUR@gforacle_gfufjy2#gfufjy",
          ddl: "CREATE TABLE HS_OPT.COVERSTOCKJOUR (ID NUMBER)",
        },
        {
          qualifiedname: "HS_OPT.COVERSTOCKJOUR@gforacle_jyglrac#jyglrac",
          ddl: "CREATE TABLE HS_OPT.COVERSTOCKJOUR (ID NUMBER, X NUMBER)",
        },
      ]),
      horaeDatasource: {
        byServerTag: new Map([
          [
            "oracle_rbjygl_85.236",
            {
              serverTag: "oracle_rbjygl_85.236",
              serverType: "oracle",
              service: "jyglrac",
            },
          ],
        ]),
      },
    });
    const dataRoot = mkdtempSync(join(tmpdir(), "pack-"));
    const resolved = resolveOfflineTables(
      dataRoot,
      task({
        taskId: "68",
        taskCategory: "oracle2hive",
        source: "oracle_rbjygl_85.236",
        target: "odata_ygt.nygt_t_coverstockjour",
        sql: {
          query: "SELECT 1 FROM HS_OPT.COVERSTOCKJOUR",
        },
      }),
      catalog,
      () => new Date("2026-09-02T00:00:00.000Z"),
    );
    expect(resolved.unavailable).toEqual([]);
    const oracle = resolved.resolved.find(
      (item) =>
        item.qualifiedName.toLowerCase() === "hs_opt.coverstockjour",
    );
    expect(oracle?.dataSource?.toLowerCase()).toBe("gforacle_jyglrac#jyglrac");
    expect(oracle?.evidenceProvider).toContain("local:horae-datasource");
  });

  it("resolves ambiguous MySQL core rows via gfmysql_${service} prefix", () => {
    const dir = mkdtempSync(join(tmpdir(), "offline-rdbms-mysql-"));
    const catalog = loadOfflineTableCatalog({
      hiveMetadataPath: writeJsonl(dir, "hive-meta.jsonl", []),
      hiveDdlPath: writeJsonl(dir, "hive-ddl.jsonl", [
        {
          qualifiedname: "odata_sag.s_related_person@gfhive",
          querytext: "CREATE TABLE odata_sag.s_related_person (id string)",
        },
      ]),
      rdbmsCorePath: writeJsonl(dir, "rdbms-core.jsonl", [
        {
          qualifiedname: "sagg.related_person@gfmysql_sagg5",
          name: "related_person",
          type_name: "gf_rdbms_table",
        },
        {
          qualifiedname: "sagg.related_person@gfmysql_sbhf",
          name: "related_person",
          type_name: "gf_rdbms_table",
        },
      ]),
      rdbmsDdlPath: writeJsonl(dir, "rdbms-ddl.jsonl", [
        {
          qualifiedname: "sagg.related_person@gfmysql_sagg5",
          ddl: "CREATE TABLE sagg.related_person (id bigint)",
        },
        {
          qualifiedname: "sagg.related_person@gfmysql_sbhf",
          ddl: "CREATE TABLE sagg.related_person (id bigint)",
        },
      ]),
      horaeDatasource: {
        byServerTag: new Map([
          [
            "mysql_sag_sagg",
            {
              serverTag: "mysql_sag_sagg",
              serverType: "mysql",
              service: "sagg",
            },
          ],
        ]),
      },
    });
    const dataRoot = mkdtempSync(join(tmpdir(), "pack-mysql-"));
    const resolved = resolveOfflineTables(
      dataRoot,
      task({
        taskId: "5439",
        taskCategory: "mysql2hive",
        source: "mysql_sag_sagg",
        target: "odata_sag.s_related_person",
        sql: {
          query: "SELECT 1 FROM sagg.related_person",
        },
      }),
      catalog,
      () => new Date("2026-09-03T00:00:00.000Z"),
    );
    expect(resolved.unavailable).toEqual([]);
    const mysql = resolved.resolved.find(
      (item) => item.qualifiedName.toLowerCase() === "sagg.related_person",
    );
    expect(mysql?.dataSource?.toLowerCase()).toBe("gfmysql_sagg5");
    expect(mysql?.evidenceProvider).toContain("local:horae-datasource");
  });

  it("matches #service suffix when gforacle_service#service instance is numbered", () => {
    const dir = mkdtempSync(join(tmpdir(), "offline-rdbms-svc-"));
    const catalog = loadOfflineTableCatalog({
      hiveMetadataPath: writeJsonl(dir, "hive-meta.jsonl", []),
      hiveDdlPath: writeJsonl(dir, "hive-ddl.jsonl", []),
      rdbmsCorePath: writeJsonl(dir, "rdbms-core.jsonl", [
        {
          qualifiedname: "CRMII.TAPP_CHANNELTYPE@gforacle_jgjdb1#jgjdb",
          name: "TAPP_CHANNELTYPE",
          type_name: "gf_rdbms_table",
        },
        {
          qualifiedname: "CRMII.TAPP_CHANNELTYPE@gforacle_jgjdbuat#jgjdbuat",
          name: "TAPP_CHANNELTYPE",
          type_name: "gf_rdbms_table",
        },
      ]),
      rdbmsDdlPath: writeJsonl(dir, "rdbms-ddl.jsonl", [
        {
          qualifiedname: "CRMII.TAPP_CHANNELTYPE@gforacle_jgjdb1#jgjdb",
          ddl: "CREATE TABLE CRMII.TAPP_CHANNELTYPE (ID NUMBER)",
        },
        {
          qualifiedname: "CRMII.TAPP_CHANNELTYPE@gforacle_jgjdbuat#jgjdbuat",
          ddl: "CREATE TABLE CRMII.TAPP_CHANNELTYPE (ID NUMBER)",
        },
      ]),
      horaeDatasource: {
        byServerTag: new Map([
          [
            "oracle_jgj_69.202",
            {
              serverTag: "oracle_jgj_69.202",
              serverType: "oracle",
              service: "jgjdb",
            },
          ],
        ]),
      },
    });
    const resolved = resolveOfflineTables(
      mkdtempSync(join(tmpdir(), "pack-")),
      task({
        taskId: "124",
        taskCategory: "oracle2hive",
        source: "oracle_jgj_69.202",
        target: undefined,
        sql: { query: "SELECT 1 FROM CRMII.TAPP_CHANNELTYPE" },
      }),
      catalog,
    );
    expect(resolved.unavailable).toEqual([]);
    expect(resolved.resolved[0]?.dataSource?.toLowerCase()).toBe(
      "gforacle_jgjdb1#jgjdb",
    );
  });

  it("prefers gforacle_jgjdb1#jgjdb when #jgjdb has multiple numbered prod instances", () => {
    const dir = mkdtempSync(join(tmpdir(), "offline-rdbms-jgjdb-multi-"));
    const catalog = loadOfflineTableCatalog({
      hiveMetadataPath: writeJsonl(dir, "hive-meta.jsonl", []),
      hiveDdlPath: writeJsonl(dir, "hive-ddl.jsonl", []),
      rdbmsCorePath: writeJsonl(dir, "rdbms-core.jsonl", [
        {
          qualifiedname: "CRMII.TRYXX@gforacle_jgjdb1#jgjdb",
          name: "TRYXX",
          type_name: "gf_rdbms_table",
        },
        {
          qualifiedname: "CRMII.TRYXX@gforacle_jgjdb2#jgjdb",
          name: "TRYXX",
          type_name: "gf_rdbms_table",
        },
        {
          qualifiedname: "CRMII.TRYXX@gforacle_jgjdbuat#jgjdbuat",
          name: "TRYXX",
          type_name: "gf_rdbms_table",
        },
      ]),
      rdbmsDdlPath: writeJsonl(dir, "rdbms-ddl.jsonl", [
        {
          qualifiedname: "CRMII.TRYXX@gforacle_jgjdb1#jgjdb",
          ddl: "CREATE TABLE CRMII.TRYXX (ID NUMBER)",
        },
        {
          qualifiedname: "CRMII.TRYXX@gforacle_jgjdb2#jgjdb",
          ddl: "CREATE TABLE CRMII.TRYXX (ID NUMBER)",
        },
        {
          qualifiedname: "CRMII.TRYXX@gforacle_jgjdbuat#jgjdbuat",
          ddl: "CREATE TABLE CRMII.TRYXX (ID NUMBER)",
        },
      ]),
      horaeDatasource: {
        byServerTag: new Map([
          [
            "oracle_jgj_69.202",
            {
              serverTag: "oracle_jgj_69.202",
              serverType: "oracle",
              service: "jgjdb",
            },
          ],
        ]),
      },
    });
    const resolved = resolveOfflineTables(
      mkdtempSync(join(tmpdir(), "pack-")),
      task({
        taskId: "143",
        taskCategory: "oracle2hive",
        source: "oracle_jgj_69.202",
        target: undefined,
        sql: { query: "SELECT 1 FROM CRMII.TRYXX" },
      }),
      catalog,
    );
    expect(resolved.unavailable).toEqual([]);
    expect(resolved.resolved[0]?.dataSource?.toLowerCase()).toBe(
      "gforacle_jgjdb1#jgjdb",
    );
  });

  it("prefers gforacle_oracle_uip_winddb#winddb for oracle_wande when #winddb is multi", () => {
    const dir = mkdtempSync(join(tmpdir(), "offline-rdbms-wind-"));
    const catalog = loadOfflineTableCatalog({
      hiveMetadataPath: writeJsonl(dir, "hive-meta.jsonl", []),
      hiveDdlPath: writeJsonl(dir, "hive-ddl.jsonl", []),
      rdbmsCorePath: writeJsonl(dir, "rdbms-core.jsonl", [
        {
          qualifiedname: "WIND.TB_OBJECT_1021@gforacle_jcywdb3#jcywdb",
          name: "TB_OBJECT_1021",
          type_name: "gf_rdbms_table",
        },
        {
          qualifiedname:
            "WIND.TB_OBJECT_1021@gforacle_oracle_uip_winddb#winddb",
          name: "TB_OBJECT_1021",
          type_name: "gf_rdbms_table",
        },
        {
          qualifiedname: "WIND.TB_OBJECT_1021@gforacle_winddb4#winddb",
          name: "TB_OBJECT_1021",
          type_name: "gf_rdbms_table",
        },
      ]),
      rdbmsDdlPath: writeJsonl(dir, "rdbms-ddl.jsonl", [
        {
          qualifiedname:
            "WIND.TB_OBJECT_1021@gforacle_oracle_uip_winddb#winddb",
          ddl: "CREATE TABLE WIND.TB_OBJECT_1021 (ID NUMBER)",
        },
        {
          qualifiedname: "WIND.TB_OBJECT_1021@gforacle_winddb4#winddb",
          ddl: "CREATE TABLE WIND.TB_OBJECT_1021 (ID NUMBER)",
        },
      ]),
      horaeDatasource: {
        byServerTag: new Map([
          [
            "oracle_wande_89.132",
            {
              serverTag: "oracle_wande_89.132",
              serverType: "oracle",
              service: "winddb",
              host: "10.2.89.132",
            },
          ],
        ]),
      },
    });
    const resolved = resolveOfflineTables(
      mkdtempSync(join(tmpdir(), "pack-")),
      task({
        taskId: "166",
        taskCategory: "oracle2hive",
        source: "oracle_wande_89.132",
        target: undefined,
        sql: { query: "SELECT 1 FROM WIND.TB_OBJECT_1021" },
      }),
      catalog,
    );
    expect(resolved.unavailable).toEqual([]);
    expect(resolved.resolved[0]?.dataSource?.toLowerCase()).toBe(
      "gforacle_oracle_uip_winddb#winddb",
    );
  });

  it("stays AMBIGUOUS when horae-datasource is absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "offline-rdbms-amb2-"));
    const catalog = loadOfflineTableCatalog({
      hiveMetadataPath: writeJsonl(dir, "hive-meta.jsonl", []),
      hiveDdlPath: writeJsonl(dir, "hive-ddl.jsonl", []),
      rdbmsCorePath: writeJsonl(dir, "rdbms-core.jsonl", [
        {
          qualifiedname: "HS_OPT.COVERSTOCKJOUR@gforacle_gfufjy2#gfufjy",
          name: "COVERSTOCKJOUR",
          type_name: "gf_rdbms_table",
        },
        {
          qualifiedname: "HS_OPT.COVERSTOCKJOUR@gforacle_jyglrac#jyglrac",
          name: "COVERSTOCKJOUR",
          type_name: "gf_rdbms_table",
        },
      ]),
      rdbmsDdlPath: writeJsonl(dir, "rdbms-ddl.jsonl", [
        {
          qualifiedname: "HS_OPT.COVERSTOCKJOUR@gforacle_jyglrac#jyglrac",
          ddl: "CREATE TABLE HS_OPT.COVERSTOCKJOUR (ID NUMBER)",
        },
      ]),
      horaeDatasource: null,
    });
    const resolved = resolveOfflineTables(
      mkdtempSync(join(tmpdir(), "pack-")),
      task({
        taskId: "68",
        taskCategory: "oracle2hive",
        source: "oracle_rbjygl_85.236",
        target: undefined,
        sql: { query: "SELECT 1 FROM HS_OPT.COVERSTOCKJOUR" },
      }),
      catalog,
    );
    expect(resolved.unavailable).toEqual([
      {
        qualifiedName: "HS_OPT.COVERSTOCKJOUR",
        reason: "RDBMS_CORE_AMBIGUOUS",
      },
    ]);
  });
});

describe("offline table resolver", () => {
  it("uses a unique Hive2 endpoint hint without inventing a non-Oracle datasource", () => {
    const dir = mkdtempSync(join(tmpdir(), "offline-hive2-hint-"));
    const catalog = loadOfflineTableCatalog({
      hiveMetadataPath: writeJsonl(dir, "hive-meta.jsonl", []),
      hiveDdlPath: writeJsonl(dir, "hive-ddl.jsonl", [
        {
          qualifiedname: "odata_n.demo_source@gfhive",
          querytext: "CREATE TABLE odata_n.demo_source (ID INT)",
        },
      ]),
      rdbmsCorePath: writeJsonl(dir, "rdbms-core.jsonl", [
        {
          qualifiedname: "HS_OPT.DEMO_TARGET@gforacle_jgjdb#jgjdb",
          type_name: "gf_rdbms_table",
        },
      ]),
      rdbmsDdlPath: writeJsonl(dir, "rdbms-ddl.jsonl", [
        {
          qualifiedname: "HS_OPT.DEMO_TARGET@gforacle_jgjdb#jgjdb",
          ddl: "CREATE TABLE HS_OPT.DEMO_TARGET (ID NUMBER)",
        },
      ]),
      horaeDatasource: null,
    });
    const resolved = resolveOfflineTables(
      mkdtempSync(join(tmpdir(), "pack-")),
      task({
        taskCategory: "hive2oracle",
        source: "odata_n.demo_source",
        target: "HS_OPT.DEMO_TARGET",
        endpointDataSourceHints: { target: "gforacle_jgjdb#jgjdb" },
        sql: { query: "INSERT INTO HS_OPT.DEMO_TARGET SELECT 1" },
      }),
      catalog,
    );
    expect(resolved.unavailable).toEqual([]);
    expect(resolved.resolved[0]).toMatchObject({
      qualifiedName: "HS_OPT.DEMO_TARGET",
      dataSource: "gforacle_jgjdb#jgjdb",
      platform: "oracle",
    });
  });

  it("adds a gfhive table from ddl alone when names match, without guid", () => {
    const dir = mkdtempSync(join(tmpdir(), "offline-table-"));
    const catalog = loadOfflineTableCatalog({
      hiveMetadataPath: writeJsonl(dir, "hive-meta.jsonl", []),
      hiveDdlPath: writeJsonl(dir, "hive-ddl.jsonl", [
        {
          qualifiedname: "dm_index_n.hold_tag_relation@gfhive:1",
          querytext: "CREATE TABLE dm_index_n.hold_tag_relation (id string)",
        },
      ]),
      rdbmsCorePath: writeJsonl(dir, "rdbms-core.jsonl", []),
      rdbmsDdlPath: writeJsonl(dir, "rdbms-ddl.jsonl", []),
    });
    const dataRoot = mkdtempSync(join(tmpdir(), "pack-"));
    const resolved = resolveOfflineTables(dataRoot, task(), catalog, () =>
      new Date("2026-09-02T00:00:00.000Z"),
    );
    expect(resolved.unavailable).toEqual([]);
    expect(resolved.resolved).toHaveLength(1);
    expect(resolved.resolved[0]).toMatchObject({
      platform: "hive",
      dataSource: "gfhive",
      qualifiedName: "dm_index_n.hold_tag_relation",
      objectType: "hive_table",
    });
    expect(resolved.resolved[0]?.guid).toBeUndefined();
    expect(resolved.resolved[0]?.ddl).toContain("CREATE TABLE");
    expect(resolved.resolved[0]?.partitionFields).toEqual([]);
  });

  it("writes hive partitionFields from PARTITIONED BY, not into task.partition", () => {
    const dir = mkdtempSync(join(tmpdir(), "offline-table-"));
    const ddl =
      "CREATE TABLE dm_index_n.index_grp_assm_trust_auth_end_date( grp_id STRING ) COMMENT 'x' PARTITIONED BY ( busi_date STRING COMMENT '业务日期', tag_id STRING COMMENT '标签ID' ) STORED AS ORC";
    const catalog = loadOfflineTableCatalog({
      hiveMetadataPath: writeJsonl(dir, "hive-meta.jsonl", []),
      hiveDdlPath: writeJsonl(dir, "hive-ddl.jsonl", [
        {
          qualifiedname:
            "dm_index_n.index_grp_assm_trust_auth_end_date@gfhive:1",
          querytext: ddl,
        },
      ]),
      rdbmsCorePath: writeJsonl(dir, "rdbms-core.jsonl", []),
      rdbmsDdlPath: writeJsonl(dir, "rdbms-ddl.jsonl", []),
    });
    const dataRoot = mkdtempSync(join(tmpdir(), "pack-"));
    const resolved = resolveOfflineTables(
      dataRoot,
      task({
        target: "dm_index_n.index_grp_assm_trust_auth_end_date",
        sql: { query: "SELECT 1 FROM dm_index_n.index_grp_assm_trust_auth_end_date" },
      }),
      catalog,
    );
    expect(resolved.resolved[0]?.partitionFields).toEqual([
      "busi_date",
      "tag_id",
    ]);
    const written = writeTableInput(dataRoot, resolved.resolved[0]!);
    const tableJson = JSON.parse(
      readFileSync(join(written.directory, "table.json"), "utf8"),
    ) as { partitionFields?: unknown };
    expect(tableJson.partitionFields).toEqual(["busi_date", "tag_id"]);
    expect(resolved.resolved[0]?.description).toBe("x");
  });

  it("ignores hive ALTER querytext and falls back to unique task CREATE", () => {
    const dir = mkdtempSync(join(tmpdir(), "offline-table-"));
    const catalog = loadOfflineTableCatalog({
      hiveMetadataPath: writeJsonl(dir, "hive-meta.jsonl", [
        {
          guid: "meta-guid",
          qualifiedname_clean: "odata_n_uip.q_md_institution",
          datasource: "gfhive",
          status: "ACTIVE",
          type_name: "hive_table",
        },
      ]),
      hiveDdlPath: writeJsonl(dir, "hive-ddl.jsonl", [
        {
          qualifiedname: "odata_n_uip.q_md_institution@gfhive:1",
          querytext:
            "alter table q_md_institution change column data_time data_time string comment '数据时间'",
        },
      ]),
      rdbmsCorePath: writeJsonl(dir, "rdbms-core.jsonl", []),
      rdbmsDdlPath: writeJsonl(dir, "rdbms-ddl.jsonl", []),
    });
    const create =
      "CREATE TABLE odata_n_uip.q_md_institution(party_id string) COMMENT '机构主表' PARTITIONED BY (busi_date string)";
    const resolved = resolveOfflineTables(
      mkdtempSync(join(tmpdir(), "pack-")),
      task({
        target: "odata_n_uip.q_md_institution",
        sql: {
          create,
          query: "SELECT party_id FROM odata_n_uip.q_md_institution",
        },
      }),
      catalog,
    );
    expect(resolved.resolved[0]?.ddl).toBe(create);
    expect(resolved.resolved[0]?.evidenceProvider).toBe(
      "input-pack:task-sql-create",
    );
    expect(resolved.resolved[0]?.guid).toBeUndefined();
    expect(resolved.resolved[0]?.description).toBe("机构主表");
    expect(resolved.resolved[0]?.partitionFields).toEqual(["busi_date"]);
  });

  it("joins hive metadata and ddl by table name when guids differ", () => {
    const dir = mkdtempSync(join(tmpdir(), "offline-table-"));
    const catalog = loadOfflineTableCatalog({
      hiveMetadataPath: writeJsonl(dir, "hive-meta.jsonl", [
        {
          guid: "meta-guid",
          qualifiedname_clean: "dm_index_n.hold_tag_relation",
          datasource: "gfhive",
          status: "ACTIVE",
          type_name: "hive_table",
        },
      ]),
      hiveDdlPath: writeJsonl(dir, "hive-ddl.jsonl", [
        {
          guid: "other-guid",
          qualifiedname: "dm_index_n.hold_tag_relation@gfhive:99",
          querytext: "CREATE TABLE dm_index_n.hold_tag_relation (id string)",
        },
      ]),
      rdbmsCorePath: writeJsonl(dir, "rdbms-core.jsonl", []),
      rdbmsDdlPath: writeJsonl(dir, "rdbms-ddl.jsonl", []),
    });
    const resolved = resolveOfflineTables(
      mkdtempSync(join(tmpdir(), "pack-")),
      task(),
      catalog,
    );
    expect(resolved.resolved[0]?.ddl).toContain("CREATE TABLE");
    expect(resolved.resolved[0]?.guid).toBeUndefined();
  });

  it("joins rdbms core and ddl by qualifiedname, guid optional", () => {
    const dir = mkdtempSync(join(tmpdir(), "offline-table-"));
    const qn = "TITANS_TRADEFLOW.TRANS_SMT_ATP_T_REPORT@gforacle_gftzdb#gftzdb";
    const catalog = loadOfflineTableCatalog({
      hiveMetadataPath: writeJsonl(dir, "hive-meta.jsonl", []),
      hiveDdlPath: writeJsonl(dir, "hive-ddl.jsonl", []),
      rdbmsCorePath: writeJsonl(dir, "rdbms-core.jsonl", [
        {
          qualifiedname: qn,
          type_name: "gf_rdbms_table",
          primarykeys: "TE_REPORT_ID,TRADE_DATE",
          comment: "成交流水",
        },
      ]),
      rdbmsDdlPath: writeJsonl(dir, "rdbms-ddl.jsonl", [
        {
          qualifiedname: qn,
          ddl: 'CREATE TABLE "TITANS_TRADEFLOW"."TRANS_SMT_ATP_T_REPORT" ("ID" NUMBER)',
        },
      ]),
    });
    const resolved = resolveOfflineTables(
      mkdtempSync(join(tmpdir(), "pack-")),
      task({
        taskCategory: "hive2oracle",
        source: "dm_otc_n.src",
        target: "TITANS_TRADEFLOW.TRANS_SMT_ATP_T_REPORT@gforacle_gftzdb#gftzdb",
        sql: { truncate: "delete from TITANS_TRADEFLOW.TRANS_SMT_ATP_T_REPORT" },
      }),
      catalog,
    );
    const oracle = resolved.resolved.find((item) => item.platform === "oracle");
    expect(oracle?.guid).toBeUndefined();
    expect(oracle?.dataSource).toBe("gforacle_gftzdb#gftzdb");
    expect(oracle?.ddl).toContain("TRANS_SMT_ATP_T_REPORT");
    expect(oracle?.description).toBe("成交流水");
    expect(oracle?.partitionFields).toEqual([]);
    expect(oracle?.primaryKey).toBeUndefined();
  });

  it("omits rdbms partitionFields when PARTITION BY RANGE (null)", () => {
    const dir = mkdtempSync(join(tmpdir(), "offline-table-"));
    const qn = "TITANS_TRADEFLOW.TRANS_SMT_ATP_T_REPORT@gforacle_gftzdb#gftzdb";
    const ddl =
      'CREATE TABLE "TITANS_TRADEFLOW"."TRANS_SMT_ATP_T_REPORT" ("ID" NUMBER ,"TRADE_DATE" DATE)  PARTITION BY RANGE (null)  INTERVAL (NUMTOYMINTERVAL(1, \'MONTH\')) ( PARTITION "p_month_1" VALUES LESS THAN (TO_DATE(\' 2024-11-01 00:00:00\', \'SYYYY-MM-DD HH24:MI:SS\', \'NLS_CALENDAR=GREGORIAN\')));COMMENT ON TABLE "TITANS_TRADEFLOW"."TRANS_SMT_ATP_T_REPORT"  IS \'带有委托编号的成交流水表\';';
    const catalog = loadOfflineTableCatalog({
      hiveMetadataPath: writeJsonl(dir, "hive-meta.jsonl", []),
      hiveDdlPath: writeJsonl(dir, "hive-ddl.jsonl", []),
      rdbmsCorePath: writeJsonl(dir, "rdbms-core.jsonl", [
        {
          guid: "jsonl-guid-must-not-be-copied",
          qualifiedname: qn,
          type_name: "gf_rdbms_table",
          ispartitioned: "true",
          comment: "带有委托编号的成交流水表",
        },
      ]),
      rdbmsDdlPath: writeJsonl(dir, "rdbms-ddl.jsonl", [{ qualifiedname: qn, ddl }]),
    });
    const dataRoot = mkdtempSync(join(tmpdir(), "pack-"));
    const resolved = resolveOfflineTables(
      dataRoot,
      task({
        taskCategory: "hive2oracle",
        target: qn,
        sql: { truncate: "delete from TITANS_TRADEFLOW.TRANS_SMT_ATP_T_REPORT" },
      }),
      catalog,
    );
    const oracle = resolved.resolved.find((item) => item.platform === "oracle");
    expect(oracle?.guid).toBeUndefined();
    expect(oracle?.description).toBe("带有委托编号的成交流水表");
    expect(oracle?.partitionFields).toBeUndefined();
    const written = writeTableInput(dataRoot, oracle!);
    const tableJson = JSON.parse(
      readFileSync(join(written.directory, "table.json"), "utf8"),
    ) as { guid?: string; partitionFields?: unknown };
    expect(tableJson.guid).toBeUndefined();
    expect("partitionFields" in tableJson).toBe(false);
  });

  it("writes rdbms partitionFields from parseable PARTITION BY RANGE", () => {
    const dir = mkdtempSync(join(tmpdir(), "offline-table-"));
    const qn = "TITANS_TRADEFLOW.TRANS_SMT_ATP_T_REPORT@gforacle_gftzdb#gftzdb";
    const catalog = loadOfflineTableCatalog({
      hiveMetadataPath: writeJsonl(dir, "hive-meta.jsonl", []),
      hiveDdlPath: writeJsonl(dir, "hive-ddl.jsonl", []),
      rdbmsCorePath: writeJsonl(dir, "rdbms-core.jsonl", [
        {
          qualifiedname: qn,
          type_name: "gf_rdbms_table",
          ispartitioned: "true",
          comment: "成交流水",
        },
      ]),
      rdbmsDdlPath: writeJsonl(dir, "rdbms-ddl.jsonl", [
        {
          qualifiedname: qn,
          ddl: 'CREATE TABLE "TITANS_TRADEFLOW"."TRANS_SMT_ATP_T_REPORT" ("TRADE_DATE" DATE) PARTITION BY RANGE ("TRADE_DATE") INTERVAL (NUMTOYMINTERVAL(1, \'MONTH\')) (PARTITION "p1" VALUES LESS THAN (MAXVALUE))',
        },
      ]),
    });
    const dataRoot = mkdtempSync(join(tmpdir(), "pack-"));
    const resolved = resolveOfflineTables(
      dataRoot,
      task({
        taskCategory: "hive2oracle",
        target: qn,
        sql: { truncate: "delete from TITANS_TRADEFLOW.TRANS_SMT_ATP_T_REPORT" },
      }),
      catalog,
    );
    const oracle = resolved.resolved.find((item) => item.platform === "oracle");
    expect(oracle?.partitionFields).toEqual(["TRADE_DATE"]);
    const written = writeTableInput(dataRoot, oracle!);
    const tableJson = JSON.parse(
      readFileSync(join(written.directory, "table.json"), "utf8"),
    ) as { partitionFields?: unknown };
    expect(tableJson.partitionFields).toEqual(["TRADE_DATE"]);
  });

  it("reuses an existing table pack", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "pack-"));
    writeTableInput(dataRoot, {
      platform: "hive",
      dataSource: "gfhive",
      qualifiedName: "dm_index_n.hold_tag_relation",
      objectType: "hive_table",
      ddl: "CREATE TABLE dm_index_n.hold_tag_relation (id string)",
      evidenceProvider: "local:table-pack",
    });
    const dir = mkdtempSync(join(tmpdir(), "offline-table-"));
    const catalog = loadOfflineTableCatalog({
      hiveMetadataPath: writeJsonl(dir, "hive-meta.jsonl", []),
      hiveDdlPath: writeJsonl(dir, "hive-ddl.jsonl", []),
      rdbmsCorePath: writeJsonl(dir, "rdbms-core.jsonl", []),
      rdbmsDdlPath: writeJsonl(dir, "rdbms-ddl.jsonl", []),
    });
    const resolved = resolveOfflineTables(dataRoot, task(), catalog);
    expect(resolved.resolved[0]?.evidenceProvider).toMatch(/local:table-pack|local:tables-cache/);
  });

  it("uses unique task CREATE when hive metadata exists but ddl does not", () => {
    const dir = mkdtempSync(join(tmpdir(), "offline-table-"));
    const catalog = loadOfflineTableCatalog({
      hiveMetadataPath: writeJsonl(dir, "hive-meta.jsonl", [
        {
          qualifiedname_clean: "dm_index_n.hold_tag_relation",
          datasource: "gfhive",
          status: "ACTIVE",
          type_name: "hive_table",
        },
      ]),
      hiveDdlPath: writeJsonl(dir, "hive-ddl.jsonl", []),
      rdbmsCorePath: writeJsonl(dir, "rdbms-core.jsonl", []),
      rdbmsDdlPath: writeJsonl(dir, "rdbms-ddl.jsonl", []),
    });
    const resolved = resolveOfflineTables(
      mkdtempSync(join(tmpdir(), "pack-")),
      task({
        sql: {
          create:
            "CREATE TABLE dm_index_n.hold_tag_relation (id string)",
        },
      }),
      catalog,
    );
    expect(resolved.resolved[0]?.evidenceProvider).toBe("input-pack:task-sql-create");
    expect(resolved.resolved[0]?.guid).toBeUndefined();
  });

  it("omits empty hive description so table.json can be written", () => {
    const dir = mkdtempSync(join(tmpdir(), "offline-table-"));
    const catalog = loadOfflineTableCatalog({
      hiveMetadataPath: writeJsonl(dir, "hive-meta.jsonl", [
        {
          qualifiedname_clean: "odata_n_hbm.h_cux_adj_budget_adjust",
          datasource: "gfhive",
          status: "ACTIVE",
          type_name: "hive_table",
          comment: "",
        },
      ]),
      hiveDdlPath: writeJsonl(dir, "hive-ddl.jsonl", [
        {
          qualifiedname: "odata_n_hbm.h_cux_adj_budget_adjust@gfhive:1",
          querytext:
            "create table h_cux_adj_budget_adjust (document_id string comment '文档id') COMMENT ''",
        },
      ]),
      rdbmsCorePath: writeJsonl(dir, "rdbms-core.jsonl", []),
      rdbmsDdlPath: writeJsonl(dir, "rdbms-ddl.jsonl", []),
    });
    const dataRoot = mkdtempSync(join(tmpdir(), "pack-"));
    const resolved = resolveOfflineTables(
      dataRoot,
      task({
        target: "odata_n_hbm.h_cux_adj_budget_adjust",
        sql: { query: "SELECT 1 FROM odata_n_hbm.h_cux_adj_budget_adjust" },
      }),
      catalog,
    );
    expect(resolved.resolved[0]?.description).toBeUndefined();
    const written = writeTableInput(dataRoot, resolved.resolved[0]!);
    const tableJson = JSON.parse(
      readFileSync(join(written.directory, "table.json"), "utf8"),
    ) as { description?: string };
    expect(tableJson.description).toBeUndefined();
  });

  it("qualifies an unqualified hiveTask CREATE from the task name schema", () => {
    const dir = mkdtempSync(join(tmpdir(), "offline-table-"));
    const catalog = loadOfflineTableCatalog({
      hiveMetadataPath: writeJsonl(dir, "hive-meta.jsonl", []),
      hiveDdlPath: writeJsonl(dir, "hive-ddl.jsonl", []),
      rdbmsCorePath: writeJsonl(dir, "rdbms-core.jsonl", []),
      rdbmsDdlPath: writeJsonl(dir, "rdbms-ddl.jsonl", []),
    });
    const create =
      "CREATE TABLE IF NOT EXISTS T05_FIN_BDGT_ADJ_APP_EVT(\n    Evt_Id STRING\n)COMMENT '财务预算调整申请事件'\nPARTITIONED BY (SRC_TBL STRING, BUSI_DATE STRING)\nSTORED AS ORC;";
    const resolved = resolveOfflineTables(
      mkdtempSync(join(tmpdir(), "pack-")),
      task({
        taskId: "100078",
        taskCategory: "hiveTask",
        taskName: "PDATA_N.T05_FIN_BDGT_ADJ_APP_EVT_HBM002",
        target: undefined,
        sql: {
          create,
          query:
            "INSERT OVERWRITE TABLE T05_FIN_BDGT_ADJ_APP_EVT SELECT 1 FROM ODATA_N_HBM.H_CUX_ADJ_BUDGET_ADJUST",
        },
      }),
      catalog,
    );
    const target = resolved.resolved.find(
      (item) =>
        item.qualifiedName.toLowerCase() ===
        "pdata_n.t05_fin_bdgt_adj_app_evt",
    );
    expect(target?.evidenceProvider).toBe("input-pack:task-sql-create");
    expect(target?.description).toBe("财务预算调整申请事件");
    expect(target?.partitionFields).toEqual(["src_tbl", "busi_date"]);
    expect(target?.guid).toBeUndefined();
  });
});
