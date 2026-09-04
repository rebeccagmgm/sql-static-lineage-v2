import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  writeTableInput,
  writeTaskInput,
} from "../../../../scripts/input/shared/input-pack.ts";

const COLLECTED_AT = "2026-01-01T00:00:00.000Z";

function table(
  dataRoot: string,
  qualifiedName: string,
  columns: string,
): void {
  writeTableInput(dataRoot, {
    platform: "hive",
    dataSource: "warehouse",
    qualifiedName,
    objectType: "hive_table",
    partitionFields: [],
    ddl: `CREATE TABLE ${qualifiedName} (${columns});`,
    evidenceProvider: "synthetic:field-lineage-baseline",
    collectedAt: COLLECTED_AT,
  });
}

function task(
  dataRoot: string,
  input: Parameters<typeof writeTaskInput>[1],
): void {
  writeTaskInput(dataRoot, {
    ...input,
    evidenceProvider:
      input.evidenceProvider ?? "synthetic:field-lineage-baseline",
    collectedAt: input.collectedAt ?? COLLECTED_AT,
  });
}

export function createValueAndRowsetFixture(dataRoot: string): void {
  table(dataRoot, "demo.root", "out_a STRING, out_b STRING");
  table(dataRoot, "demo.mid", "mid_a STRING, filter_key STRING");
  table(dataRoot, "demo.source", "src_a STRING, filter_key STRING");
  table(dataRoot, "demo.extra", "src_a STRING");

  task(dataRoot, {
    taskId: "100",
    taskCategory: "sparkIndex",
    taskName: "demo.root.task",
    target: {
      platform: "hive",
      dataSource: "warehouse",
      qualifiedName: "demo.root",
    },
    targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
    partition: null,
    sql: {
      create: {
        content: "CREATE TABLE demo.root (out_a STRING, out_b STRING);",
        evidenceProvider: "synthetic:field-lineage-baseline",
      },
      query: {
        content:
          "SELECT m.mid_a AS out_a, m.filter_key AS out_b FROM mid m WHERE m.filter_key <> 'X';",
        evidenceProvider: "synthetic:field-lineage-baseline",
      },
    },
  });
  task(dataRoot, {
    taskId: "200",
    taskCategory: "hiveTask",
    taskName: "demo.mid.task",
    target: {
      platform: "hive",
      dataSource: "warehouse",
      qualifiedName: "demo.mid",
    },
    targetEvidenceKind: "TABLE_TASK_RELATION_DIRECTION_UNKNOWN",
    evidenceProvider: "synthetic:field-lineage-baseline,opencli:szdata.table-task-relation",
    partition: null,
    sql: {
      query: {
        content:
          "INSERT OVERWRITE TABLE demo.mid SELECT s.src_a, s.filter_key FROM demo.source s;",
        evidenceProvider: "synthetic:field-lineage-baseline",
      },
    },
  });
  task(dataRoot, {
    taskId: "300",
    taskCategory: "sparkIndex",
    taskName: "demo.source.task",
    target: {
      platform: "hive",
      dataSource: "warehouse",
      qualifiedName: "demo.source",
    },
    targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
    partition: null,
    sql: {
      query: {
        content:
          "INSERT OVERWRITE TABLE demo.source SELECT m.mid_a AS src_a, m.filter_key FROM demo.mid m;",
        evidenceProvider: "synthetic:field-lineage-baseline",
      },
    },
  });
  task(dataRoot, {
    taskId: "400",
    taskCategory: "sparkIndex",
    taskName: "demo.source.additional",
    target: {
      platform: "hive",
      dataSource: "warehouse",
      qualifiedName: "demo.source",
    },
    targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
    partition: null,
    sql: {
      query: {
        content:
          "INSERT OVERWRITE TABLE demo.source SELECT e.src_a, e.src_a AS filter_key FROM demo.extra e;",
        evidenceProvider: "synthetic:field-lineage-baseline",
      },
    },
  });
  writeFileSync(
    `${dataRoot}.input-pack-status.json`,
    `${JSON.stringify({
      schemaVersion: "1.0.0",
      dataRoot,
      tasks: {
        "500": {
          taskId: "500",
          status: "EXCLUDED",
          exclusionReason: "PHYSICAL_TABLE_NOT_FOUND",
        },
      },
    })}\n`,
    "utf8",
  );
}

