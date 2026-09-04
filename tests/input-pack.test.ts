import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SqlSession } from "sqllens";
import { cases } from "./fixtures/input-pack/cases.ts";
import {
  canonicalHash,
  canonicalJson,
  assertExistingTableLayout,
  createTableDocument,
  createTaskDocument,
  isFrozenScheduleStatus,
  isManualScheduleCycle,
  quarantineMalformedTableDirectories,
  sha256Text,
  stableTableId,
  validateTableDocument,
  validateTaskDocument,
  writeTableInput,
  writeTaskInput,
} from "../scripts/input/shared/input-pack.ts";
import {
  controlledTaskEndpointDataSource,
  controlledTaskEndpointPlatform,
  enrichTaskEndpoint,
  inputCollectionStatus,
  shouldUseTaskRelationFallback,
  targetEvidenceKindFor,
} from "../scripts/input/shared/task-endpoints.ts";
import {
  findSqlFinalTargetEvidence,
  findSqlTargetEvidence,
} from "../scripts/input/shared/sql-target-evidence.ts";
import {
  assertInputPackBatchSize,
  exitCodeForTaskBatch,
  runTaskBatch,
  StopTaskBatch,
} from "../scripts/input/mainline/task-batch.ts";
import {
  environmentMilliseconds,
  findStaleLegacyTaskDirectories,
  hasPhysicalTableEvidenceGap,
  isExcludedHoraeSearchRecord,
  normalizeCollectedSqlSlot,
  normalizeConcatenatedSqlStatements,
  repairOrphanedSqlCommentContinuations,
  normalizeRepeatedSqlContent,
  partitionTaskIdsForCollection,
  relocateTaskPacks,
  selectTableCandidate,
  taskCategory,
  toTaskEvidence,
  unresolvedPhysicalEndpointReference,
} from "../scripts/input/mainline/collect-one-task-input-pack.ts";
import {
  assertStatusFileOutsideDataRoot,
  canSkipSuccessfulTask,
  loadTaskStatus,
  saveTaskStatus,
  updateTaskStatus,
} from "../scripts/input/mainline/task-status.ts";

function dataRoot(): string {
  return mkdtempSync(join(tmpdir(), "sql-static-lineage-input-pack-"));
}

