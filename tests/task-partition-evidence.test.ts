import { describe, expect, it } from "vitest";
import {
  buildCompactTaskPartition,
  buildSimpleTaskPartitionMap,
  buildTaskPartitionEvidence,
} from "../scripts/input/shared/task-partition-evidence.ts";

const target = "dm_index_n.index_grp_cust_acct_cnt";

function table(partitionFields?: readonly string[]) {
  return {
    platform: "hive",
    dataSource: "gfhive",
    qualifiedName: target,
    objectType: "TABLE",
    ...(partitionFields === undefined ? {} : { partitionFields }),
    ddl: "CREATE TABLE dm_index_n.index_grp_cust_acct_cnt (id bigint)",
    evidenceProvider: "fixture:table",
  };
}

describe("task partition map fallback", () => {
  it("emits null only when the target table is confirmed non-partitioned", () => {
    expect(
      buildCompactTaskPartition({
        taskTarget: target,
        tables: [table([])],
        sql: { query: "SELECT id FROM source_table" },
      }),
    ).toBeNull();
  });

  it("keeps a wildcard for an incomplete dynamic partition value", () => {
    expect(
      buildCompactTaskPartition({
        taskTarget: target,
        tables: [table(["busi_date", "grp_id"])],
        sql: {
          query:
            "INSERT OVERWRITE TABLE dm_index_n.index_grp_cust_acct_cnt PARTITION(busi_date='2026-08-22', grp_id) SELECT id, grp_id FROM source_table;",
        },
      }),
    ).toEqual({ busi_date: "${YYYY-MM-DD}", grp_id: "*" });
  });

  it("keeps the target partition shape when one write value is incomplete", () => {
    expect(
      buildCompactTaskPartition({
        taskTarget: target,
        tables: [table(["busi_date"])],
        sql: {
          query:
            "INSERT OVERWRITE TABLE dm_index_n.index_grp_cust_acct_cnt PARTITION(busi_date='2026-08-22') SELECT id FROM source_a; INSERT OVERWRITE TABLE dm_index_n.index_grp_cust_acct_cnt PARTITION(busi_date) SELECT * FROM source_b;",
        },
      }),
    ).toEqual({ busi_date: "${YYYY-MM-DD}" });
  });

  it("uses the date template for a complete target with a runtime date expression", () => {
    expect(
      buildCompactTaskPartition({
        taskTarget: target,
        tables: [table(["src_tbl", "busi_date"])],
        sql: {
          query:
            "INSERT OVERWRITE TABLE dm_index_n.index_grp_cust_acct_cnt PARTITION(src_tbl, busi_date) SELECT id, src_tbl, SUBSTR(source_date, 1, 10) AS busi_date FROM source_table;",
        },
      }),
    ).toEqual({ src_tbl: "*", busi_date: "${YYYY-MM-DD}" });
  });

  it("normalizes UNION date aliases before checking for a partition conflict", () => {
    expect(
      buildCompactTaskPartition({
        taskTarget: target,
        tables: [table(["busi_date"])],
        sql: {
          query:
            "INSERT OVERWRITE TABLE dm_index_n.index_grp_cust_acct_cnt PARTITION(busi_date) SELECT A.busi_date AS busi_date FROM source_a A UNION ALL SELECT B.busi_date AS busi_date FROM source_b B;",
        },
      }),
    ).toEqual({ busi_date: "${YYYY-MM-DD}" });
  });

  it("selects the unique partitioned final target when temp targets lack table packs", () => {
    expect(
      buildCompactTaskPartition({
        tables: [],
        sql: {
          create:
            "CREATE TABLE t02_tit_scr_trd_cal (id string) PARTITIONED BY (src_id string, grp_id string); CREATE TABLE t02_tit_scr_trd_cal_tit_temp AS SELECT 1; CREATE TABLE t02_tit_scr_trd_cal_tit_temp_not AS SELECT 1;",
          query:
            "INSERT OVERWRITE TABLE t02_tit_scr_trd_cal_tit_temp SELECT 1; INSERT OVERWRITE TABLE t02_tit_scr_trd_cal_tit_temp_not SELECT 1; INSERT OVERWRITE TABLE t02_tit_scr_trd_cal PARTITION(src_id='TIT', grp_id='01') SELECT 1, 2;",
        },
      }),
    ).toEqual({ src_id: "TIT", grp_id: "01" });
  });

  it("preserves distinct confirmed UNION partition values as an array", () => {
    expect(
      buildCompactTaskPartition({
        taskTarget: target,
        tables: [table(["grp_id"])],
        sql: {
          query:
            "INSERT OVERWRITE TABLE dm_index_n.index_grp_cust_acct_cnt PARTITION(grp_id) SELECT id, '01' AS grp_id FROM source_a UNION ALL SELECT id, '02' AS grp_id FROM source_b;",
        },
      }),
    ).toEqual([{ grp_id: "01" }, { grp_id: "02" }]);
  });

  it("preserves distinct confirmed implicit UNION partition values as an array", () => {
    expect(
      buildCompactTaskPartition({
        taskTarget: target,
        tables: [table(["grp_id"])],
        sql: {
          query:
            "SELECT id, '01' AS grp_id FROM source_a UNION ALL SELECT id, '02' AS grp_id FROM source_b;",
        },
      }),
    ).toEqual([{ grp_id: "01" }, { grp_id: "02" }]);
  });

  it("omits partition when table metadata does not say whether fields exist", () => {
    expect(
      buildCompactTaskPartition({
        taskTarget: target,
        tables: [table()],
        sql: { query: "SELECT id FROM source_table" },
      }),
    ).toBeUndefined();
  });

  it("does not wildcard a source-extraction query without target-write evidence", () => {
    expect(
      buildCompactTaskPartition({
        taskTarget: target,
        tables: [table(["busi_date"])],
        allowImplicitQueryOutput: false,
        sql: { query: "SELECT id, busi_date FROM source_table" },
      }),
    ).toBeUndefined();
  });

  it("defaults a known target busi_date for database-source ingestion", () => {
    expect(
      buildCompactTaskPartition({
        taskTarget: target,
        tables: [table(["busi_date"])],
        allowImplicitQueryOutput: false,
        allowSourceTemporalPartitionDefault: true,
        schedulerEvidence: {
          hivePartition: "${YYYY-MM-DD}",
          evidenceProvider: "fixture:scheduler",
        },
        sql: { query: "SELECT id FROM oracle_source_table" },
      }),
    ).toEqual({ busi_date: "${YYYY-MM-DD}" });
  });

  it("accepts a single uniquely identified target when task target is absent", () => {
    expect(
      buildCompactTaskPartition({
        tables: [table(["busi_date"])],
        sparkIndexMode: true,
        sql: {
          query:
            "INSERT OVERWRITE TABLE dm_index_n.index_grp_cust_acct_cnt PARTITION(busi_date='2026-08-22') SELECT id FROM source_table;",
        },
      }),
    ).toEqual({ busi_date: "${YYYY-MM-DD}" });
  });

  it("does not use an intermediate table partition as the task target partition", () => {
    expect(
      buildCompactTaskPartition({
        taskTarget: "features.client_label_latest",
        tables: [
          {
            ...table(["dim_index"]),
            qualifiedName: "temp_n.client_label",
          },
        ],
        sql: {
          query:
            "INSERT INTO PLACEHOLDER_INSERT_DB.PLACEHOLDER_INSERT_TABLE(client) SELECT client FROM src.t; INSERT OVERWRITE TABLE temp_n.client_label PARTITION(dim_index='grp1') SELECT client FROM src.t;",
        },
      }),
    ).toBeUndefined();
  });

  it("keeps the partition shape as a simple field-to-value map", () => {
    expect(
      buildSimpleTaskPartitionMap({
        taskTarget: target,
        tables: [table(["busi_date"])],
        sparkIndexMode: true,
        sql: {
          query: "SELECT TRANSFER_ID FROM source_table",
        },
        schedulerEvidence: {
          hivePartition: "busi_date=${YYYY-MM-DD}",
          evidenceProvider: "fixture:scheduler",
        },
      }),
    ).toEqual({ busi_date: "${YYYY-MM-DD}" });
  });

  it("keeps the existing explicit INSERT partition path primary", () => {
    expect(
      buildSimpleTaskPartitionMap({
        taskTarget: target,
        tables: [table(["busi_date"])],
        sparkIndexMode: true,
        sql: {
          create:
            "CREATE TABLE x (id bigint) PARTITIONED BY (busi_date string)",
          query:
            "INSERT OVERWRITE TABLE dm_index_n.index_grp_cust_acct_cnt PARTITION(busi_date='2026-08-22') SELECT 1;",
        },
      }),
    ).toEqual({ busi_date: "${YYYY-MM-DD}" });
  });

  it("canonicalizes a target date literal from an implicit query output", () => {
    expect(
      buildSimpleTaskPartitionMap({
        taskTarget: target,
        tables: [table(["busi_date"])],
        sparkIndexMode: true,
        sql: {
          query: "SELECT id, '2026-05-24' AS busi_date FROM source_table",
        },
      }),
    ).toEqual({ busi_date: "${YYYY-MM-DD}" });
  });

  it("keeps a unique dynamic target expression in the compact map", () => {
    expect(
      buildSimpleTaskPartitionMap({
        taskTarget: target,
        tables: [table(["busi_date"])],
        sparkIndexMode: true,
        sql: {
          query:
            "SELECT id, SUBSTR(A.AS_OF, 1, 10) AS busi_date FROM source_table A",
        },
      }),
    ).toEqual({ busi_date: "SUBSTR(A.AS_OF, 1, 10)" });
  });

  it("does not apply sparkIndex projection rules to the default resolver mode", () => {
    expect(
      buildSimpleTaskPartitionMap({
        taskTarget: target,
        tables: [table(["busi_date"])],
        sql: {
          query: "SELECT id, '2026-05-24' AS busi_date FROM source_table",
        },
      }),
    ).toEqual({ busi_date: "2026-05-24" });
    expect(
      buildSimpleTaskPartitionMap({
        taskTarget: target,
        tables: [table(["busi_date"])],
        sql: {
          query:
            "SELECT id, SUBSTR(A.AS_OF, 1, 10) AS busi_date FROM source_table A",
        },
      }),
    ).toBeUndefined();
  });

  it("defaults an unresolved single busi_date partition in sparkIndex mode", () => {
    expect(
      buildCompactTaskPartition({
        taskTarget: target,
        tables: [table(["busi_date"])],
        sparkIndexMode: true,
        sql: {
          query:
            "INSERT OVERWRITE TABLE dm_index_n.index_grp_cust_acct_cnt PARTITION(busi_date) SELECT id, busi_date FROM source_table",
        },
      }),
    ).toEqual({ busi_date: "${YYYY-MM-DD}" });
  });

  it("uses a unique same-query filter value for an implicit partition output", () => {
    expect(
      buildCompactTaskPartition({
        taskTarget: target,
        tables: [table(["src_tbl", "busi_date"])],
        sparkIndexMode: true,
        sql: {
          query:
            "SELECT id, src_tbl, busi_date FROM source_table WHERE src_tbl = 'ODATA_N_TIT.D_V_REPORT_SWAP_TP_A1016_LS' AND busi_date = '${yyyy-MM-dd}'",
        },
      }),
    ).toEqual({
      src_tbl: "ODATA_N_TIT.D_V_REPORT_SWAP_TP_A1016_LS",
      busi_date: "${YYYY-MM-DD}",
    });
  });

  it("keeps multiple implicit alias branches when only one branch uses AS", () => {
    expect(
      buildCompactTaskPartition({
        taskTarget: target,
        tables: [table(["system_name"])],
        sparkIndexMode: true,
        sql: {
          query:
            "SELECT id, system_name FROM (SELECT id, '股衍' AS system_name FROM source_a UNION ALL SELECT id, '固收' system_name FROM source_b) s",
        },
      }),
    ).toEqual([{ system_name: "股衍" }, { system_name: "固收" }]);
  });

  it("defaults busi_date for an implicit final target write", () => {
    expect(
      buildCompactTaskPartition({
        taskTarget: target,
        tables: [table(["busi_date"])],
        sql: {
          query:
            "INSERT OVERWRITE TABLE dm_index_n.index_grp_cust_acct_cnt SELECT source_rows.*, '2026-05-24' AS busi_date FROM source_rows",
        },
      }),
    ).toEqual({ busi_date: "${YYYY-MM-DD}" });
  });

  it("defaults an unresolved busi_mon partition to the month template", () => {
    expect(
      buildCompactTaskPartition({
        taskTarget: target,
        tables: [table(["busi_mon"])],
        sparkIndexMode: true,
        sql: {
          query:
            "INSERT OVERWRITE TABLE dm_index_n.index_grp_cust_acct_cnt PARTITION(busi_mon) SELECT id, busi_mon FROM source_table",
        },
      }),
    ).toEqual({ busi_mon: "${YYYYMM}" });
  });

  it("preserves a relative previous-month template for busi_mon", () => {
    expect(
      buildCompactTaskPartition({
        taskTarget: target,
        tables: [table(["busi_mon"])],
        sparkIndexMode: true,
        sql: {
          query:
            "SELECT id, busi_mon FROM source_table WHERE busi_mon = substr(add_months('${YYYY-MM-DD}', -1), 1, 7)",
        },
      }),
    ).toEqual({ busi_mon: "${YYYY-MM,-1M}" });
  });

  it("derives year and month-number templates only from temporal SQL evidence", () => {
    expect(
      buildCompactTaskPartition({
        taskTarget: target,
        tables: [table(["busi_year"])],
        sparkIndexMode: true,
        sql: {
          query:
            "SELECT substr(busi_date, 1, 4) AS busi_year FROM source_table",
        },
      }),
    ).toEqual({ busi_year: "${YYYY}" });
    expect(
      buildCompactTaskPartition({
        taskTarget: target,
        tables: [table(["mon_no"])],
        sparkIndexMode: true,
        sql: {
          query:
            "SELECT substr('${yyyyMMdd}', 1, 6) AS mon_no FROM source_table",
        },
      }),
    ).toEqual({ mon_no: "${YYYYMM}" });
    expect(
      buildCompactTaskPartition({
        taskTarget: target,
        tables: [table(["mon_no"])],
        sparkIndexMode: true,
        sql: { query: "SELECT mon_no FROM source_table" },
      }),
    ).toEqual({ mon_no: "*" });
  });

  it("combines the busi_date default with proven other partition fields", () => {
    expect(
      buildCompactTaskPartition({
        taskTarget: target,
        tables: [table(["grp_id", "busi_date"])],
        sparkIndexMode: true,
        sql: {
          query:
            "INSERT OVERWRITE TABLE dm_index_n.index_grp_cust_acct_cnt PARTITION(grp_id='01', busi_date) SELECT id, busi_date FROM source_table",
        },
      }),
    ).toEqual({ grp_id: "01", busi_date: "${YYYY-MM-DD}" });
  });

  it("uses a wildcard when another sparkIndex partition field is unknown", () => {
    expect(
      buildCompactTaskPartition({
        taskTarget: target,
        tables: [table(["grp_id", "busi_date"])],
        sparkIndexMode: true,
        sql: {
          query:
            "INSERT OVERWRITE TABLE dm_index_n.index_grp_cust_acct_cnt PARTITION(grp_id, busi_date) SELECT id, grp_id, busi_date FROM source_table",
        },
      }),
    ).toEqual({ grp_id: "*", busi_date: "${YYYY-MM-DD}" });
  });

  it("uses a wildcard for an unenumerated sparkIndex partition value", () => {
    expect(
      buildCompactTaskPartition({
        taskTarget: target,
        tables: [table(["tag_id", "busi_mon"])],
        sparkIndexMode: true,
        sql: {
          query: "SELECT id, tag_id, '${yyyyMM}' AS busi_mon FROM source_table",
        },
      }),
    ).toEqual({ tag_id: "*", busi_mon: "${YYYYMM}" });
  });

  it("canonicalizes concrete dates before comparing partition branches", () => {
    expect(
      buildCompactTaskPartition({
        taskTarget: target,
        tables: [table(["busi_date"])],
        sparkIndexMode: true,
        sql: {
          query:
            "SELECT id, '2026-05-24' AS busi_date FROM source_a UNION ALL SELECT id, '2026-05-25' AS busi_date FROM source_b",
        },
      }),
    ).toEqual({ busi_date: "${YYYY-MM-DD}" });
  });

  it("preserves multiple complete sparkIndex partition instances as an array", () => {
    expect(
      buildCompactTaskPartition({
        taskTarget: target,
        tables: [table(["grp_id", "busi_date"])],
        sparkIndexMode: true,
        sql: {
          query:
            "SELECT id, '01' AS grp_id, '2026-05-24' AS busi_date FROM source_a UNION ALL SELECT id, '02' AS grp_id, '2026-05-24' AS busi_date FROM source_b",
        },
      }),
    ).toEqual([
      { grp_id: "01", busi_date: "${YYYY-MM-DD}" },
      { grp_id: "02", busi_date: "${YYYY-MM-DD}" },
    ]);
  });

  it("preserves multiple ordinary SQL partition instances as an array", () => {
    expect(
      buildCompactTaskPartition({
        taskTarget: target,
        tables: [table(["busi_date", "src_id"])],
        sql: {
          query:
            "INSERT OVERWRITE TABLE dm_index_n.index_grp_cust_acct_cnt PARTITION(busi_date, src_id) SELECT id, '2026-05-24' AS busi_date, 'brk_2' AS src_id FROM source_a UNION ALL SELECT id, '2026-05-24' AS busi_date, 'brk_3' AS src_id FROM source_b; INSERT OVERWRITE TABLE dm_index_n.index_grp_cust_acct_cnt PARTITION(busi_date='2026-05-24', src_id='ecif') SELECT id FROM source_c;",
        },
      }),
    ).toEqual([
      { busi_date: "${YYYY-MM-DD}", src_id: "brk_2" },
      { busi_date: "${YYYY-MM-DD}", src_id: "brk_3" },
      { busi_date: "${YYYY-MM-DD}", src_id: "ecif" },
    ]);
  });

  it("applies partitionBindingOverrides when SQL keeps runtime placeholders", () => {
    expect(
      buildCompactTaskPartition({
        taskTarget: "pdata_n.t05_fin_bdgt_adj_app_evt",
        tables: [table(["src_tbl", "busi_date"])],
        sql: {
          create:
            "CREATE TABLE pdata_n.t05_fin_bdgt_adj_app_evt (id string) PARTITIONED BY (src_tbl string, busi_date string);",
          query:
            "INSERT OVERWRITE TABLE pdata_n.t05_fin_bdgt_adj_app_evt PARTITION(SRC_TBL='${src_table}',BUSI_DATE='${data_day_str}') SELECT 1;",
        },
        partitionBindingOverrides: {
          src_tbl: "ODATA_N_HBM.H_CUX_ADJ_DOCUMENT",
        },
      }),
    ).toEqual({
      src_tbl: "ODATA_N_HBM.H_CUX_ADJ_DOCUMENT",
      busi_date: "${YYYY-MM-DD}",
    });
  });

  it("keeps multiple partition fields as the same flat map", () => {
    expect(
      buildSimpleTaskPartitionMap({
        taskTarget: target,
        tables: [table(["src_tbl", "busi_date"])],
        sparkIndexMode: true,
        sql: {
          query:
            "INSERT OVERWRITE TABLE dm_index_n.index_grp_cust_acct_cnt PARTITION(src_tbl='ODATA_N_TIT.D_REF_TRS', busi_date='2026-08-22') SELECT 1;",
        },
      }),
    ).toEqual({
      src_tbl: "ODATA_N_TIT.D_REF_TRS",
      busi_date: "${YYYY-MM-DD}",
    });
  });

  it("does not infer a wildcard output binding from a source filter", () => {
    expect(
      buildSimpleTaskPartitionMap({
        taskTarget: target,
        tables: [table(["src_tbl"])],
        sql: {
          query:
            "INSERT OVERWRITE TABLE dm_index_n.index_grp_cust_acct_cnt PARTITION(src_tbl) SELECT * FROM source_table WHERE src_tbl='ODATA_N_TIT.D_REF_TRS';",
        },
      }),
    ).toBeUndefined();
  });

  it("does not guess a wildcard write when its partition filter has multiple values", () => {
    expect(
      buildSimpleTaskPartitionMap({
        taskTarget: target,
        tables: [table(["src_tbl"])],
        sql: {
          query:
            "INSERT OVERWRITE TABLE dm_index_n.index_grp_cust_acct_cnt PARTITION(src_tbl) SELECT * FROM source_table WHERE src_tbl IN ('ODATA_N_TIT.D_REF_TRS','ODATA_N_TIT.D_REF_TRS2');",
        },
      }),
    ).toBeUndefined();
  });

  it("uses a final target filter and temp value flow without making temp a conflict", () => {
    const targetTable = table(["src_tbl"]);
    expect(
      buildCompactTaskPartition({
        taskTarget: target,
        tables: [targetTable],
        sql: {
          create:
            "CREATE TABLE dm_index_n.index_grp_cust_acct_cnt (id bigint) PARTITIONED BY (src_tbl string); CREATE TABLE temp.index_stage AS SELECT 'ODATA_N_TIT.D_MARGIN_ACCOUNT' AS src_tbl;",
          query:
            "INSERT OVERWRITE TABLE dm_index_n.index_grp_cust_acct_cnt PARTITION(src_tbl) SELECT * FROM dm_index_n.index_grp_cust_acct_cnt WHERE src_tbl='ODATA_N_TIT.D_MARGIN_ACCOUNT'; INSERT OVERWRITE TABLE dm_index_n.index_grp_cust_acct_cnt PARTITION(src_tbl) SELECT id, src_tbl FROM temp.index_stage;",
        },
      }),
    ).toEqual({ src_tbl: "ODATA_N_TIT.D_MARGIN_ACCOUNT" });
  });

  it("keeps wildcard source-filter evidence explicitly incomplete", () => {
    expect(
      buildTaskPartitionEvidence({
        taskTarget: target,
        tables: [table(["src_tbl"])],
        sql: {
          query:
            "INSERT OVERWRITE TABLE dm_index_n.index_grp_cust_acct_cnt PARTITION(src_tbl) SELECT * FROM source_table WHERE src_tbl='ODATA_N_TIT.D_REF_TRS';",
        },
      }),
    ).toMatchObject({
      status: "INCOMPLETE",
      targets: [
        {
          target,
          status: "INCOMPLETE",
          writes: [
            {
              status: "INCOMPLETE",
              assignments: [
                {
                  field: "src_tbl",
                  status: "UNKNOWN",
                  reason: "DYNAMIC_PARTITION_WILDCARD_OUTPUT",
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it("uses create.sql fields and the implicit query output when INSERT is absent", () => {
    expect(
      buildSimpleTaskPartitionMap({
        taskTarget: target,
        tables: [table()],
        sparkIndexMode: true,
        sql: {
          create:
            "CREATE TABLE dm_index_n.index_grp_cust_acct_cnt (id bigint) PARTITIONED BY (busi_date string)",
          query:
            "SELECT id, '${YYYY-MM-DD}' AS busi_date FROM dm_index_n.source_table",
        },
      }),
    ).toEqual({ busi_date: "${YYYY-MM-DD}" });
  });

  it("uses only the matching CREATE statement as a partition fallback", () => {
    expect(
      buildSimpleTaskPartitionMap({
        taskTarget: target,
        tables: [table()],
        sql: {
          create:
            "CREATE TABLE dm_index_n.other (id bigint) PARTITIONED BY (wrong_field string); CREATE TABLE dm_index_n.index_grp_cust_acct_cnt (id bigint) PARTITIONED BY (busi_date string);",
          query:
            "SELECT id, '${YYYY-MM-DD}' AS busi_date FROM dm_index_n.source_table",
        },
      }),
    ).toEqual({ busi_date: "${YYYY-MM-DD}" });
  });

  it("does not match a qualified CREATE target from another schema", () => {
    expect(
      buildSimpleTaskPartitionMap({
        taskTarget: target,
        tables: [table()],
        sql: {
          create:
            "CREATE TABLE other_schema.index_grp_cust_acct_cnt (id bigint) PARTITIONED BY (busi_date string);",
          query:
            "SELECT id, '${YYYY-MM-DD}' AS busi_date FROM dm_index_n.source_table",
        },
      }),
    ).toBeUndefined();
  });

  it("resolves a unique nested output reference", () => {
    expect(
      buildSimpleTaskPartitionMap({
        taskTarget: target,
        tables: [table()],
        sql: {
          create:
            "CREATE TABLE dm_index_n.index_grp_cust_acct_cnt (id bigint) PARTITIONED BY (busi_date string)",
          query:
            "WITH source_rows AS (SELECT '${YYYY-MM-DD}' AS busi_date FROM src.t) SELECT source_rows.busi_date AS busi_date FROM source_rows",
        },
      }),
    ).toEqual({ busi_date: "${YYYY-MM-DD}" });
  });

  it("uses ADD PARTITION when the query has no INSERT", () => {
    expect(
      buildSimpleTaskPartitionMap({
        taskTarget: target,
        tables: [table()],
        sparkIndexMode: true,
        sql: {
          create:
            "CREATE TABLE dm_index_n.index_grp_cust_acct_cnt (id bigint) PARTITIONED BY (busi_date string)",
          prepare:
            "ALTER TABLE dm_index_n.index_grp_cust_acct_cnt ADD IF NOT EXISTS PARTITION (busi_date='2026-08-22')",
        },
      }),
    ).toEqual({ busi_date: "${YYYY-MM-DD}" });
  });

  it("does not treat source extraction SQL as a target partition", () => {
    expect(
      buildSimpleTaskPartitionMap({
        taskTarget: "odata_n_tit.d_v_wm_cashflow_report_tit",
        tables: [
          {
            ...table(["busi_date"]),
            qualifiedName: "odata_n_tit.d_v_wm_cashflow_report_tit",
          },
        ],
        sql: {
          query:
            "SELECT TRANSFER_ID, to_char(SYSDATE, 'YYYY-MM-DD') AS DATA_TIME FROM TITANS_DM.V_WM_CASHFLOW_REPORT_TIT",
        },
        allowImplicitQueryOutput: false,
      }),
    ).toBeUndefined();
  });

  it("keeps structured unknown evidence for a source extraction task", () => {
    expect(
      buildTaskPartitionEvidence({
        taskTarget: "odata_n_tit.d_v_wm_cashflow_report_tit",
        tables: [
          {
            ...table(["busi_date"]),
            qualifiedName: "odata_n_tit.d_v_wm_cashflow_report_tit",
          },
        ],
        sql: {
          query:
            "SELECT TRANSFER_ID, to_char(SYSDATE, 'YYYY-MM-DD') AS DATA_TIME FROM TITANS_DM.V_WM_CASHFLOW_REPORT_TIT",
        },
        allowImplicitQueryOutput: false,
      }),
    ).toMatchObject({
      status: "INCOMPLETE",
      targets: [
        {
          target: "odata_n_tit.d_v_wm_cashflow_report_tit",
          tableStatus: "PARTITIONED",
          status: "INCOMPLETE",
          writes: [
            {
              assignments: [
                {
                  field: "busi_date",
                  status: "UNKNOWN",
                  reason: "SOURCE_SQL_NOT_TARGET_WRITE",
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it("marks a defaulted single busi_date source partition complete", () => {
    expect(
      buildTaskPartitionEvidence({
        taskTarget: "odata_n_tit.d_v_wm_cashflow_report_tit",
        tables: [
          {
            ...table(["busi_date"]),
            qualifiedName: "odata_n_tit.d_v_wm_cashflow_report_tit",
          },
        ],
        sql: {
          query:
            "SELECT TRANSFER_ID, DATA_TIME FROM TITANS_DM.V_WM_CASHFLOW_REPORT_TIT",
        },
        allowImplicitQueryOutput: false,
        allowSourceTemporalPartitionDefault: true,
      }),
    ).toMatchObject({
      status: "COMPLETE",
      reasonCodes: ["PARTITION_TEMPLATE_FROM_TARGET_AND_SCHEDULER"],
      targets: [
        {
          status: "COMPLETE",
          reasonCodes: ["PARTITION_TEMPLATE_FROM_TARGET_AND_SCHEDULER"],
          writes: [
            {
              status: "INCOMPLETE",
              assignments: [{ status: "UNKNOWN" }],
            },
          ],
        },
      ],
    });
  });

  it("marks a sparkIndex task complete when its fallback summary is available", () => {
    expect(
      buildTaskPartitionEvidence({
        taskTarget: target,
        tables: [table(["busi_date"])],
        sparkIndexMode: true,
        sql: {
          query:
            "INSERT OVERWRITE TABLE dm_index_n.index_grp_cust_acct_cnt PARTITION(busi_date) SELECT id FROM source_table",
        },
      }),
    ).toMatchObject({
      status: "COMPLETE",
      targets: [
        {
          status: "COMPLETE",
        },
      ],
    });
  });

  it("excludes the platform synthetic insert target from partition evidence", () => {
    const evidence = buildTaskPartitionEvidence({
      taskTarget: "features.client_label_latest",
      tables: [
        {
          ...table(["dim_index"]),
          qualifiedName: "temp_n.client_label",
        },
      ],
      sql: {
        query:
          "INSERT INTO PLACEHOLDER_INSERT_DB.PLACEHOLDER_INSERT_TABLE(client) SELECT client FROM src.t; INSERT OVERWRITE TABLE temp_n.client_label PARTITION(dim_index) SELECT client, 'grp1' AS dim_index FROM src.t;",
      },
    });

    expect(evidence.targets.map((item) => item.target)).toEqual([
      "features.client_label_latest",
      "temp_n.client_label",
    ]);
    expect(evidence.targets).not.toContainEqual(
      expect.objectContaining({
        target: "placeholder_insert_db.placeholder_insert_table",
      }),
    );
    expect(evidence.targets[0]).toMatchObject({
      target: "features.client_label_latest",
      status: "UNKNOWN",
      reasonCodes: ["TABLE_PACK_PARTITION_FIELDS_UNAVAILABLE"],
    });
    expect(evidence.targets[1]).toMatchObject({
      target: "temp_n.client_label",
      status: "COMPLETE",
    });
  });
});