export function valueAndRowsetTableLineage(factsRoot: string) {
  const tableIdentity = { platform: "hive", dataSource: "warehouse" };
  return {
    schemaVersion: "1.0.0",
    artifactType: "TABLE_MULTI_HOP_RECONCILIATION",
    rootTaskId: "100",
    generatedAt: COLLECTED_AT,
    taskNodes: [
      {
        taskId: "100",
        upstreamDecision: { primary: ["200"], additional: [], unknown: [] },
      },
      {
        taskId: "200",
        upstreamDecision: {
          primary: ["300", "500"],
          additional: ["400"],
          unknown: [],
        },
      },
      {
        taskId: "300",
        upstreamDecision: { primary: ["200"], additional: [], unknown: [] },
      },
      {
        taskId: "400",
        upstreamDecision: { primary: [], additional: [], unknown: [] },
      },
    ],
    producerBridges: [
      {
        consumerTaskId: "100",
        producerTaskId: "200",
        producerRole: "PRIMARY",
        table: { ...tableIdentity, qualifiedName: "demo.mid" },
        readOccurrence: readRelationOccurrenceForTask(factsRoot, "100", "m"),
      },
      {
        consumerTaskId: "200",
        producerTaskId: "300",
        producerRole: "PRIMARY",
        table: { ...tableIdentity, qualifiedName: "demo.source" },
        readOccurrence: readRelationOccurrenceForTask(factsRoot, "200", "s"),
      },
      {
        consumerTaskId: "200",
        producerTaskId: "400",
        producerRole: "ADDITIONAL",
        table: { ...tableIdentity, qualifiedName: "demo.source" },
        readOccurrence: readRelationOccurrenceForTask(factsRoot, "200", "s"),
      },
      {
        consumerTaskId: "200",
        producerTaskId: "500",
        producerRole: "PRIMARY",
        table: { ...tableIdentity, qualifiedName: "demo.source" },
        readOccurrence: readRelationOccurrenceForTask(factsRoot, "200", "s"),
      },
      {
        consumerTaskId: "300",
        producerTaskId: "200",
        producerRole: "PRIMARY",
        table: { ...tableIdentity, qualifiedName: "demo.mid" },
        readOccurrence: readRelationOccurrenceForTask(factsRoot, "300", "m"),
      },
    ],
  };
}

export function createDefaultHiveSchemaFixture(dataRoot: string): void {
  table(dataRoot, "hive_db.root", "out_a STRING");
  table(dataRoot, "hive_db.source", "src_a STRING, control_key STRING");
  table(dataRoot, "other.source", "src_a STRING, control_key STRING");
  task(dataRoot, {
    taskId: "110",
    taskCategory: "sparkIndex",
    taskName: "hive_db.root.task",
    target: {
      platform: "hive",
      dataSource: "warehouse",
      qualifiedName: "hive_db.root",
    },
    targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
    partition: null,
    sql: {
      create: {
        content: "CREATE TABLE hive_db.root (out_a STRING);",
        evidenceProvider: "synthetic:field-lineage-baseline",
      },
      query: {
        content:
          "SELECT s.src_a AS out_a FROM source s WHERE s.control_key <> 'X';",
        evidenceProvider: "synthetic:field-lineage-baseline",
      },
    },
  });
}

export function createSelfJoinFixture(dataRoot: string): void {
  table(dataRoot, "demo.root", "left_amount STRING, right_amount STRING");
  table(dataRoot, "demo.same", "id STRING, amount STRING");
  table(dataRoot, "demo.source", "id STRING, amount STRING");
  task(dataRoot, {
    taskId: "120",
    taskCategory: "sparkIndex",
    taskName: "demo.root.self-join.task",
    target: {
      platform: "hive",
      dataSource: "warehouse",
      qualifiedName: "demo.root",
    },
    targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
    partition: null,
    sql: {
      create: {
        content:
          "CREATE TABLE demo.root (left_amount STRING, right_amount STRING);",
        evidenceProvider: "synthetic:field-lineage-baseline",
      },
      query: {
        content:
          "SELECT l.amount AS left_amount, r.amount AS right_amount FROM demo.same l JOIN demo.same r ON l.id = r.id;",
        evidenceProvider: "synthetic:field-lineage-baseline",
      },
    },
  });
  for (const taskId of ["121", "122"])
    task(dataRoot, {
      taskId,
      taskCategory: "sparkIndex",
      taskName: `demo.same.${taskId}`,
      target: {
        platform: "hive",
        dataSource: "warehouse",
        qualifiedName: "demo.same",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
      partition: null,
      sql: {
        query: {
          content:
            "INSERT OVERWRITE TABLE demo.same SELECT id, amount FROM demo.source;",
          evidenceProvider: "synthetic:field-lineage-baseline",
        },
      },
    });
}

export function readRelationOccurrence(
  factsRoot: string,
  alias: "l" | "r",
): {
  readonly occurrenceId: string;
  readonly readRelationId: string;
  readonly statementIndex: number;
  readonly relationPath: readonly string[];
} {
  return readRelationOccurrenceForTask(factsRoot, "120", alias);
}

export function readRelationOccurrenceForTask(
  factsRoot: string,
  taskId: string,
  alias: string,
): {
  readonly occurrenceId: string;
  readonly readRelationId: string;
  readonly statementIndex: number;
  readonly relationPath: readonly string[];
} {
  const relationNodes = readFileSync(
    join(
      factsRoot,
      "registry",
      "tasks",
      taskId,
      "bundle",
      "relation-nodes.jsonl",
    ),
    "utf8",
  )
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { relation_id?: string; relation_type?: string });
  const relation = relationNodes.find(
    (candidate) =>
      candidate.relation_type === "read" &&
      String(candidate.relation_id).includes(`:root.read.${alias}`),
  );
  if (!relation?.relation_id) {
    throw new Error(`BASELINE_READ_OCCURRENCE_MISSING:${alias}`);
  }
  const readRelationId = relation.relation_id.split(":relation:")[1];
  if (!readRelationId) throw new Error(`BASELINE_READ_RELATION_ID_MISSING:${alias}`);
  return {
    occurrenceId: `query#0:${readRelationId}`,
    readRelationId,
    statementIndex: 0,
    relationPath: [readRelationId],
  };
}
