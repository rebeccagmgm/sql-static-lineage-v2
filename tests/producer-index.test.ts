import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonicalHash,
  writeTableInput,
  writeTaskInput,
  type JsonValue,
  type TaskEvidence,
} from "../scripts/input/shared/input-pack.ts";
import {
  assertOutputOutsideDataRoot,
  buildTableProducerIndex,
  buildTableProducerInputManifest,
  classifyProducerWriteObservation,
  compareTableProducerInputManifests,
  fingerprintTableProducerInputs,
  loadTableProducerIndex,
  pinTableProducerIndex,
  loadOrRebuildTableProducerIndex,
  defaultMutableProducerIndexRoot,
  mutableProducerIndexPaths,
  validateTableProducerIndex,
  writeTableProducerIndex,
  updateTableProducerIndex,
} from "../scripts/reconcile/producer/producer-index.ts";
import {
  lookupConfirmedProducers,
  lookupNonConfirmedRelations,
} from "../scripts/query/producer-index-query.ts";

const frozen86840It = existsSync(
  join(
    import.meta.dirname,
    "fixtures",
    "reconcile-one-hop",
    "86840-input-pack",
  ),
)
  ? it
  : it.skip;

function dataRoot(): string {
  return mkdtempSync(join(tmpdir(), "sql-lineage-producer-index-"));
}

function materializeFrozenInputPack(sourceRoot: string): string {
  const root = dataRoot();
  cpSync(sourceRoot, root, { recursive: true });
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(path);
        continue;
      }
      const normalizeEvidenceFile = (relativePath: string): void => {
        const evidencePath = join(directory, relativePath);
        const normalized = readFileSync(evidencePath, "utf8").replaceAll(
          "\r\n",
          "\n",
        );
        writeFileSync(
          evidencePath,
          normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized,
        );
      };
      if (entry.name === "task.json") {
        const task = JSON.parse(readFileSync(path, "utf8")) as {
          sqlFiles?: { path: string }[];
        };
        for (const sqlFile of task.sqlFiles ?? []) {
          normalizeEvidenceFile(sqlFile.path);
        }
      }
      if (entry.name === "table.json") {
        const table = JSON.parse(readFileSync(path, "utf8")) as {
          ddlFile?: { path: string };
        };
        if (table.ddlFile) normalizeEvidenceFile(table.ddlFile.path);
      }
    }
  };
  visit(root);
  return root;
}

function writeTable(
  root: string,
  qualifiedName: string,
  dataSource = "gfhive",
  partitionFields?: readonly string[],
): string {
  const [schema, name] = qualifiedName.split(".");
  return writeTableInput(root, {
    platform: "hive",
    dataSource,
    qualifiedName,
    schema,
    name,
    objectType: "TABLE",
    ddl: `CREATE TABLE ${qualifiedName} (id bigint)`,
    ...(partitionFields === undefined ? {} : { partitionFields }),
    evidenceProvider: "fixture:table",
    collectedAt: "2026-08-23T00:00:00.000Z",
  }).directory;
}

function writeTask(
  root: string,
  taskId: string,
  evidence: Omit<TaskEvidence, "taskId" | "taskCategory" | "collectedAt">,
): void {
  writeTaskInput(root, {
    taskId,
    taskCategory: "hiveTask-2.0",
    collectedAt: "2026-08-23T00:00:00.000Z",
    evidenceProvider: evidence.evidenceProvider ?? "fixture:task",
    ...evidence,
  });
}

