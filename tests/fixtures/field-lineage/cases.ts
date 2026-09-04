import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  writeTableInput,
  writeTaskInput,
} from "../../../scripts/input/shared/input-pack.ts";

export function createSyntheticFieldLineageInputPack(
  dataRoot: string,
  options: { readonly rootTaskName?: string } = {},
): void {
  for (const table of [
    { qualifiedName: "demo.root", columns: "out_a STRING, out_b STRING" },
    { qualifiedName: "demo.mid", columns: "mid_a STRING, filter_key STRING" },
    {
      qualifiedName: "demo.source",
      columns: "src_a STRING, filter_key STRING",
    },
    { qualifiedName: "demo.extra", columns: "src_a STRING" },
    {
      qualifiedName: "demo.partitioned",
      columns: "value_col STRING, p STRING",
      partitionFields: ["p"],
    },
  ]) {
    writeTableInput(dataRoot, {
      platform: "hive",
      dataSource: "warehouse",
      qualifiedName: table.qualifiedName,
      objectType: "hive_table",
      partitionFields: "partitionFields" in table ? table.partitionFields : [],
      ddl: `CREATE TABLE ${table.qualifiedName} (${table.columns});`,
      evidenceProvider: "synthetic:test",
      collectedAt: "2026-01-01T00:00:00.000Z",
    });
  }
  writeTaskInput(dataRoot, {
    taskId: "100",
    taskCategory: "sparkIndex",
    taskName: options.rootTaskName ?? "demo.root.task",
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
        evidenceProvider: "synthetic:test",
      },
      query: {
        content:
          "SELECT m.mid_a AS out_a, m.filter_key AS out_b FROM mid m WHERE m.filter_key <> 'X';",
        evidenceProvider: "synthetic:test",
      },
    },
    evidenceProvider: "synthetic:test",
    collectedAt: "2026-01-01T00:00:00.000Z",
  });
  writeTaskInput(dataRoot, {
    taskId: "200",
    taskCategory: "hiveTask",
    taskName: "demo.mid.task",
    target: {
      platform: "hive",
      dataSource: "warehouse",
      qualifiedName: "demo.mid",
    },
    targetEvidenceKind: "TABLE_TASK_RELATION_DIRECTION_UNKNOWN",
    partition: null,
    sql: {
      query: {
        content:
          "INSERT OVERWRITE TABLE demo.mid SELECT s.src_a, s.filter_key FROM demo.source s;",
        evidenceProvider: "synthetic:test",
      },
    },
    evidenceProvider: "synthetic:test,opencli:szdata.table-task-relation",
    collectedAt: "2026-01-01T00:00:00.000Z",
  });
  writeTaskInput(dataRoot, {
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
        content: "SELECT m.mid_a AS src_a, m.filter_key FROM demo.mid m;",
        evidenceProvider: "synthetic:test",
      },
    },
    evidenceProvider: "synthetic:test",
    collectedAt: "2026-01-01T00:00:00.000Z",
  });
  writeTaskInput(dataRoot, {
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
        content: "SELECT e.src_a, e.src_a AS filter_key FROM demo.extra e;",
        evidenceProvider: "synthetic:test",
      },
    },
    evidenceProvider: "synthetic:test",
    collectedAt: "2026-01-01T00:00:00.000Z",
  });
  writeTaskInput(dataRoot, {
    taskId: "600",
    taskCategory: "sparkIndex",
    taskName: "ambiguous.slots",
    target: {
      platform: "hive",
      dataSource: "warehouse",
      qualifiedName: "demo.root",
    },
    targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
    partition: null,
    sql: {
      create: {
        content: "SELECT src_a AS out_a, src_a AS out_b FROM demo.extra;",
        evidenceProvider: "synthetic:test",
      },
      prepare: {
        content: "SELECT src_a AS out_a, src_a AS out_b FROM demo.extra;",
        evidenceProvider: "synthetic:test",
      },
    },
    evidenceProvider: "synthetic:test",
    collectedAt: "2026-01-01T00:00:00.000Z",
  });
  writeTaskInput(dataRoot, {
    taskId: "700",
    taskCategory: "sparkIndex",
    taskName: "missing.source.schema",
    target: {
      platform: "hive",
      dataSource: "warehouse",
      qualifiedName: "demo.root",
    },
    targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
    partition: null,
    sql: {
      query: {
        content:
          "SELECT x.missing_value AS out_a, x.other_value AS out_b FROM demo.not_packed x;",
        evidenceProvider: "synthetic:test",
      },
    },
    evidenceProvider: "synthetic:test",
    collectedAt: "2026-01-01T00:00:00.000Z",
  });
  writeTaskInput(dataRoot, {
    taskId: "800",
    taskCategory: "hiveTask",
    taskName: "dynamic.partition.union",
    target: {
      platform: "hive",
      dataSource: "warehouse",
      qualifiedName: "demo.partitioned",
    },
    targetEvidenceKind: "TABLE_TASK_RELATION_DIRECTION_UNKNOWN",
    partition: [{ p: "A" }, { p: "B" }],
    sql: {
      query: {
        content:
          "INSERT OVERWRITE TABLE demo.partitioned PARTITION(p) SELECT src_a, 'A' AS p FROM demo.extra UNION ALL SELECT src_a, 'B' AS p FROM demo.extra;",
        evidenceProvider: "synthetic:test",
      },
    },
    evidenceProvider: "synthetic:test,opencli:szdata.table-task-relation",
    collectedAt: "2026-01-01T00:00:00.000Z",
  });
  writeTaskInput(dataRoot, {
    taskId: "900",
    taskCategory: "hiveTask",
    taskName: "multiple.output.writes",
    target: {
      platform: "hive",
      dataSource: "warehouse",
      qualifiedName: "demo.root",
    },
    targetEvidenceKind: "TABLE_TASK_RELATION_DIRECTION_UNKNOWN",
    partition: null,
    sql: {
      query: {
        content:
          "INSERT OVERWRITE TABLE demo.root SELECT src_a, src_a FROM demo.extra; INSERT OVERWRITE TABLE demo.root SELECT src_a, src_a FROM demo.extra;",
        evidenceProvider: "synthetic:test",
      },
    },
    evidenceProvider: "synthetic:test,opencli:szdata.table-task-relation",
    collectedAt: "2026-01-01T00:00:00.000Z",
  });
  writeTaskInput(dataRoot, {
    taskId: "1000",
    taskCategory: "sparkIndex",
    taskName: "multi.slot.ctas",
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
          "CREATE TABLE temp.local_stage AS SELECT src_a AS mid_a FROM demo.extra; CREATE TABLE temp.mid_stage AS SELECT mid_a AS out_a FROM temp.local_stage;",
        evidenceProvider: "synthetic:test",
      },
      query: {
        content: "SELECT out_a, out_a AS out_b FROM temp.mid_stage;",
        evidenceProvider: "synthetic:test",
      },
    },
    evidenceProvider: "synthetic:test",
    collectedAt: "2026-01-01T00:00:00.000Z",
  });
  writeFileSync(
    `${dataRoot}.input-pack-status.json`,
    JSON.stringify({
      schemaVersion: "1.0.0",
      dataRoot,
      tasks: {
        "500": {
          taskId: "500",
          status: "EXCLUDED",
          exclusionReason: "PHYSICAL_TABLE_NOT_FOUND",
        },
      },
    }),
    "utf8",
  );
}