describe("Input Pack V1", () => {
  it("preserves platform SQL bytes instead of normalizing canonical evidence", () => {
    const rawSql =
      "CREATE TABLE demo.today AS SELECT id --编号 ,CASE WHEN x IS NULL THEN 1 ELSE 0 END AS flag FROM (\n;\nSELECT id FROM raw.source\n) A;";
    const result = toTaskEvidence("105387", {
      taskType: "hiveTask",
      sqlSlots: {
        create: {
          available: true,
          source: "sql-mcp",
          sources: ["sql-mcp"],
          sql: rawSql,
        },
      },
    });

    expect(result.warnings).toEqual([]);
    expect(result.evidence.sql?.create).toEqual({
      content: rawSql,
      evidenceProvider: "sql-mcp",
    });

    const root = dataRoot();
    const written = writeTaskInput(root, result.evidence);
    expect(
      readFileSync(join(written.directory, "sql", "create.sql"), "utf8"),
    ).toBe(rawSql);
  });

  it("publishes strict task and table JSON Schema contracts", () => {
    const taskSchema = JSON.parse(
      readFileSync(
        join(process.cwd(), "schemas", "task-input-pack-task.schema.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    const tableSchema = JSON.parse(
      readFileSync(
        join(process.cwd(), "schemas", "task-input-pack-table.schema.json"),
        "utf8",
      ),
    ) as Record<string, unknown>;
    expect(taskSchema.additionalProperties).toBe(false);
    expect(tableSchema.additionalProperties).toBe(false);
    expect(taskSchema.properties).not.toHaveProperty("inputs");
    expect(tableSchema.properties).not.toHaveProperty("tableRef");
    expect(taskSchema.$defs).not.toHaveProperty("partitionEvidence");
  });

  it("preserves direct Horae schedule-cycle evidence and recognizes manual labels", () => {
    const document = createTaskDocument({
      taskId: "manual-1",
      taskCategory: "sparkIndex",
      taskName: "manual-task",
      scheduleCycle: "手工",
      evidenceProvider: "fixture:task",
    });
    expect(document.scheduleCycle).toBe("手工");
    expect(isManualScheduleCycle(document.scheduleCycle)).toBe(true);
    expect(isManualScheduleCycle("每日")).toBe(false);
    validateTaskDocument(document);
  });

  it("preserves frozen Horae status in the Task Pack contract", () => {
    const document = createTaskDocument({
      taskId: "frozen-1",
      taskCategory: "sparkIndex",
      scheduleStatus: "F",
      evidenceProvider: "fixture:task",
    });
    expect(document.scheduleStatus).toBe("F");
    expect(isFrozenScheduleStatus(document.scheduleStatus)).toBe(true);
    expect(isFrozenScheduleStatus("冻结")).toBe(true);
    expect(isFrozenScheduleStatus("Y")).toBe(false);
    validateTaskDocument(document);
  });

  it("stores one-hop Horae schedule neighbor task ids as task configuration", () => {
    const document = createTaskDocument({
      taskId: "144127",
      taskCategory: "sparkIndex",
      upstreamTaskIds: ["200", "100", "100"],
      downstreamTaskIds: [],
      evidenceProvider: "fixture:task",
    });
    expect(document.upstreamTaskIds).toEqual(["100", "200"]);
    expect(document.downstreamTaskIds).toEqual([]);
    validateTaskDocument(document);
    expect(() =>
      validateTaskDocument({
        ...document,
        upstreamTaskIds: ["200", "100"],
      }),
    ).toThrow(/upstreamTaskIds must be sorted/);
  });

  it("does not classify a normal task as frozen when the search filter is loose", () => {
    expect(
      isExcludedHoraeSearchRecord(
        { id: "102845", cycle: "每日", status: "正常" },
        { status: "F" },
      ),
    ).toBe(false);
    expect(
      isExcludedHoraeSearchRecord(
        { id: "frozen-1", cycle: "每日", status: "F" },
        { status: "F" },
      ),
    ).toBe(true);
    expect(
      isExcludedHoraeSearchRecord({ id: "frozen-2", cycle: "每日" }, {
        status: "F",
      }),
    ).toBe(true);
    expect(
      isExcludedHoraeSearchRecord(
        { id: "manual-1", cycle: "每日", status: "Y" },
        { status: "Y", cycle: "手工" },
      ),
    ).toBe(false);
  });

  it("keeps excluded task IDs out of the runnable collection set", () => {
    const partition = partitionTaskIdsForCollection(
      ["normal-1", "frozen-1", "missing-1", "physical-missing-1"],
      new Map([
        ["frozen-1", { exclusionReason: "MANUAL_OR_FROZEN" }],
        ["missing-1", { exclusionReason: "HORAE_TASK_NOT_FOUND" }],
        [
          "physical-missing-1",
          { exclusionReason: "PHYSICAL_TABLE_NOT_FOUND" },
        ],
      ]),
    );

    expect(partition).toEqual({
      runnableTaskIds: ["normal-1"],
      manualFrozenTaskIds: ["frozen-1"],
      notFoundTaskIds: ["missing-1", "physical-missing-1"],
    });
  });

  it("relocates an existing manual Task Pack without overwriting evidence", () => {
    const root = dataRoot();
    const archive = dataRoot();
    const written = writeTaskInput(root, {
      taskId: "manual-1",
      taskCategory: "sparkIndex",
      scheduleCycle: "手工",
      evidenceProvider: "fixture:task",
    });

    const moved = relocateTaskPacks(root, archive, "manual-1");

    expect(moved).toEqual([join(archive, "tasks", "sparkIndex", "manual-1")]);
    expect(existsSync(written.directory)).toBe(false);
    expect(
      existsSync(join(archive, "tasks", "sparkIndex", "manual-1", "task.json")),
    ).toBe(true);
  });

  it("continues after one task failure and returns a failing aggregate signal", () => {
    const attempted: string[] = [];
    const failures: string[] = [];
    const hadFailure = runTaskBatch(
      "fixture-root",
      ["ok-1", "bad", "ok-2"],
      (_root, taskId) => {
        attempted.push(taskId);
        if (taskId === "bad") throw new Error("fixture failure");
      },
      (taskId) => failures.push(taskId),
    );
    expect(attempted).toEqual(["ok-1", "bad", "ok-2"]);
    expect(failures).toEqual(["bad"]);
    expect(hadFailure).toBe(true);
    expect(exitCodeForTaskBatch(hadFailure)).toBe(1);
    expect(exitCodeForTaskBatch(false)).toBe(0);
  });

  it("stops a batch without reporting a post-checkpoint size stop as task failure", () => {
    const attempted: string[] = [];
    const failures: string[] = [];
    const hadFailure = runTaskBatch(
      "fixture-root",
      ["first", "second"],
      (_root, taskId) => {
        attempted.push(taskId);
        if (taskId === "first") throw new StopTaskBatch("checkpoint limit");
      },
      (taskId) => failures.push(taskId),
    );
    expect(attempted).toEqual(["first"]);
    expect(failures).toEqual([]);
    expect(hadFailure).toBe(false);
  });

  it("enforces the batch size limit and positive environment overrides", () => {
    expect(() => assertInputPackBatchSize(1000)).not.toThrow();
    expect(() => assertInputPackBatchSize(1001)).toThrow(/at most 1000/);
    const variable = "INPUT_PACK_TEST_MILLISECONDS";
    const previous = process.env[variable];
    try {
      delete process.env[variable];
      expect(environmentMilliseconds(variable, 3000)).toBe(3000);
      process.env[variable] = "1";
      expect(environmentMilliseconds(variable, 3000)).toBe(1);
      for (const invalid of ["0", "-1", "1.5", "invalid"]) {
        process.env[variable] = invalid;
        expect(() => environmentMilliseconds(variable, 3000)).toThrow(
          /positive integer/,
        );
      }
    } finally {
      if (previous === undefined) delete process.env[variable];
      else process.env[variable] = previous;
    }
  });

  it("uses the authoritative Horae type dictionary for task categories", () => {
    expect(taskCategory("30", undefined)).toBe("hive2mysql");
    expect(taskCategory("30", "legacy-hive2mysql")).toBe("hive2mysql");
    expect(taskCategory("999", "platform-new-type")).toBe("platform-new-type");
    expect(taskCategory("999", "中文/非法类型")).toBe("taskType-999");
    expect(taskCategory("999", undefined)).toBe("taskType-999");
  });

  it("removes only an adjacent duplicate SQL block and records the clean content", () => {
    const sql = `SELECT id\nFROM demo.source\n\nSELECT id\nFROM demo.source`;
    expect(normalizeRepeatedSqlContent(sql)).toEqual({
      content: "SELECT id\nFROM demo.source\n",
      duplicateBlocksRemoved: true,
    });
    expect(normalizeRepeatedSqlContent("SELECT id\nFROM demo.source")).toEqual({
      content: "SELECT id\nFROM demo.source\n",
      duplicateBlocksRemoved: false,
    });
  });

  it("separates concatenated top-level SQL statements without splitting INSERT SELECT or UNION", () => {
    const concatenated =
      "INSERT INTO demo.target\nSELECT id FROM demo.source\n\nSELECT id FROM demo.source";
    expect(normalizeConcatenatedSqlStatements(concatenated)).toEqual({
      content:
        "INSERT INTO demo.target\nSELECT id FROM demo.source\n\n;\nSELECT id FROM demo.source",
      separatorsInserted: 1,
      inlineCommentBoundariesInserted: 0,
      inlineCommentBoundaryKinds: [],
    });
    expect(
      normalizeConcatenatedSqlStatements(
        "SELECT id FROM demo.source\nUNION\nSELECT id FROM demo.source",
      ).separatorsInserted,
    ).toBe(0);

    expect(
      normalizeConcatenatedSqlStatements(
        "INSERT INTO demo.target VALUES (?)\n\nSELECT id FROM demo.source",
      ),
    ).toEqual({
      content:
        "INSERT INTO demo.target VALUES (?)\n\n;\nSELECT id FROM demo.source",
      separatorsInserted: 1,
      inlineCommentBoundariesInserted: 0,
      inlineCommentBoundaryKinds: [],
    });
  });

  it("repairs 103935-style inline field comments before statement separation", () => {
    const compressed = [
      "CREATE TABLE demo.base (id STRING);",
      "CREATE TABLE demo.today AS SELECT src_id AS id --协议编号 ,'TIT' AS src --数据来源 FROM (",
      "  SELECT src_id FROM raw.source",
      ") A;",
      "CREATE TABLE demo.mid AS SELECT CASE WHEN A.id IS NULL THEN 'I' --新增 WHEN A.id IS NOT NULL THEN 'U' --变更 ELSE 'S' END AS change_type --状态 FROM (SELECT id FROM demo.a) A --历史 FULL OUTER JOIN demo.b B --当天 ON A.id = B.id;",
    ].join("\n");
    const repeated = normalizeRepeatedSqlContent(compressed);
    const normalized = normalizeConcatenatedSqlStatements(repeated.content);
    const session = SqlSession.create(normalized.content, "databricks");
    const statements = session.doc.statements.filter(
      (cell) => cell.text.trim() !== "",
    );

    expect(statements).toHaveLength(3);
    expect(statements.slice(1).flatMap((cell) => cell.diagnostics)).toEqual([]);
    expect(normalized.content).toContain("--协议编号 \n,'TIT' AS src");
    expect(normalized.content).toContain("--新增 \nWHEN A.id IS NOT NULL");
    expect(normalized.content).toContain("--当天 \nON A.id = B.id");
    expect(normalized.inlineCommentBoundariesInserted).toBe(7);

    const collected = normalizeCollectedSqlSlot(
      compressed,
      "create",
      "fixture:task-source",
    );
    expect(collected.warnings).toContain(
      "SQL_INLINE_COMMENT_BOUNDARY_REPAIRED:create:7:CASE_ELSE=1,CASE_WHEN=1,COMMA_SELECT_ITEM=1,FROM_SUBQUERY=2,JOIN_ON=1,TYPED_JOIN=1",
    );
    expect(collected.evidenceProvider).toBe(
      "fixture:task-source,collector:inline-comment-boundary-repair-v1",
    );
    expect(
      normalizeConcatenatedSqlStatements(normalized.content)
        .inlineCommentBoundariesInserted,
    ).toBe(0);
  });

  it("repairs a DDL column comma swallowed by an inline comment", () => {
    const sql =
      "CREATE TABLE demo.base (\n" +
      "  first_col STRING COMMENT 'first' -- added later,\n" +
      "  second_col STRING COMMENT 'second'\n" +
      ");";

    const collected = normalizeCollectedSqlSlot(
      sql,
      "create",
      "fixture:task-source",
    );

    expect(collected.content).toContain(
      "-- added later\n,\n  second_col STRING",
    );
    expect(collected.warnings).toContain(
      "SQL_INLINE_COMMENT_BOUNDARY_REPAIRED:create:1:COMMA_COLUMN_DEFINITION=1",
    );
    expect(
      SqlSession.create(collected.content, "databricks").syntaxDiagnostics,
    ).toEqual([]);
  });

  it("restores orphaned comment continuations in task-source SQL", () => {
    const sql = [
      "SELECT User_Id -- 用户编号;",
      "",
      "CONCAT('HPB020-', L_OPERATOR_NO)",
      ", substr(User_Id, 8) AS src_user_id",
      "FROM demo.users;",
      "SELECT cust_type_cd, --客户类型代码 0 个人;",
      "",
      "1 机构;",
      "",
      "3 产品",
      ", period_type",
      "FROM demo.customer_types;",
      "SELECT value --case when x is null",
      "else fallback end",
      ", x FROM demo.values;",
      "SELECT '<br>交易对手B(比例)' AS note;",
    ].join("\n");

    const repaired = repairOrphanedSqlCommentContinuations(sql);
    expect(repaired.continuationLinesRepaired).toBe(4);
    expect(repaired.content).toContain(
      "-- CONCAT('HPB020-', L_OPERATOR_NO)",
    );
    expect(repaired.content).toContain("-- 1 机构;");
    expect(repaired.content).toContain("-- else fallback end");
    expect(repaired.content).not.toContain("-- <br>交易对手B");

    const collected = normalizeCollectedSqlSlot(
      sql,
      "query",
      "fixture:task-source",
    );
    expect(collected.warnings).toContain(
      "SQL_ORPHANED_COMMENT_CONTINUATION_REPAIRED:query:4",
    );
  });

  it("does not repair SQL-like text inside strings, block comments, or ordinary line comments", () => {
    const safe = [
      "SELECT '-- note ,''x'' AS fake FROM ( UNION ALL SELECT' AS txt;",
      "SELECT 1 /* -- note ,'x' AS fake WHEN x THEN y FROM ( */;",
      "SELECT id -- ordinary note mentioning FROM and WHEN without a SQL continuation",
      "FROM demo.source;",
      "-- example only: ,'x' AS fake FROM ( UNION ALL SELECT",
      "SELECT 2;",
    ].join("\n");
    const repeated = normalizeRepeatedSqlContent(safe);

    expect(normalizeConcatenatedSqlStatements(repeated.content).content).toBe(
      repeated.content,
    );
  });

  it("reports a legacy task directory when a category mapping changes", () => {
    const root = dataRoot();
    mkdirSync(join(root, "tasks", "taskType-30", "244616"), {
      recursive: true,
    });
    writeFileSync(
      join(root, "tasks", "taskType-30", "244616", "task.json"),
      "{}",
    );
    mkdirSync(join(root, "tasks", "hive2mysql", "244616"), {
      recursive: true,
    });
    expect(
      findStaleLegacyTaskDirectories(root, "244616", "hive2mysql"),
    ).toEqual([join("tasks", "taskType-30", "244616")]);
  });

  it("persists clean task status and does not reuse partial status", () => {
    const root = dataRoot();
    const taskWrite = writeTaskInput(root, {
      ...cases["39045"].task,
      taskId: "244616",
    });
    const tableAssets = cases["39045"].tables.map((table) =>
      writeTableInput(root, table),
    );
    const statusFile = `${root}.input-pack-status.json`;
    const status = loadTaskStatus(statusFile, root);
    updateTaskStatus(status, {
      taskId: "244616",
      status: "SUCCESS",
      taskCategory: "mysql2hive",
      taskType: "30",
      directory: taskWrite.directory,
      contentHash: taskWrite.contentHash,
      tablesWritten: tableAssets.length,
      tableAssets: tableAssets.map((asset) => ({
        directory: asset.directory,
        contentHash: asset.contentHash,
      })),
      warnings: [],
      staleLegacyTaskDirectories: [],
    });
    saveTaskStatus(statusFile, status);
    const loaded = loadTaskStatus(statusFile, root);
    expect(canSkipSuccessfulTask(loaded.tasks["244616"], root)).toBe(true);
    writeFileSync(join(taskWrite.directory, "task.json"), "{}\n");
    expect(canSkipSuccessfulTask(loaded.tasks["244616"], root)).toBe(false);
    writeTaskInput(root, { ...cases["39045"].task, taskId: "244616" });
    writeFileSync(join(tableAssets[0].directory, "ddl.sql"), "changed\n");
    expect(canSkipSuccessfulTask(loaded.tasks["244616"], root)).toBe(false);
    updateTaskStatus(loaded, {
      taskId: "244616",
      status: "PARTIAL",
      taskCategory: "mysql2hive",
      taskType: "30",
      directory: taskWrite.directory,
      contentHash: taskWrite.contentHash,
      tablesWritten: tableAssets.length,
      tableAssets: tableAssets.map((asset) => ({
        directory: asset.directory,
        contentHash: asset.contentHash,
      })),
      warnings: ["TABLE_REFERENCE_UNAVAILABLE"],
      staleLegacyTaskDirectories: [],
    });
    saveTaskStatus(statusFile, loaded);
    const partial = loadTaskStatus(statusFile, root);
    expect(canSkipSuccessfulTask(partial.tasks["244616"], root)).toBe(false);
  });

  it("persists a Horae-not-found exclusion for later batches", () => {
    const root = dataRoot();
    const statusFile = `${root}.input-pack-status.json`;
    const status = loadTaskStatus(statusFile, root);
    updateTaskStatus(status, {
      taskId: "73322",
      status: "EXCLUDED",
      exclusionReason: "HORAE_TASK_NOT_FOUND",
      changed: false,
      warnings: [],
      staleLegacyTaskDirectories: [],
    });
    saveTaskStatus(statusFile, status);

    const loaded = loadTaskStatus(statusFile, root);
    expect(loaded.tasks["73322"]).toMatchObject({
      status: "EXCLUDED",
      exclusionReason: "HORAE_TASK_NOT_FOUND",
    });

    updateTaskStatus(loaded, {
      taskId: "166630",
      status: "EXCLUDED",
      exclusionReason: "PHYSICAL_TABLE_NOT_FOUND",
      changed: false,
      warnings: [],
      staleLegacyTaskDirectories: [],
    });
    saveTaskStatus(statusFile, loaded);
    expect(loadTaskStatus(statusFile, root).tasks["166630"]).toMatchObject({
      status: "EXCLUDED",
      exclusionReason: "PHYSICAL_TABLE_NOT_FOUND",
    });

    updateTaskStatus(loaded, {
      taskId: "frozen-1",
      status: "EXCLUDED",
      exclusionReason: "MANUAL_OR_FROZEN",
      changed: false,
      warnings: [],
    });
    saveTaskStatus(statusFile, loaded);
    expect(loadTaskStatus(statusFile, root).tasks["frozen-1"]).toMatchObject({
      status: "EXCLUDED",
      exclusionReason: "MANUAL_OR_FROZEN",
    });
  });

  it("rejects status files inside the Input Pack data root and recovers an orphan checkpoint", () => {
    const root = dataRoot();
    expect(() =>
      assertStatusFileOutsideDataRoot(join(root, "status.json"), root),
    ).toThrow();
    const statusFile = `${root}.input-pack-status.json`;
    const status = loadTaskStatus(statusFile, root);
    updateTaskStatus(status, {
      taskId: "orphan-checkpoint",
      status: "FAILED",
      error: "test",
      warnings: [],
      staleLegacyTaskDirectories: [],
    });
    saveTaskStatus(statusFile, status);
    renameSync(statusFile, `${statusFile}.test.bak`);
    const recovered = loadTaskStatus(statusFile, root);
    expect(recovered.tasks["orphan-checkpoint"]?.status).toBe("FAILED");
    saveTaskStatus(statusFile, recovered);
    renameSync(statusFile, `${statusFile}.corrupt.bak`);
    writeFileSync(statusFile, "{broken\n");
    const recoveredFromCorruptPrimary = loadTaskStatus(statusFile, root);
    expect(recoveredFromCorruptPrimary.tasks["orphan-checkpoint"]?.status).toBe(
      "FAILED",
    );
  });

  it("accepts only an unambiguous structural SQL target as SQL evidence", () => {
    expect(
      findSqlTargetEvidence(
        {
          query:
            "INSERT OVERWRITE TABLE T98_OTC_OPT_COMP_SUB_TRD_BASE_INFO PARTITION (BUSI_DATE='2026-08-13') SELECT 1",
        },
        "PDATA_N.T98_OTC_OPT_COMP_SUB_TRD_BASE_INFO_TIT125_h15",
      ),
    ).toMatchObject({
      qualifiedName: "PDATA_N.T98_OTC_OPT_COMP_SUB_TRD_BASE_INFO",
      slot: "query",
      statementKind: "INSERT_TABLE",
    });
    const mismatchedTaskNameSql = {
      query:
        "INSERT OVERWRITE TABLE t02_co_hk_income_ext PARTITION (src_id='THC', grp_id='01') SELECT 1",
    };
    expect(
      findSqlTargetEvidence(
        mismatchedTaskNameSql,
        "pdata_news_n.t02_co_hk_income_ext_THC_pl_grp01",
      ),
    ).toBeUndefined();
    expect(
      findSqlTargetEvidence(
        mismatchedTaskNameSql,
        "pdata_news_n.t02_co_hk_income_ext_THC_pl_grp01",
        { allowSchemaOnlyQualification: true },
      )?.qualifiedName,
    ).toBe("pdata_news_n.t02_co_hk_income_ext");
    expect(
      findSqlTargetEvidence(
        { query: "SELECT * FROM PDATA_N.T98_OTC_OPT_COMP_SUB_TRD_BASE_INFO" },
        "PDATA_N.T98_OTC_OPT_COMP_SUB_TRD_BASE_INFO_TIT125_h15",
      ),
    ).toBeUndefined();
    expect(
      findSqlTargetEvidence(
        {
          query:
            "SELECT 'INSERT OVERWRITE TABLE PDATA_N.fake_target' AS note, col FROM PDATA_N.real_source",
        },
        "PDATA_N.fake_target_job",
      ),
    ).toBeUndefined();
    expect(
      findSqlTargetEvidence(
        {
          query:
            "INSERT OVERWRITE TABLE FIRST_TABLE SELECT 1; INSERT INTO TABLE SECOND_TABLE SELECT 1",
        },
        "PDATA_N.UNRELATED_TASK",
      ),
    ).toBeUndefined();
    expect(
      findSqlTargetEvidence(
        { truncate: "DELETE FROM PDATA_N.T98_OTC_OPT_COMP_SUB_TRD_BASE_INFO" },
        "PDATA_N.T98_OTC_OPT_COMP_SUB_TRD_BASE_INFO_TIT125_h15",
      ),
    ).toMatchObject({
      statementKind: "DELETE_TABLE",
    });
  });

  it("selects the task-matching final INSERT among intermediate materializations", () => {
    const sql = {
      create:
        "CREATE TABLE pwc_psn_sys_user_roles_temp AS SELECT 1; CREATE TABLE pwc_psn_sys_user_roles AS SELECT 1",
      query:
        "INSERT OVERWRITE TABLE pwc_psn_sys_user_roles_temp SELECT 1; INSERT OVERWRITE TABLE pwc_psn_sys_user_roles SELECT 1",
    };
    expect(
      findSqlTargetEvidence(sql, "dm_ctms_n.ctms_pwc_psn_sys_user_roles"),
    ).toBeUndefined();
    expect(
      findSqlFinalTargetEvidence(sql, "dm_ctms_n.pwc_psn_sys_user_roles"),
    ).toMatchObject({
      qualifiedName: "dm_ctms_n.pwc_psn_sys_user_roles",
      statementKind: "INSERT_TABLE",
    });
  });

  it("selects a later terminal INSERT when the task name has a different suffix", () => {
    const sql = {
      query:
        "INSERT OVERWRITE TABLE pwc_psn_sys_user_roles_temp SELECT 1; " +
        "INSERT OVERWRITE TABLE pwc_psn_sys_user_roles " +
        "SELECT 1 FROM pwc_psn_sys_user_roles_temp",
    };
    expect(
      findSqlFinalTargetEvidence(sql, "dm_ctms_n.ctms_pwc_psn_sys_user_roles", {
        allowSchemaOnlyQualification: true,
      }),
    ).toMatchObject({
      qualifiedName: "dm_ctms_n.pwc_psn_sys_user_roles",
      statementKind: "INSERT_TABLE",
    });
  });

  it("keeps a target that is read inside its own INSERT statement", () => {
    const sql = {
      query:
        "INSERT OVERWRITE TABLE dm_index_n.grp_def PARTITION (grp_type_code='OFFLINE_CUST') " +
        "SELECT grp_id FROM dm_index_n.grp_def WHERE grp_type_code='OFFLINE_CUST';",
    };
    expect(
      findSqlFinalTargetEvidence(sql, "dm_index_n.grp_def_OFFLINE_CUST"),
    ).toMatchObject({
      qualifiedName: "dm_index_n.grp_def",
      statementKind: "INSERT_TABLE",
    });
  });

  it("canonicalizes JSON keys and excludes volatile fields from content hashes", () => {
    const first = {
      z: 1,
      nested: { b: 2, a: ["x", true] },
      a: "value",
      collectedAt: "one",
    } as const;
    const second = {
      a: "value",
      collectedAt: "two",
      nested: { a: ["x", true], b: 2 },
      z: 1,
    } as const;
    expect(canonicalJson(first as never)).not.toBe(
      canonicalJson(second as never),
    );
    expect(canonicalHash(first as never, ["collectedAt"])).toBe(
      canonicalHash(second as never, ["collectedAt"]),
    );
    const compact = JSON.parse('{"a":1,"nested":{"b":2}}');
    const spaced = JSON.parse('{ "nested": { "b": 2 }, "a": 1 }');
    expect(canonicalHash(compact, [])).toBe(canonicalHash(spaced, []));
  });

  it("changes file and owning content hashes when UTF-8 content changes", () => {
    const first = createTaskDocument({
      ...cases["39045"].task,
      collectedAt: "2026-01-01T00:00:00Z",
    });
    const second = createTaskDocument({
      ...cases["39045"].task,
      collectedAt: "2026-01-01T00:00:00Z",
      sql: { query: "SELECT deal_id, amount, status FROM otc_src.deal;\n" },
    });
    expect(first.sqlFiles[0]).toMatchObject({
      sha256: sha256Text("SELECT deal_id, amount FROM otc_src.deal;\n"),
    });
    expect(first.contentHash).not.toBe(second.contentHash);
  });

  it("uses a readable qualified-name and data-source table identity while retaining GUID metadata", () => {
    const withGuid = stableTableId({
      guid: "guid-123",
      platform: "hive",
      dataSource: "same",
      qualifiedName: "dm_otc.deal",
    });
    expect(withGuid).toEqual({
      stableTableId: "dm_otc.deal__same",
      guid: "guid-123",
    });
    const one = stableTableId({
      guid: null,
      platform: "hive",
      dataSource: "cluster-a",
      qualifiedName: "dm_otc.deal",
    });
    const two = stableTableId({
      guid: null,
      platform: "hive",
      dataSource: "cluster-b",
      qualifiedName: "dm_otc.deal",
    });
    expect(one.stableTableId).toBe("dm_otc.deal__cluster-a");
    expect(two.stableTableId).toBe("dm_otc.deal__cluster-b");
    expect(
      stableTableId({
        guid: "guid-default",
        platform: "oracle",
        dataSource: "default",
        qualifiedName: "TITANS_TRADEFLOW.TRANS_T_REPORT_ETF_COMPONENT",
      }).stableTableId,
    ).toBe("TITANS_TRADEFLOW.TRANS_T_REPORT_ETF_COMPONENT__default");
  });

  it.each(["39045", "180065", "86840", "246247"])(
    "writes frozen case %s with only direct facts",
    (taskId) => {
      const root = dataRoot();
      const fixture = cases[taskId];
      const taskResult = writeTaskInput(root, {
        ...fixture.task,
        collectedAt: "2026-01-01T00:00:00Z",
      });
      expect(taskResult.directory).toBe(
        join(root, "tasks", fixture.task.taskCategory!, taskId),
      );
      const task = JSON.parse(
        readFileSync(join(taskResult.directory, "task.json"), "utf8"),
      ) as Record<string, unknown>;
      validateTaskDocument(task);
      expect(task.taskId).toBe(taskId);
      expect(task).not.toHaveProperty("inputs");
      expect(task).not.toHaveProperty("outputs");
      expect(task).not.toHaveProperty("tableRef");
      const sqlFiles = task.sqlFiles as { slot: string }[];
      if (taskId === "39045")
        expect(sqlFiles.map((file) => file.slot)).toEqual(["query"]);
      if (taskId === "180065")
        expect(sqlFiles.map((file) => file.slot)).toEqual([
          "query",
          "truncate",
        ]);
      if (taskId === "86840")
        expect(sqlFiles.map((file) => file.slot)).toEqual(["create", "query"]);
      if (taskId === "246247") expect(task.writeMode).toBe("truncate");
      if (taskId === "39045" || taskId === "180065" || taskId === "86840")
        expect(task.partition).toBeNull();
      if (taskId === "246247") expect(task).not.toHaveProperty("partition");
      if (taskId === "180065")
        expect(
          readFileSync(join(taskResult.directory, "sql", "query.sql"), "utf8"),
        ).toContain("WHERE busi_date");
      for (const tableEvidence of fixture.tables) {
        const tableResult = writeTableInput(root, {
          ...tableEvidence,
          collectedAt: "2026-01-01T00:00:00Z",
        });
        expect(tableResult.directory).toBe(
          join(
            root,
            "tables",
            tableEvidence.platform,
            `${tableEvidence.qualifiedName}__${tableEvidence.dataSource}`,
          ),
        );
        const table = JSON.parse(
          readFileSync(join(tableResult.directory, "table.json"), "utf8"),
        ) as Record<string, unknown>;
        validateTableDocument(table);
        expect(existsSync(join(tableResult.directory, "ddl.sql"))).toBe(true);
      }
      if (taskId === "180065") {
        const sourceTable = fixture.tables.find(
          (table) => table.platform === "hive",
        );
        expect(sourceTable?.partitionFields).toEqual(["busi_date"]);
      }
    },
  );

  it("keeps create.sql and ddl.sql as separate facts", () => {
    const root = dataRoot();
    const task = writeTaskInput(root, cases["86840"].task);
    const table = writeTableInput(root, cases["86840"].tables[0]!);
    expect(
      readFileSync(join(task.directory, "sql", "create.sql"), "utf8"),
    ).toContain("CREATE TABLE");
    expect(readFileSync(join(table.directory, "ddl.sql"), "utf8")).toContain(
      "STORED AS ORC",
    );
    expect(
      readFileSync(join(task.directory, "sql", "create.sql"), "utf8"),
    ).not.toBe(readFileSync(join(table.directory, "ddl.sql"), "utf8"));
  });

  it("persists a directly supplied primary key without treating it as partition", () => {
    const document = createTableDocument({
      platform: "oracle",
      dataSource: "gforacle_gftzdb#gftzdb",
      qualifiedName: "TITANS_TRADEFLOW.TRANS_T_REPORT_ETF_COMPONENT",
      description: "ATP etf申赎成分股成交表",
      objectType: "gf_rdbms_table",
      primaryKey: ["TRADE_DATE", "TE_REPORT_ID"],
      partitionFields: [],
      ddl: "CREATE TABLE TITANS_TRADEFLOW.TRANS_T_REPORT_ETF_COMPONENT (TRADE_DATE DATE, TE_REPORT_ID NUMBER);",
      evidenceProvider: "fixture-metadata",
    });
    expect(document.primaryKey).toEqual(["TRADE_DATE", "TE_REPORT_ID"]);
    expect(document.partitionFields).toEqual([]);
    expect(document.description).toBe("ATP etf申赎成分股成交表");
  });

  it("persists the same task metadata envelope for every task category", () => {
    const document = createTaskDocument({
      taskId: "86840",
      taskCategory: "hiveTask-2.0",
      taskType: "101",
      taskName: "PDATA_N.T98_OTC_DERI_COMP_SALE_INFO_TIT110",
      topicName: "EDW_SUM",
      source: null,
      target: {
        platform: "hive",
        qualifiedName: "pdata_n.t98_otc_deri_comp_sale_info",
        dataSource: "gfhive",
      },
      targetEvidenceKind: "TABLE_TASK_RELATION_DIRECTION_UNKNOWN",
      partition: null,
      sql: { query: "SELECT 1" },
      evidenceProvider: "fixture,opencli:szdata.table-task-relation",
    });
    expect(document).toMatchObject({
      taskName: "PDATA_N.T98_OTC_DERI_COMP_SALE_INFO_TIT110",
      topicName: "EDW_SUM",
      source: null,
      target: {
        platform: "hive",
        qualifiedName: "pdata_n.t98_otc_deri_comp_sale_info",
        dataSource: "gfhive",
      },
      targetEvidenceKind: "TABLE_TASK_RELATION_DIRECTION_UNKNOWN",
      partition: null,
    });
  });

  it("requires paired SQL and Table evidence for an SQL exact target", () => {
    const document = createTaskDocument({
      taskId: "163712",
      taskCategory: "hiveTask-2.0",
      taskType: "101",
      taskName: "PDATA_N.T98_OTC_OPT_COMP_SUB_TRD_BASE_INFO_TIT125_h15",
      source: undefined,
      target: {
        platform: "hive",
        qualifiedName: "PDATA_N.T98_OTC_OPT_COMP_SUB_TRD_BASE_INFO",
        dataSource: "gfhive",
      },
      targetEvidenceKind: "SQL_EXACT_TABLE_TARGET",
      sql: {
        query:
          "INSERT OVERWRITE TABLE T98_OTC_OPT_COMP_SUB_TRD_BASE_INFO SELECT 1",
      },
      evidenceProvider:
        "opencli:szdata.task-source,sql-mcp:explicit-table-target,opencli:szdata.table",
    });
    expect(document.targetEvidenceKind).toBe("SQL_EXACT_TABLE_TARGET");
  });

  it("adds the same physical data-source identity to every task endpoint shape", () => {
    expect(inputCollectionStatus(0, false, false)).toBe("PARTIAL");
    expect(inputCollectionStatus(1, true, false)).toBe("PARTIAL");
    expect(inputCollectionStatus(1, false, true)).toBe("PARTIAL");
    expect(inputCollectionStatus(1, false, false, true)).toBe("PARTIAL");
    expect(inputCollectionStatus(1, false, false, false, true)).toBe("PARTIAL");
    expect(inputCollectionStatus(1, false, false)).toBe("SUCCESS");
    expect(shouldUseTaskRelationFallback(undefined, null)).toBe(true);
    expect(shouldUseTaskRelationFallback("-", undefined)).toBe(true);
    expect(shouldUseTaskRelationFallback("mysql_atp_tradingdb", null)).toBe(
      false,
    );
    expect(targetEvidenceKindFor(null, undefined)).toBeUndefined();
    expect(targetEvidenceKindFor(undefined, undefined)).toBeUndefined();
    expect(targetEvidenceKindFor("PDATA_N.T98_TARGET", undefined)).toBe(
      "DIRECT_PLATFORM_TARGET",
    );
    const sqlTargetTable = cases["86840"].tables[0]!;
    expect(targetEvidenceKindFor(undefined, undefined, sqlTargetTable)).toBe(
      "SQL_EXACT_TABLE_TARGET",
    );
    expect(targetEvidenceKindFor(null, sqlTargetTable, undefined)).toBe(
      "TABLE_TASK_RELATION_DIRECTION_UNKNOWN",
    );
    expect(targetEvidenceKindFor(null, undefined, sqlTargetTable)).toBe(
      "SQL_EXACT_TABLE_TARGET",
    );
    expect(controlledTaskEndpointDataSource("sparkIndex", "source")).toBe(
      "gfhive",
    );
    expect(controlledTaskEndpointDataSource("sparkIndex", "target")).toBe(
      "gfhive",
    );
    expect(controlledTaskEndpointDataSource("hiveTask-2.0", "source")).toBe(
      "gfhive",
    );
    expect(controlledTaskEndpointDataSource("hiveTask-2.0", "target")).toBe(
      "gfhive",
    );
    expect(controlledTaskEndpointDataSource("mysql2hive", "source")).toBe(
      undefined,
    );
    expect(controlledTaskEndpointDataSource("mysql2hive", "target")).toBe(
      "gfhive",
    );
    expect(controlledTaskEndpointPlatform("mysql2hive", "source")).toBe(
      "mysql",
    );
    expect(controlledTaskEndpointPlatform("mysql2hive", "target")).toBe(
      "hive",
    );
    expect(controlledTaskEndpointDataSource("hive2oracle", "source")).toBe(
      "gfhive",
    );
    expect(controlledTaskEndpointDataSource("hive2oracle", "target")).toBe(
      undefined,
    );
    expect(controlledTaskEndpointDataSource("hive2starrocks", "source")).toBe(
      "gfhive",
    );
    expect(controlledTaskEndpointDataSource("hive2starrocks", "target")).toBe(
      "gfstarrocks_idms_all",
    );
    expect(controlledTaskEndpointDataSource("oracle2hive", "source")).toBe(
      undefined,
    );
    expect(controlledTaskEndpointDataSource("oracle2hive", "target")).toBe(
      "gfhive",
    );
    expect(
      unresolvedPhysicalEndpointReference(
        "source",
        "oracle_tit_gftzdb_gfedw",
        "oracle2hive",
      ),
    ).toBeUndefined();
    expect(
      unresolvedPhysicalEndpointReference("target", "hive_target", "demo"),
    ).toBe("hive_target");
    const table = cases["180065"].tables[0]!;
    expect(
      enrichTaskEndpoint(
        { platform: "hive", qualifiedName: "dm_otc.position" },
        table,
      ),
    ).toEqual({
      platform: "hive",
      qualifiedName: "dm_otc.position",
      dataSource: "hive-test",
    });
    expect(enrichTaskEndpoint("dm_otc.position", undefined)).toBe(
      "dm_otc.position",
    );
    expect(enrichTaskEndpoint("mysql_atp_tradingdb", undefined)).toBe(
      "mysql_atp_tradingdb",
    );
    expect(enrichTaskEndpoint(undefined, table)).toEqual({
      platform: "hive",
      qualifiedName: "dm_otc.position",
      dataSource: "hive-test",
    });
  });

  it("uses a task source hint to disambiguate physical table candidates", () => {
    const candidates = [
      {
        guid: "oracle-1",
        qualifiedName: "GF_OTC.CONTRACT_INTRODUCTION@gforacle_jgjdb1#jgjdb",
        dataSource: "金管家综合服务系统",
      },
      {
        guid: "mysql",
        qualifiedName: "gf_otc.contract_introduction@gfmysql_gf_otc",
        dataSource: "OTC运营管理系统",
      },
      {
        guid: "oracle-2",
        qualifiedName: "GF_OTC.CONTRACT_INTRODUCTION@gforacle_jgjdb2#jgjdb",
        dataSource: "OTC综合业务平台",
      },
    ];

    expect(
      selectTableCandidate(candidates, "GF_OTC.CONTRACT_INTRODUCTION"),
    ).toBeUndefined();
    expect(
      selectTableCandidate(
        candidates,
        "GF_OTC.CONTRACT_INTRODUCTION",
        undefined,
        "ds_n_tdsql_ois_gf_otc",
      )?.guid,
    ).toBe("mysql");
  });

  it("does not archive a task when only a non-physical endpoint label is unavailable", () => {
    expect(
      hasPhysicalTableEvidenceGap({
        tablesUnavailable: [],
      }),
    ).toBe(false);
    expect(
      hasPhysicalTableEvidenceGap({
        tablesUnavailable: ["odata_n_tit.target"],
      }),
    ).toBe(true);
  });

  it("rejects display labels as table platforms and preserves deleted status", () => {
    expect(() =>
      createTableDocument({
        platform: "hive / Hive内部表",
        dataSource: "default",
        qualifiedName: "dm_otc.deleted_table",
        objectType: "hive_table",
        status: "DELETED",
        ddl: "CREATE TABLE dm_otc.deleted_table (id BIGINT);",
        evidenceProvider: "fixture",
      }),
    ).toThrow(/standard platform token/);
    expect(
      createTableDocument({
        platform: "hive",
        dataSource: "default",
        qualifiedName: "dm_otc.deleted_table",
        objectType: "hive_table",
        status: "DELETED",
        ddl: "CREATE TABLE dm_otc.deleted_table (id BIGINT);",
        evidenceProvider: "fixture",
      }).status,
    ).toBe("DELETED");
  });

  it("detects malformed legacy table platform directories before collection", () => {
    const root = dataRoot();
    mkdirSync(join(root, "tables", "oracle ", "物理表"), {
      recursive: true,
    });
    expect(() => assertExistingTableLayout(root)).toThrow(
      /malformed Table platform directories/,
    );
  });

  it("quarantines malformed legacy table directories without deleting them", () => {
    const root = dataRoot();
    const malformed = join(root, "tables", "oracle ");
    mkdirSync(join(malformed, "物理表"), { recursive: true });
    const result = quarantineMalformedTableDirectories(root);
    expect(result?.moved).toHaveLength(1);
    expect(existsSync(malformed)).toBe(false);
    expect(existsSync(join(result!.quarantineRoot, "tables", "oracle "))).toBe(
      true,
    );
    expect(() => assertExistingTableLayout(root)).not.toThrow();
  });

  it("distinguishes omitted partition from confirmed null and rejects empty substitutes", () => {
    const omitted = createTaskDocument({
      taskId: "missing-partition",
      taskCategory: "demo",
      taskType: "demo",
      sql: { query: "SELECT 1" },
      evidenceProvider: "fixture",
    });
    const confirmedNone = createTaskDocument({
      taskId: "no-partition",
      taskCategory: "demo",
      taskType: "demo",
      partition: null,
      sql: { query: "SELECT 1" },
      evidenceProvider: "fixture",
    });
    expect(omitted).not.toHaveProperty("partition");
    expect(confirmedNone.partition).toBeNull();
    expect(() =>
      createTaskDocument({
        taskId: "empty",
        taskCategory: "demo",
        sql: { query: "" },
        evidenceProvider: "fixture",
      }),
    ).toThrow();
    expect(() =>
      createTaskDocument({
        taskId: "placeholder",
        taskCategory: "demo",
        taskType: "-",
        source: { qualifiedName: "-" },
        sql: { query: "SELECT 1" },
        evidenceProvider: "fixture",
      }),
    ).toThrow();
    expect(() =>
      createTableDocument({
        platform: "hive",
        dataSource: "test",
        qualifiedName: "dm_otc.empty",
        objectType: "TABLE",
        ddl: "",
        evidenceProvider: "fixture",
      }),
    ).toThrow();
    expect(() =>
      createTableDocument({
        platform: "hive",
        dataSource: "test",
        qualifiedName: "dm_otc.empty@gfhive",
        objectType: "TABLE",
        ddl: "CREATE TABLE x (id INT)",
        evidenceProvider: "fixture",
      }),
    ).toThrow();
  });

  it("does not update unchanged content and preserves the last valid directory on failure", () => {
    const root = dataRoot();
    const original = {
      ...cases["39045"].task,
      collectedAt: "2026-01-01T00:00:00Z",
    };
    const first = writeTaskInput(root, original);
    const before = readFileSync(join(first.directory, "task.json"), "utf8");
    const unchanged = writeTaskInput(root, {
      ...original,
      collectedAt: "2027-01-01T00:00:00Z",
    });
    expect(unchanged.changed).toBe(false);
    expect(readFileSync(join(first.directory, "task.json"), "utf8")).toBe(
      before,
    );
    const mtime = statSync(first.directory).mtimeMs;
    expect(() =>
      writeTaskInput(root, { ...original, sql: { query: "" } }),
    ).toThrow();
    expect(readFileSync(join(first.directory, "task.json"), "utf8")).toBe(
      before,
    );
    expect(statSync(first.directory).mtimeMs).toBe(mtime);
  });

  it("does not copy analyzer-only facts into the persisted task/table boundary", () => {
    const root = dataRoot();
    const evidence = {
      ...cases["246247"].task,
      inputs: ["derived"],
      outputs: ["derived"],
      tableRef: "derived",
      statementRole: "WRITE",
      lineage: [],
    } as unknown as (typeof cases)["246247"]["task"];
    const result = writeTaskInput(root, evidence);
    const persisted = JSON.parse(
      readFileSync(join(result.directory, "task.json"), "utf8"),
    ) as Record<string, unknown>;
    for (const field of [
      "inputs",
      "outputs",
      "tableRef",
      "statementRole",
      "lineage",
    ])
      expect(persisted).not.toHaveProperty(field);
  });
});