describe("table producer index", () => {
  it("excludes tasks with direct manual Horae cycle evidence", () => {
    const root = dataRoot();
    writeTable(root, "lake.a");
    writeTask(root, "manual", {
      scheduleCycle: "手工",
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "lake.a",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
    });
    writeTask(root, "scheduled", {
      scheduleCycle: "每日",
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "lake.a",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
    });

    const index = buildTableProducerIndex(root);

    expect(
      lookupConfirmedProducers(index, {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "lake.a",
      }).map((edge) => edge.taskId),
    ).toEqual(["scheduled"]);
    expect(index.nonConfirmedRelations).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ taskId: "manual" })]),
    );
  });

  it("indexes only confirmed writes while retaining candidates and every write observation", () => {
    const root = dataRoot();
    writeTable(root, "lake.a");
    writeTable(root, "lake.b");
    writeTask(root, "p1", {
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "lake.a",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
      writeMode: "OVERWRITE",
      partition: { busi_date: "${busi_date}" },
    });
    writeTask(root, "p2", {
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "lake.a",
      },
      targetEvidenceKind: "SQL_EXACT_TABLE_TARGET",
      evidenceProvider:
        "sql-mcp:explicit-table-target+opencli:szdata.table-guid",
      sql: { query: "INSERT INTO TABLE lake.a SELECT id FROM source.remote" },
    });
    writeTask(root, "candidate", {
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "lake.a",
      },
      targetEvidenceKind: "TABLE_TASK_RELATION_DIRECTION_UNKNOWN",
      evidenceProvider: "opencli:szdata.table-task-relation",
    });
    writeTask(root, "multi-write", {
      sql: {
        query: [
          "INSERT OVERWRITE TABLE lake.b PARTITION (busi_date='20260822') SELECT 1;",
          "INSERT INTO TABLE lake.b PARTITION (busi_date=${busi_date}) SELECT 2;",
        ].join("\n"),
      },
    });
    writeTask(root, "missing-identity", {
      sql: { query: "INSERT OVERWRITE TABLE lake.missing SELECT 1" },
    });

    const index = buildTableProducerIndex(root, {
      now: () => "2026-08-23T01:00:00.000Z",
    });
    const producers = lookupConfirmedProducers(index, {
      platform: "hive",
      dataSource: "gfhive",
      qualifiedName: "lake.a",
    });
    const candidates = lookupNonConfirmedRelations(index, {
      platform: "hive",
      dataSource: "gfhive",
      qualifiedName: "lake.a",
    });

    expect(producers.map((edge) => edge.taskId)).toEqual(["p1", "p2"]);
    expect(candidates.map((edge) => edge.taskId)).toEqual(["candidate"]);
    expect(candidates[0]?.directionStatus).toBe("UNKNOWN");
    expect(
      index.confirmedProducerEdges.find(
        (edge) => edge.table.qualifiedName === "lake.b",
      )?.writes,
    ).toEqual([
      expect.objectContaining({
        observationKind: "SQL_EXPLICIT_WRITE",
        sqlWriteKind: "INSERT_OVERWRITE",
        partition: [
          expect.objectContaining({
            field: "busi_date",
            observedValue: "20260822",
            valueStatus: "OBSERVED_RENDERED_VALUE",
          }),
        ],
      }),
      expect.objectContaining({
        observationKind: "SQL_EXPLICIT_WRITE",
        sqlWriteKind: "INSERT_INTO",
        partition: [
          expect.objectContaining({
            field: "busi_date",
            observedValue: null,
            valueStatus: "RUNTIME_EXPRESSION",
          }),
        ],
      }),
    ]);
    expect(index.nonConfirmedRelations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "missing-identity",
          tableRef: expect.objectContaining({
            qualifiedName: "lake.missing",
            identityStatus: "QUALIFIED_NAME_ONLY",
          }),
          directionStatus: "WRITE_CONFIRMED",
          reasonCodes: ["SQL_WRITE_TABLE_IDENTITY_UNRESOLVED"],
        }),
      ]),
    );
    expect(index).toMatchObject({
      artifactType: "TABLE_PRODUCER_INDEX",
      buildStatus: "SUCCESS",
      coverageSemantics: "OBSERVED_EVIDENCE_ONLY",
    });
    expect(index.counts).toMatchObject({
      taskPacksDiscovered: 5,
      taskPacksIndexed: 5,
      confirmedTables: 2,
      confirmedProducerEdges: 3,
      confirmedWriteObservations: 5,
      candidateObservations: 2,
    });
    expect(
      index.confirmedProducerEdges
        .flatMap((edge) => edge.writes)
        .filter((write) => write.observationKind === "DIRECT_TARGET"),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
          writeDirection: "WRITE_CONFIRMED",
          operationClass: "PLATFORM_TRANSFER",
          dataPathRole: "PRODUCER",
        }),
      ]),
    );
    expect(
      index.confirmedProducerEdges.find((edge) => edge.taskId === "p2")
        ?.writes[0],
    ).toMatchObject({
      targetEvidenceKind: "SQL_EXACT_TABLE_TARGET",
      writeDirection: "WRITE_CONFIRMED",
      operationClass: "UNKNOWN",
      dataPathRole: "PRODUCER",
    });
  });

  it("binds a simple direct-target partition map to the producer", () => {
    const root = dataRoot();
    writeTable(root, "lake.partitioned");
    writeTask(root, "implicit-partition", {
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "lake.partitioned",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
      partition: { busi_date: "${YYYY-MM-DD}" },
    });

    const index = buildTableProducerIndex(root);
    expect(index.confirmedProducerEdges).toEqual([
      expect.objectContaining({
        taskId: "implicit-partition",
        writes: [
          expect.objectContaining({
            partition: [
              {
                field: "busi_date",
                expression: "${YYYY-MM-DD}",
                observedValue: null,
                valueStatus: "RUNTIME_EXPRESSION",
              },
            ],
          }),
        ],
      }),
    ]);
  });

  it("preserves multiple compact partition maps as multiple write observations", () => {
    const root = dataRoot();
    writeTable(root, "lake.multi_partitioned", "gfhive", [
      "busi_date",
      "grp_id",
    ]);
    writeTask(root, "multi-partition-map", {
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "lake.multi_partitioned",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
      partition: [
        { busi_date: "${YYYY-MM-DD}", grp_id: "01" },
        { busi_date: "${YYYY-MM-DD}", grp_id: "02" },
      ],
    });

    const index = buildTableProducerIndex(root);
    const writes = index.confirmedProducerEdges[0]?.writes ?? [];

    expect(writes).toHaveLength(2);
    expect(writes.map((write) => write.partitionStatus)).toEqual([
      "COMPLETE",
      "COMPLETE",
    ]);
    expect(
      writes.map((write) =>
        Object.fromEntries(
          write.partition.map((assignment) => [
            assignment.field,
            assignment.expression,
          ]),
        ),
      ),
    ).toEqual([
      { busi_date: "${YYYY-MM-DD}", grp_id: "01" },
      { busi_date: "${YYYY-MM-DD}", grp_id: "02" },
    ]);
  });

  it("classifies a table with no partition fields as NOT_PARTITIONED", () => {
    const root = dataRoot();
    writeTable(root, "lake.non_partitioned", "gfhive", []);
    writeTask(root, "non-partitioned-target", {
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "lake.non_partitioned",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
    });

    const index = buildTableProducerIndex(root);
    expect(index.confirmedProducerEdges[0]?.writes[0]).toMatchObject({
      partition: [],
      partitionStatus: "NOT_PARTITIONED",
      partitionReasonCodes: ["TABLE_NOT_PARTITIONED"],
    });
  });

  it("matches compact partition variants to static SQL writes", () => {
    const root = dataRoot();
    writeTable(root, "lake.sql_multi_partitioned", "gfhive", [
      "busi_date",
      "grp_id",
    ]);
    writeTask(root, "sql-multi-partition-map", {
      partition: [
        { busi_date: "${YYYY-MM-DD}", grp_id: "01" },
        { busi_date: "${YYYY-MM-DD}", grp_id: "02" },
      ],
      sql: {
        query: [
          "INSERT OVERWRITE TABLE lake.sql_multi_partitioned PARTITION (busi_date, grp_id) SELECT 1;",
          "INSERT OVERWRITE TABLE lake.sql_multi_partitioned PARTITION (busi_date='2026-08-23', grp_id='02') SELECT 2;",
        ].join("\n"),
      },
    });

    const index = buildTableProducerIndex(root);
    const writes = index.confirmedProducerEdges[0]?.writes ?? [];

    expect(writes).toHaveLength(3);
    expect(writes[0]?.partition).toEqual([
      expect.objectContaining({ field: "busi_date" }),
      expect.objectContaining({ field: "grp_id", observedValue: "01" }),
    ]);
    expect(writes[1]?.partition).toEqual([
      expect.objectContaining({ field: "busi_date" }),
      expect.objectContaining({ field: "grp_id", observedValue: "02" }),
    ]);
    expect(writes[2]?.partition).toEqual([
      expect.objectContaining({ field: "busi_date" }),
      expect.objectContaining({ field: "grp_id", observedValue: "02" }),
    ]);
  });

  it("normalizes legacy SQL fallback dates and unresolved fields", () => {
    const root = dataRoot();
    writeTable(root, "lake.legacy_partitioned", "gfhive", [
      "busi_date",
      "grp_id",
    ]);
    writeTask(root, "legacy-sql-partition", {
      sql: {
        query:
          "INSERT OVERWRITE TABLE lake.legacy_partitioned PARTITION (busi_date, grp_id) SELECT 1",
      },
    });

    const index = buildTableProducerIndex(root);
    expect(index.confirmedProducerEdges[0]?.writes[0]).toMatchObject({
      partition: [
        {
          field: "busi_date",
          expression: "${YYYY-MM-DD}",
          valueStatus: "RUNTIME_EXPRESSION",
          observedValue: null,
        },
        {
          field: "grp_id",
          expression: "*",
          valueStatus: "UNKNOWN",
          observedValue: null,
        },
      ],
      partitionStatus: "LEGACY_UNKNOWN",
      partitionReasonCodes: ["SQL_WRITE_PARTITION_FALLBACK"],
    });
  });

  it("uses a Task Pack target to qualify an unqualified SQL write", () => {
    const root = dataRoot();
    writeTable(root, "pdata_n.acct_fundacct_base_info_s");
    writeTask(root, "task-target-schema", {
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "pdata_n.acct_fundacct_base_info_s",
      },
      targetEvidenceKind: "TABLE_TASK_RELATION_DIRECTION_UNKNOWN",
      evidenceProvider: "opencli:szdata.table-task-relation",
      sql: {
        query: "INSERT OVERWRITE TABLE acct_fundacct_base_info_s SELECT 1",
      },
    });

    const index = buildTableProducerIndex(root);

    expect(
      lookupConfirmedProducers(index, {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "pdata_n.acct_fundacct_base_info_s",
      }).map((edge) => edge.taskId),
    ).toEqual(["task-target-schema"]);
    expect(
      lookupNonConfirmedRelations(index, {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "pdata_n.acct_fundacct_base_info_s",
      }),
    ).toEqual([]);
    expect(index.nonConfirmedRelations).toEqual([]);
  });

  it("uses the Task Pack schema to qualify a terminal SQL write without recollection", () => {
    const root = dataRoot();
    writeTask(root, "task-schema-final", {
      taskName: "dm_ctms_n.ctms_pwc_psn_sys_user_roles",
      sql: {
        query: [
          "INSERT OVERWRITE TABLE pwc_psn_sys_user_roles_temp SELECT 1;",
          "INSERT OVERWRITE TABLE pwc_psn_sys_user_roles SELECT 1 FROM pwc_psn_sys_user_roles_temp;",
        ].join("\n"),
      },
    });

    const index = buildTableProducerIndex(root);

    expect(index.nonConfirmedRelations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "task-schema-final",
          tableRef: expect.objectContaining({
            qualifiedName: "dm_ctms_n.pwc_psn_sys_user_roles",
            identityStatus: "QUALIFIED_NAME_ONLY",
          }),
          reasonCodes: ["SQL_FINAL_TARGET_PHYSICAL_IDENTITY_UNRESOLVED"],
        }),
      ]),
    );
    expect(index.nonConfirmedRelations).toHaveLength(1);
    expect(index.intermediateMaterializations).toEqual([
      expect.objectContaining({
        taskId: "task-schema-final",
        tableRef: expect.objectContaining({
          qualifiedName: "pwc_psn_sys_user_roles_temp",
        }),
        reasonCodes: ["SQL_INTRA_TASK_INTERMEDIATE_IDENTITY_UNRESOLVED"],
      }),
    ]);
  });

  it("does not expose a resolved intermediate write as a confirmed producer", () => {
    const root = dataRoot();
    writeTable(root, "lake.intermediate");
    writeTable(root, "lake.final");
    writeTask(root, "resolved-intermediate", {
      sql: {
        query:
          "CREATE TABLE lake.intermediate AS SELECT 1; INSERT OVERWRITE TABLE lake.final SELECT * FROM lake.intermediate",
      },
    });

    const index = buildTableProducerIndex(root);

    expect(
      lookupConfirmedProducers(index, {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "lake.intermediate",
      }),
    ).toEqual([]);
    expect(
      lookupConfirmedProducers(index, {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "lake.final",
      }).map((edge) => edge.taskId),
    ).toEqual(["resolved-intermediate"]);
    expect(index.intermediateMaterializations).toEqual([
      expect.objectContaining({
        taskId: "resolved-intermediate",
        tableRef: expect.objectContaining({
          qualifiedName: "lake.intermediate",
          identityStatus: "RESOLVED",
        }),
      }),
    ]);
  });

  it("normalizes transfer and mutation Task shapes without relying on INSERT", () => {
    expect(
      classifyProducerWriteObservation({
        observationKind: "DIRECT_TARGET",
        declaredWriteMode: "append",
        sqlWriteKind: null,
      }),
    ).toEqual({
      writeDirection: "WRITE_CONFIRMED",
      operationClass: "PLATFORM_TRANSFER",
      dataPathRole: "PRODUCER",
    });
    expect(
      classifyProducerWriteObservation({
        observationKind: "DIRECT_TARGET",
        declaredWriteMode: "truncate",
        sqlWriteKind: null,
      }),
    ).toEqual({
      writeDirection: "WRITE_CONFIRMED",
      operationClass: "TRUNCATE",
      dataPathRole: "MUTATION_ONLY",
    });
    expect(
      classifyProducerWriteObservation(
        {
          observationKind: "DIRECT_TARGET",
          declaredWriteMode: "truncate",
          sqlWriteKind: null,
        },
        { hasFieldProducingSql: true },
      ),
    ).toEqual({
      writeDirection: "WRITE_CONFIRMED",
      operationClass: "PLATFORM_TRANSFER",
      dataPathRole: "PRODUCER",
    });
    expect(
      classifyProducerWriteObservation({
        observationKind: "DIRECT_TARGET",
        declaredWriteMode: "delete",
        sqlWriteKind: null,
      }),
    ).toEqual({
      writeDirection: "WRITE_CONFIRMED",
      operationClass: "DELETE",
      dataPathRole: "MUTATION_ONLY",
    });
    expect(
      classifyProducerWriteObservation(
        {
          observationKind: "DIRECT_TARGET",
          declaredWriteMode: null,
          sqlWriteKind: null,
        },
        {
          sqlTargetStatementKind: "DELETE_TABLE",
        },
      ),
    ).toMatchObject({
      operationClass: "DELETE",
      dataPathRole: "MUTATION_ONLY",
    });
    expect(
      classifyProducerWriteObservation({
        observationKind: "SQL_EXPLICIT_WRITE",
        declaredWriteMode: null,
        sqlWriteKind: "CTAS",
      }),
    ).toEqual({
      writeDirection: "WRITE_CONFIRMED",
      operationClass: "CTAS",
      dataPathRole: "PRODUCER",
    });
    expect(
      classifyProducerWriteObservation({
        observationKind: "DIRECT_TARGET",
        targetEvidenceKind: "SQL_EXACT_TABLE_TARGET",
        declaredWriteMode: null,
        sqlWriteKind: null,
      }),
    ).toEqual({
      writeDirection: "WRITE_CONFIRMED",
      operationClass: "UNKNOWN",
      dataPathRole: "UNKNOWN",
    });
    expect(
      classifyProducerWriteObservation({
        observationKind: "DIRECT_TARGET",
        declaredWriteMode: "not-truncate",
        sqlWriteKind: null,
      }),
    ).toMatchObject({
      operationClass: "UNKNOWN",
      dataPathRole: "UNKNOWN",
    });
    expect(
      classifyProducerWriteObservation({
        observationKind: "DIRECT_TARGET",
        declaredWriteMode: "delete_and_insert",
        sqlWriteKind: null,
      }),
    ).toMatchObject({
      operationClass: "UNKNOWN",
      dataPathRole: "UNKNOWN",
    });
  });

  it("keeps legacy V1 producer observations readable without semantic fields", () => {
    const root = dataRoot();
    writeTable(root, "lake.legacy");
    writeTask(root, "legacy", {
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "lake.legacy",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
    });
    const current = buildTableProducerIndex(root);
    const legacy = JSON.parse(JSON.stringify(current)) as Record<
      string,
      unknown
    >;
    const edges = legacy.confirmedProducerEdges as Array<
      Record<string, unknown>
    >;
    const writes = edges[0]!.writes as Array<Record<string, unknown>>;
    for (const write of writes) {
      delete write.targetEvidenceKind;
      delete write.writeDirection;
      delete write.operationClass;
      delete write.dataPathRole;
    }
    legacy.schemaVersion = "1.0.0";
    delete legacy.intermediateMaterializations;
    delete (legacy.counts as Record<string, unknown>)
      .intermediateMaterializations;
    legacy.contentHash = canonicalHash(legacy as unknown as JsonValue, [
      "generatedAt",
      "contentHash",
    ]);
    expect(() => validateTableProducerIndex(legacy)).not.toThrow();
  });

  it("keeps platform transfer targets distinct from mutation-only writes", () => {
    const root = dataRoot();
    writeTable(root, "lake.transfer");
    writeTable(root, "lake.truncate");
    writeTable(root, "lake.delete");
    writeTable(root, "lake.truncate_exact");
    writeTable(root, "lake.create_exact");
    writeTask(root, "transfer-select", {
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "lake.transfer",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
      writeMode: "append",
      sql: { query: "SELECT id FROM source.remote" },
    });
    writeTask(root, "truncate-task", {
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "lake.truncate",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
      writeMode: "truncate",
      sql: { truncate: "TRUNCATE TABLE lake.truncate" },
    });
    writeTask(root, "delete-task", {
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "lake.delete",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
      writeMode: "delete",
      sql: { truncate: "DELETE FROM lake.delete WHERE id = 1" },
    });
    writeTask(root, "truncate-exact", {
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "lake.truncate_exact",
      },
      targetEvidenceKind: "SQL_EXACT_TABLE_TARGET",
      evidenceProvider: "sql-mcp:explicit-table-target+opencli:szdata.table",
      sql: { truncate: "TRUNCATE TABLE lake.truncate_exact" },
    });
    writeTask(root, "create-exact", {
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "lake.create_exact",
      },
      targetEvidenceKind: "SQL_EXACT_TABLE_TARGET",
      evidenceProvider: "sql-mcp:explicit-table-target+opencli:szdata.table",
      sql: { create: "CREATE TABLE lake.create_exact (id bigint)" },
    });

    const index = buildTableProducerIndex(root);
    const writeFor = (qualifiedName: string) =>
      index.confirmedProducerEdges.find(
        (edge) => edge.table.qualifiedName === qualifiedName,
      )!.writes[0]!;
    expect(writeFor("lake.transfer")).toMatchObject({
      operationClass: "PLATFORM_TRANSFER",
      dataPathRole: "PRODUCER",
    });
    expect(writeFor("lake.truncate")).toMatchObject({
      operationClass: "TRUNCATE",
      dataPathRole: "MUTATION_ONLY",
    });
    expect(writeFor("lake.delete")).toMatchObject({
      operationClass: "DELETE",
      dataPathRole: "MUTATION_ONLY",
    });
    expect(writeFor("lake.truncate_exact")).toMatchObject({
      operationClass: "TRUNCATE",
      dataPathRole: "MUTATION_ONLY",
    });
    expect(writeFor("lake.create_exact")).toMatchObject({
      operationClass: "UNKNOWN",
      dataPathRole: "UNKNOWN",
    });
    expect(
      lookupConfirmedProducers(index, {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "lake.truncate",
      }),
    ).toEqual([]);
    expect(
      lookupConfirmedProducers(index, {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "lake.truncate_exact",
      }),
    ).toEqual([]);
    expect(
      lookupConfirmedProducers(index, {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "lake.create_exact",
      }),
    ).toEqual([]);
    expect(
      lookupConfirmedProducers(index, {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "lake.transfer",
      }).map((edge) => edge.taskId),
    ).toEqual(["transfer-select"]);
  });

  it("is deterministic apart from generatedAt and changes its fingerprint with input bytes", () => {
    const root = dataRoot();
    writeTable(root, "lake.a");
    writeTask(root, "p1", {
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "lake.a",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
    });
    const first = buildTableProducerIndex(root, {
      now: () => "2026-08-23T01:00:00.000Z",
    });
    expect(fingerprintTableProducerInputs(root)).toBe(first.inputFingerprint);
    const taskPath = join(root, "tasks", "hiveTask-2.0", "p1", "task.json");
    const recollectedTask = JSON.parse(readFileSync(taskPath, "utf8")) as {
      collectedAt: string;
    };
    recollectedTask.collectedAt = "2026-08-24T00:00:00.000Z";
    writeFileSync(taskPath, `${JSON.stringify(recollectedTask, null, 2)}\n`);
    const second = buildTableProducerIndex(root, {
      now: () => "2026-08-23T02:00:00.000Z",
    });
    expect(second.inputFingerprint).toBe(first.inputFingerprint);
    expect(second.contentHash).toBe(first.contentHash);

    const evidencePath = first.confirmedProducerEdges[0]?.writes
      .flatMap((item) => item.evidence)
      .find((item) => item.source === "INPUT_PACK_TASK")?.locator;
    expect(evidencePath).toBe("tasks/hiveTask-2.0/p1/task.json");
    const corruptedTask = JSON.parse(readFileSync(taskPath, "utf8")) as {
      taskName?: string;
    };
    corruptedTask.taskName = "changed-without-content-hash";
    writeFileSync(taskPath, `${JSON.stringify(corruptedTask, null, 2)}\n`);
    const changed = buildTableProducerIndex(root, {
      now: () => "2026-08-23T03:00:00.000Z",
    });
    expect(changed.inputFingerprint).not.toBe(first.inputFingerprint);
    expect(changed.contentHash).not.toBe(first.contentHash);
    expect(changed.confirmedProducerEdges).toEqual([]);
    expect(changed.buildStatus).toBe("PARTIAL");
    expect(changed.nonConfirmedRelations).toEqual([
      expect.objectContaining({
        taskId: "p1",
        reasonCodes: ["TASK_PACK_INVALID"],
      }),
    ]);
  });

  it("reuses an unchanged snapshot and advances generation after a pack changes", () => {
    const root = dataRoot();
    writeTable(root, "lake.a");
    writeTask(root, "p1", {
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "lake.a",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
    });
    const outputRoot = dataRoot();
    const indexPath = join(outputRoot, "producer-index.json");
    const manifestPath = join(outputRoot, "producer-index.manifest.json");
    const first = updateTableProducerIndex(root, indexPath, manifestPath, {
      now: () => "2026-08-23T01:00:00.000Z",
    });
    expect(first.reused).toBe(false);
    expect(first.changes).toEqual({
      status: "INITIAL",
      changedPacks: [
        "TABLE:tables/hive/" +
          readdirSync(join(root, "tables", "hive"))[0] +
          "/table.json",
        "TASK:tasks/hiveTask-2.0/p1/task.json",
      ].sort(),
    });
    expect(first.manifest.generation).toBe(1);

    const second = updateTableProducerIndex(root, indexPath, manifestPath, {
      now: () => "2026-08-23T02:00:00.000Z",
    });
    expect(second.reused).toBe(true);
    expect(second.changes).toEqual({ status: "UNCHANGED", changedPacks: [] });
    expect(second.manifest.generation).toBe(1);
    expect(second.index.generatedAt).toBe(first.index.generatedAt);

    writeTask(root, "p2", {
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "lake.a",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
    });
    const third = updateTableProducerIndex(root, indexPath, manifestPath, {
      now: () => "2026-08-23T03:00:00.000Z",
    });
    expect(third.reused).toBe(false);
    expect(third.changes.status).toBe("CHANGED");
    expect(third.changes.changedPacks).toContain(
      "TASK:tasks/hiveTask-2.0/p2/task.json",
    );
    expect(third.manifest.generation).toBe(2);
    expect(
      lookupConfirmedProducers(third.index, {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "lake.a",
      }).map((edge) => edge.taskId),
    ).toEqual(["p1", "p2"]);
    expect(
      buildTableProducerInputManifest(root, { generation: 2 }).inputFingerprint,
    ).toBe(third.manifest.inputFingerprint);
    expect(
      compareTableProducerInputManifests(first.manifest, third.manifest).status,
    ).toBe("CHANGED");
  });

  it("pins immutable producer-index cache entries by input fingerprint", () => {
    const root = dataRoot();
    writeTable(root, "lake.a");
    writeTask(root, "p1", {
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "lake.a",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
    });
    const cacheRoot = dataRoot();
    const first = pinTableProducerIndex(root, cacheRoot, {
      now: () => "2026-08-23T01:00:00.000Z",
    });
    expect(first.reused).toBe(false);
    expect(first.indexPath).toContain(first.inputFingerprint);
    expect(first.manifestPath).toContain(first.inputFingerprint);
    expect(first.index.inputFingerprint).toBe(first.inputFingerprint);

    const second = pinTableProducerIndex(root, cacheRoot, {
      now: () => "2026-08-23T02:00:00.000Z",
    });
    expect(second.reused).toBe(true);
    expect(second.indexPath).toBe(first.indexPath);
    expect(second.index.generatedAt).toBe(first.index.generatedAt);

    writeTask(root, "p2", {
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "lake.a",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
    });
    const third = pinTableProducerIndex(root, cacheRoot, {
      now: () => "2026-08-23T03:00:00.000Z",
    });
    expect(third.reused).toBe(false);
    expect(third.inputFingerprint).not.toBe(first.inputFingerprint);
    expect(third.indexPath).not.toBe(first.indexPath);
    expect(existsSync(first.indexPath)).toBe(true);
    expect(
      lookupConfirmedProducers(third.index, {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "lake.a",
      }).map((edge) => edge.taskId),
    ).toEqual(["p1", "p2"]);
  });

  it("keeps the pinned producer-index cache outside the Input Pack", () => {
    const root = dataRoot();
    expect(() =>
      pinTableProducerIndex(root, join(root, "producer-index-cache")),
    ).toThrow("OUTPUT_MUST_BE_OUTSIDE_INPUT_PACK_ROOT");
  });

  it("loads a fixed-path producer index without rebuilding when present", () => {
    const root = dataRoot();
    writeTable(root, "lake.a");
    writeTask(root, "p1", {
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "lake.a",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
    });
    const indexRoot = defaultMutableProducerIndexRoot(root);
    const first = loadOrRebuildTableProducerIndex(root, indexRoot, {
      now: () => "2026-08-23T01:00:00.000Z",
    });
    expect(first.rebuilt).toBe(true);
    expect(first.indexPath).toBe(mutableProducerIndexPaths(indexRoot).indexPath);
    expect(existsSync(first.indexPath)).toBe(true);

    writeTask(root, "p2", {
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "lake.a",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
    });
    const second = loadOrRebuildTableProducerIndex(root, indexRoot, {
      now: () => "2026-08-23T02:00:00.000Z",
    });
    expect(second.rebuilt).toBe(false);
    expect(second.index.generatedAt).toBe(first.index.generatedAt);
    expect(
      second.index.confirmedProducerEdges
        .filter((edge) => edge.table.qualifiedName === "lake.a")
        .map((edge) => edge.taskId),
    ).toEqual(["p1"]);

    const third = loadOrRebuildTableProducerIndex(root, indexRoot, {
      forceRebuild: true,
      now: () => "2026-08-23T03:00:00.000Z",
    });
    expect(third.rebuilt).toBe(true);
    expect(
      third.index.confirmedProducerEdges
        .filter((edge) => edge.table.qualifiedName === "lake.a")
        .map((edge) => edge.taskId)
        .sort(),
    ).toEqual(["p1", "p2"]);
  });

  it("does not resolve an explicit SQL write through an ambiguous table name", () => {
    const root = dataRoot();
    writeTable(root, "lake.same", "source-a");
    writeTable(root, "lake.same", "source-b");
    writeTask(root, "ambiguous", {
      sql: { query: "CREATE TABLE lake.same AS SELECT 1" },
    });

    const index = buildTableProducerIndex(root);
    expect(index.confirmedProducerEdges).toEqual([]);
    expect(index.nonConfirmedRelations).toEqual([
      expect.objectContaining({
        taskId: "ambiguous",
        reasonCodes: ["SQL_WRITE_TABLE_IDENTITY_UNRESOLVED"],
        tableRef: expect.objectContaining({ identityStatus: "AMBIGUOUS" }),
      }),
    ]);
  });

  it("does not infer producers from task names or reads", () => {
    const root = dataRoot();
    writeTable(root, "lake.a");
    writeTask(root, "name-only", {
      taskName: "producer_lake.a",
      sql: { query: "SELECT * FROM lake.a" },
    });
    writeTask(root, "unknown", {
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "lake.a",
      },
      targetEvidenceKind: "TABLE_TASK_RELATION_DIRECTION_UNKNOWN",
      evidenceProvider: "opencli:szdata.table-task-relation",
    });

    const index = buildTableProducerIndex(root);
    expect(index.confirmedProducerEdges).toEqual([]);
    expect(
      index.nonConfirmedRelations.map((relation) => relation.taskId),
    ).toEqual(["unknown"]);
  });

  it("fails closed when a Table Pack DDL no longer matches its hash", () => {
    const root = dataRoot();
    const tableDirectory = writeTable(root, "lake.a");
    writeTask(root, "direct", {
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "lake.a",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
    });
    writeTask(root, "sql", {
      sql: { query: "INSERT INTO TABLE lake.a SELECT 1" },
    });
    const ddlPath = join(tableDirectory, "ddl.sql");
    writeFileSync(ddlPath, `${readFileSync(ddlPath, "utf8")} -- changed`);

    const index = buildTableProducerIndex(root);
    expect(index.buildStatus).toBe("PARTIAL");
    expect(index.confirmedProducerEdges).toEqual([]);
    expect(index.counts.invalidTablePacks).toBe(1);
    expect(index.nonConfirmedRelations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ taskId: "direct" }),
        expect.objectContaining({
          taskId: "sql",
          reasonCodes: ["SQL_WRITE_TABLE_IDENTITY_UNRESOLVED"],
        }),
      ]),
    );
  });

  it("rejects duplicate task identities and default data sources", () => {
    const root = dataRoot();
    writeTable(root, "lake.a");
    writeTable(root, "lake.defaulted", "default");
    for (const taskCategory of ["hiveTask-2.0", "oracle2hive"]) {
      writeTaskInput(root, {
        taskId: "duplicate",
        taskCategory,
        target: {
          platform: "hive",
          dataSource: "gfhive",
          qualifiedName: "lake.a",
        },
        targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
        evidenceProvider: "fixture:task",
        collectedAt: "2026-08-23T00:00:00.000Z",
      });
    }
    writeTask(root, "default-source", {
      target: {
        platform: "hive",
        dataSource: "default",
        qualifiedName: "lake.defaulted",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
    });

    const index = buildTableProducerIndex(root);
    expect(index.buildStatus).toBe("PARTIAL");
    expect(index.confirmedProducerEdges).toEqual([]);
    expect(
      index.nonConfirmedRelations.flatMap((item) => item.reasonCodes),
    ).toEqual(
      expect.arrayContaining([
        "TASK_PACK_AMBIGUOUS",
        "DEFAULT_DATA_SOURCE_NOT_CONFIRMABLE",
      ]),
    );
    expect(
      index.nonConfirmedRelations.find(
        (item) => item.taskId === "default-source",
      ),
    ).toMatchObject({
      directionStatus: "WRITE_CONFIRMED",
      tableRef: { identityStatus: "QUALIFIED_NAME_ONLY" },
    });
  });

  it("validates and persists artifacts without weakening evidence boundaries", () => {
    const root = dataRoot();
    const tableDirectory = writeTable(root, "lake.a");
    writeTask(root, "p1", {
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "lake.a",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
    });
    const first = buildTableProducerIndex(root, {
      now: () => "2026-08-23T01:00:00.000Z",
    });
    const output = join(dataRoot(), "producer-index.json");

    expect(() => validateTableProducerIndex(first)).not.toThrow();
    expect(writeTableProducerIndex(output, first).changed).toBe(true);
    expect(loadTableProducerIndex(output).contentHash).toBe(first.contentHash);

    const regenerated = buildTableProducerIndex(root, {
      now: () => "2026-08-24T01:00:00.000Z",
    });
    expect(regenerated.contentHash).toBe(first.contentHash);
    expect(writeTableProducerIndex(output, regenerated).changed).toBe(false);
    renameSync(output, `${output}.previous`);
    expect(loadTableProducerIndex(output).contentHash).toBe(first.contentHash);
    expect(existsSync(output)).toBe(true);
    expect(existsSync(`${output}.previous`)).toBe(false);
    writeFileSync(`${output}.previous`, `${JSON.stringify(first, null, 2)}\n`);
    expect(loadTableProducerIndex(output).contentHash).toBe(first.contentHash);
    expect(existsSync(`${output}.previous`)).toBe(false);

    const wrongCounts = {
      ...first,
      counts: { ...first.counts, confirmedProducerEdges: 99 },
    };
    expect(() => validateTableProducerIndex(wrongCounts)).toThrow(
      "counts.confirmedProducerEdges",
    );
    const promotedUnknownIdentity = {
      ...first,
      confirmedProducerEdges: first.confirmedProducerEdges.map((edge, index) =>
        index === 0
          ? { ...edge, table: { ...edge.table, dataSource: "default" } }
          : edge,
      ),
    };
    expect(() => validateTableProducerIndex(promotedUnknownIdentity)).toThrow(
      "default dataSource cannot be RESOLVED",
    );
    const defaultResolvedNonConfirmed = {
      ...first,
      nonConfirmedRelations: [
        {
          taskId: "candidate",
          taskCategory: null,
          taskContentHash: null,
          tableRef: {
            platform: "hive",
            dataSource: "default",
            qualifiedName: "lake.a",
            identityStatus: "RESOLVED",
          },
          directionStatus: "UNKNOWN",
          reasonCodes: ["CANDIDATE"],
          evidence: [],
        },
      ],
      counts: { ...first.counts, candidateObservations: 1 },
    };
    expect(() =>
      validateTableProducerIndex(defaultResolvedNonConfirmed),
    ).toThrow("default dataSource cannot be RESOLVED");
    const missingTablePackEvidence = {
      ...first,
      confirmedProducerEdges: first.confirmedProducerEdges.map((edge) => ({
        ...edge,
        writes: edge.writes.map((write) => ({
          ...write,
          evidence: write.evidence.filter(
            (item) => item.source !== "TABLE_PACK",
          ),
        })),
      })),
    };
    expect(() => validateTableProducerIndex(missingTablePackEvidence)).toThrow(
      "lacks verified Task/Table Pack evidence",
    );
    const noIndexedTaskPacks = {
      ...first,
      buildStatus: "PARTIAL",
      counts: {
        ...first.counts,
        taskPacksIndexed: 0,
        invalidTaskPacks: first.counts.taskPacksDiscovered,
      },
    };
    expect(() => validateTableProducerIndex(noIndexedTaskPacks)).toThrow(
      "confirmed tasks exceed indexed Task Packs",
    );
    const noIndexedTablePacks = {
      ...first,
      buildStatus: "PARTIAL",
      counts: {
        ...first.counts,
        tablePacksIndexed: 0,
        invalidTablePacks: first.counts.tablePacksDiscovered,
      },
    };
    expect(() => validateTableProducerIndex(noIndexedTablePacks)).toThrow(
      "confirmed tables exceed indexed Table Packs",
    );
    expect(() =>
      assertOutputOutsideDataRoot(root, join(root, "derived", "index.json")),
    ).toThrow("OUTPUT_MUST_BE_OUTSIDE_INPUT_PACK_ROOT");

    const ddlPath = join(tableDirectory, "ddl.sql");
    writeFileSync(ddlPath, `${readFileSync(ddlPath, "utf8")} -- changed`);
    const partial = buildTableProducerIndex(root);
    expect(partial.buildStatus).toBe("PARTIAL");
    expect(writeTableProducerIndex(output, partial).changed).toBe(true);
    expect(loadTableProducerIndex(output).buildStatus).toBe("PARTIAL");
  });

  frozen86840It(
    "indexes the 22 frozen local 86840 producers without using supplemental responses",
    () => {
      const fixtureRoot = join(
        process.cwd(),
        "tests",
        "fixtures",
        "reconcile-one-hop",
      );
      const evidence = JSON.parse(
        readFileSync(join(fixtureRoot, "86840-evidence.json"), "utf8"),
      ) as {
        horaeRows: { task_id: string }[];
        supplementalResponses: Record<string, unknown>;
      };
      const supplementalTaskIds = new Set(
        Object.keys(evidence.supplementalResponses),
      );
      const expectedLocalTaskIds = evidence.horaeRows
        .map((row) => row.task_id)
        .filter((taskId) => !supplementalTaskIds.has(taskId))
        .sort();

      const index = buildTableProducerIndex(
        materializeFrozenInputPack(join(fixtureRoot, "86840-input-pack")),
        { now: () => "2026-08-23T04:00:00.000Z" },
      );

      expect(index.buildStatus, JSON.stringify(index.issues, null, 2)).toBe(
        "SUCCESS",
      );
      expect(
        index.confirmedProducerEdges.map((edge) => edge.taskId).sort(),
      ).toEqual(expectedLocalTaskIds);
      expect(index.confirmedProducerEdges).toHaveLength(22);
      expect(
        index.confirmedProducerEdges.some((edge) =>
          supplementalTaskIds.has(edge.taskId),
        ),
      ).toBe(false);
    },
  );
});