export function syntheticTableLineage() {
  const table = { platform: "hive", dataSource: "warehouse" };
  return {
    schemaVersion: "1.0.0",
    artifactType: "TABLE_MULTI_HOP_RECONCILIATION",
    rootTaskId: "100",
    generatedAt: "2026-01-01T00:00:00.000Z",
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
        table: { ...table, qualifiedName: "demo.mid" },
      },
      {
        consumerTaskId: "200",
        producerTaskId: "300",
        table: { ...table, qualifiedName: "demo.source" },
      },
      {
        consumerTaskId: "200",
        producerTaskId: "400",
        table: { ...table, qualifiedName: "demo.source" },
      },
      {
        consumerTaskId: "200",
        producerTaskId: "500",
        table: { ...table, qualifiedName: "demo.source" },
      },
      {
        consumerTaskId: "300",
        producerTaskId: "200",
        table: { ...table, qualifiedName: "demo.mid" },
      },
    ],
  };
}

function tableNameVariants(value: string): string[] {
  const normalized = value
    .trim()
    .replace(/^[`\"]|[`\"]$/g, "")
    .toLowerCase();
  if (!normalized) return [];
  return [normalized, normalized.split(".").at(-1)!];
}

function tableNamesMatch(left: string, right: string): boolean {
  const rightVariants = new Set(tableNameVariants(right));
  return tableNameVariants(left).some((variant) => rightVariants.has(variant));
}

export function syntheticTableLineageWithFacts(
  factsRoot: string,
  tableLineage: ReturnType<typeof syntheticTableLineage> = syntheticTableLineage(),
) {
  const roleByTaskPair = new Map<string, "PRIMARY" | "ADDITIONAL" | "UNKNOWN">();
  for (const rawNode of tableLineage.taskNodes) {
    const decision = rawNode.upstreamDecision;
    for (const producerTaskId of decision.primary)
      roleByTaskPair.set(`${rawNode.taskId}\u0000${producerTaskId}`, "PRIMARY");
    for (const producerTaskId of decision.additional)
      roleByTaskPair.set(`${rawNode.taskId}\u0000${producerTaskId}`, "ADDITIONAL");
    for (const producerTaskId of decision.unknown)
      roleByTaskPair.set(`${rawNode.taskId}\u0000${producerTaskId}`, "UNKNOWN");
  }
  const relationNodesByTask = new Map<string, Record<string, unknown>[]>();
  for (const taskId of new Set(
    tableLineage.producerBridges.map((bridge) => String(bridge.consumerTaskId)),
  )) {
    const path = join(
      factsRoot,
      "registry",
      "tasks",
      taskId,
      "bundle",
      "relation-nodes.jsonl",
    );
    const records = readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    relationNodesByTask.set(taskId, records);
  }

  return {
    ...tableLineage,
    producerBridges: tableLineage.producerBridges.map((bridge) => {
      const bridgeRecord = bridge as Record<string, unknown>;
      const producerRole =
        bridgeRecord.producerRole ??
        roleByTaskPair.get(
          `${bridge.consumerTaskId}\u0000${bridge.producerTaskId}`,
        );
      if (bridgeRecord.readOccurrence && producerRole)
        return { ...bridge, producerRole };
      const bridgeTable = bridge.table as Record<string, unknown>;
      const bridgeTableName = String(bridgeTable.qualifiedName ?? "");
      const relation = (relationNodesByTask.get(String(bridge.consumerTaskId)) ?? []).find(
        (candidate) => {
          const nested = candidate.relation as Record<string, unknown> | undefined;
          return (
            candidate.relation_type === "read" &&
            typeof nested?.table === "string" &&
            tableNamesMatch(nested.table, bridgeTableName)
          );
        },
      );
      if (!relation) return producerRole ? { ...bridge, producerRole } : bridge;
      const fullRelationId = String(relation.relation_id ?? "");
      const relativeRelationId =
        fullRelationId.split(":relation:")[1] ?? fullRelationId;
      const statementIndex = Number(
        String(relation.statement_id ?? "").match(/:statement:(\d+)$/)?.[1] ??
          0,
      );
      return {
        ...bridge,
        ...(producerRole ? { producerRole } : {}),
        readOccurrence: {
          occurrenceId: `query#${statementIndex}:${relativeRelationId}`,
          readRelationId: relativeRelationId,
          statementIndex,
          relationPath: [relativeRelationId],
        },
      };
    }),
  };
}
