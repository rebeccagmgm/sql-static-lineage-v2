import type {
  TableEvidence,
  TaskEvidence,
} from "../../../scripts/input/shared/input-pack.ts";

export const cases: Record<
  string,
  { task: TaskEvidence; tables: TableEvidence[] }
> = {
  "39045": {
    task: {
      taskId: "39045",
      taskCategory: "mysql2hive",
      taskType: "mysql2hive",
      source: { platform: "mysql", qualifiedName: "otc_src.deal" },
      target: { platform: "hive", qualifiedName: "dm_otc.deal" },
      writeMode: "append",
      partition: null,
      evidenceProvider: "fixture-horae",
      sql: {
        query: {
          content: "SELECT deal_id, amount FROM otc_src.deal;\n",
          evidenceProvider: "fixture-szdata",
        },
      },
    },
    tables: [
      {
        platform: "mysql",
        dataSource: "mysql-test",
        qualifiedName: "otc_src.deal",
        objectType: "TABLE",
        ddl: "CREATE TABLE otc_src.deal (deal_id BIGINT, amount DECIMAL(18,2));\n",
        evidenceProvider: "fixture-metadata",
      },
      {
        platform: "hive",
        dataSource: "hive-test",
        qualifiedName: "dm_otc.deal",
        objectType: "TABLE",
        partitionFields: [],
        ddl: "CREATE TABLE dm_otc.deal (deal_id BIGINT, amount DECIMAL(18,2));\n",
        evidenceProvider: "fixture-metadata",
      },
    ],
  },
  "180065": {
    task: {
      taskId: "180065",
      taskCategory: "hive2oracle",
      taskType: "hive2oracle",
      source: { platform: "hive", qualifiedName: "dm_otc.position" },
      target: { platform: "oracle", qualifiedName: "otc_position" },
      writeMode: "truncate",
      partition: null,
      evidenceProvider: "fixture-horae",
      sql: {
        query: {
          content:
            "SELECT account_id, busi_date FROM dm_otc.position WHERE busi_date='${yyyy-MM-dd}';\n",
          evidenceProvider: "fixture-szdata",
        },
        truncate: {
          content: "TRUNCATE TABLE otc_position;\n",
          evidenceProvider: "fixture-szdata",
        },
      },
    },
    tables: [
      {
        platform: "hive",
        dataSource: "hive-test",
        qualifiedName: "dm_otc.position",
        objectType: "TABLE",
        partitionFields: ["busi_date"],
        ddl: "CREATE TABLE dm_otc.position (account_id BIGINT) PARTITIONED BY (busi_date STRING);\n",
        evidenceProvider: "fixture-metadata",
      },
      {
        platform: "oracle",
        dataSource: "oracle-test",
        qualifiedName: "otc_position",
        objectType: "TABLE",
        partitionFields: [],
        ddl: "CREATE TABLE otc_position (account_id NUMBER, busi_date VARCHAR2(10));\n",
        evidenceProvider: "fixture-metadata",
      },
    ],
  },
  "86840": {
    task: {
      taskId: "86840",
      taskCategory: "hiveTask-2.0",
      taskType: "hive2hive",
      source: { platform: "hive", qualifiedName: "dm_otc.source_case" },
      target: { platform: "hive", qualifiedName: "dm_otc.target_case" },
      writeMode: "overwrite",
      partition: null,
      evidenceProvider: "fixture-horae",
      sql: {
        create: {
          content: "CREATE TABLE dm_otc.target_case (id BIGINT);\n",
          evidenceProvider: "fixture-szdata",
        },
        query: {
          content:
            "INSERT OVERWRITE TABLE dm_otc.target_case SELECT id FROM dm_otc.source_case;\n",
          evidenceProvider: "fixture-szdata",
        },
      },
    },
    tables: [
      {
        platform: "hive",
        dataSource: "hive-test",
        qualifiedName: "dm_otc.target_case",
        objectType: "TABLE",
        partitionFields: [],
        ddl: "CREATE TABLE dm_otc.target_case (id BIGINT) STORED AS ORC;\n",
        evidenceProvider: "fixture-metadata",
      },
    ],
  },
  "246247": {
    task: {
      taskId: "246247",
      taskCategory: "hive2oracle",
      taskType: "hive2oracle",
      source: { platform: "hive", qualifiedName: "dm_otc.source_case" },
      target: { platform: "oracle", qualifiedName: "otc_case" },
      writeMode: "truncate",
      evidenceProvider: "fixture-horae",
      sql: {
        truncate: {
          content: "DELETE FROM otc_case WHERE batch_id = '${batch_id}';\n",
          evidenceProvider: "fixture-szdata",
        },
      },
    },
    tables: [],
  },
};
