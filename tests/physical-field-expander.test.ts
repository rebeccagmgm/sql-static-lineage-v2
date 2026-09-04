import { describe, expect, it } from "vitest";

import {
  createPhysicalFieldExpander,
  type PhysicalFieldEvidenceMode,
  type PhysicalFieldExpanderTaskPack,
} from "../scripts/reconcile/consumer/field-lineage/physical-field-expander.ts";
import type { CurrentBundleLoad } from "../scripts/query/current-task-bundle.ts";
import type {
  PhysicalTableCatalog,
  PhysicalTableCatalogEntry,
} from "../scripts/machine-facts/input-pack-machine-facts.ts";
import type { PhysicalFieldIdentity } from "../scripts/reconcile/consumer/field-lineage/field-lineage-contract.ts";

function table(qualifiedName: string, columns: readonly string[]): PhysicalTableCatalogEntry {
  return {
    platform: "hive",
    dataSource: "warehouse",
    stableTableId: `${qualifiedName}__warehouse`,
    qualifiedName,
    guid: null,
    partitionFields: null,
    columns,
    tablePath: `${qualifiedName}.json`,
    ddlPath: `${qualifiedName}.sql`,
    tableContentHash: "table-hash",
    ddlSha256: "ddl-hash",
  };
}

function catalog(entries: readonly PhysicalTableCatalogEntry[]): PhysicalTableCatalog {
  const byQualifiedName = new Map<string, readonly PhysicalTableCatalogEntry[]>();
  for (const entry of entries)
    byQualifiedName.set(entry.qualifiedName, [
      ...(byQualifiedName.get(entry.qualifiedName) ?? []),
      entry,
    ]);
  return {
    entries,
    issues: [],
    byPhysicalKey: new Map(),
    byQualifiedName,
    byNameTail: new Map(),
  };
}

function load(
  taskId: string,
  records: Readonly<Record<string, Record<string, any>[]>>,
): CurrentBundleLoad {
  return {
    state: "CURRENT_L1",
    factsRoot: "facts",
    taskId,
    bundleDir: `facts/${taskId}`,
    indexPath: `facts/${taskId}/index.jsonl`,
    statusPath: `facts/${taskId}/analysis-status.json`,
    manifest: { schema_version: "2.0.0" },
    records,
    evidence: {
      "dataset-io.jsonl": `machine-facts:tasks/${taskId}/dataset-io.jsonl`,
      "relation-nodes.jsonl": `machine-facts:tasks/${taskId}/relation-nodes.jsonl`,
      "output-field-bindings.jsonl": `machine-facts:tasks/${taskId}/output-field-bindings.jsonl`,
    },
    issues: [],
  };
}

function pack(taskId: string, target: PhysicalTableCatalogEntry): PhysicalFieldExpanderTaskPack {
  return {
    document: {
      taskId,
      taskCategory: "hiveTask",
      taskName: `task-${taskId}`,
      target: {
        platform: target.platform,
        dataSource: target.dataSource,
        qualifiedName: target.qualifiedName,
      },
    } as unknown as PhysicalFieldExpanderTaskPack["document"],
    path: `tasks/${taskId}/task.json`,
    target,
  };
}

function context(options: {
  readonly occurrence?: object;
  readonly producerBinding?: boolean;
  readonly multipleWrites?: boolean;
  readonly artifactWriteEvidence?: boolean;
  readonly aggregateWrites?: boolean;
  readonly artifactSqlStart?: number;
  readonly evidenceMode?: PhysicalFieldEvidenceMode;
  readonly mismatchedProducerTarget?: boolean;
  readonly legacyScheduleFallback?: boolean;
  readonly missingProducerPack?: boolean;
  readonly exposeRelationNodes?: boolean;
} = {}) {
  const sourceTable = table("demo.source", ["src_a"]);
  const consumerTable = table("demo.root", ["out_a"]);
  const producerTarget = options.mismatchedProducerTarget
    ? table("demo.other", ["src_a"])
    : options.legacyScheduleFallback
      ? null
      : sourceTable;
  const producer = producerTarget ? pack("200", producerTarget) : {
    ...pack("200", sourceTable),
    target: null,
  };
  const consumer = pack("100", consumerTable);
  const producerRecords: Record<string, Record<string, any>[]> = options.producerBinding
    ? {
        "dataset-io.jsonl": (options.multipleWrites
          ? options.aggregateWrites
            ? ["INSERT_OVERWRITE", "INSERT_OVERWRITE"]
            : ["INSERT_OVERWRITE", "INSERT_INTO"]
          : ["PLATFORM_TARGET_QUERY_OUTPUT"]
        ).map((writeKind, index) => ({
          task_id: "200",
          direction: "WRITE",
          physical_dataset: "demo.source",
          provenance: options.multipleWrites ? "SQL_PARSE" : "PLATFORM_TARGET",
          write_kind: writeKind,
          write_observation_id: `write-observation:200:${index}`,
        })),
        "output-field-bindings.jsonl": [
          ...(options.multipleWrites ? [0, 1] : [0]).map((index) => ({
            binding_id: `binding:200:${index}:0`,
            task_id: "200",
            write_observation_id: `write-observation:200:${index}`,
            target_dataset: "demo.source",
            target_field: "src_a",
            binding_status: "RESOLVED",
          })),
        ],
      }
    : {};
  const consumerLoad = load(
    "100",
    options.exposeRelationNodes ? { "relation-nodes.jsonl": [] } : {},
  );
  const producerLoad = load("200", producerRecords);
  const source: PhysicalFieldIdentity = {
    platform: "hive",
    dataSource: "warehouse",
    stableTableId: sourceTable.stableTableId,
    qualifiedName: sourceTable.qualifiedName,
    column: "src_a",
    identityStatus: "SCHEMA_BACKED",
  };
  const expander = createPhysicalFieldExpander({
    dataRoot: "data",
    catalog: catalog([consumerTable, sourceTable]),
    tableLineage: {
      taskNodes: [
        { taskId: "100", upstreamDecision: { primary: ["200"], additional: [], unknown: [] } },
      ],
      producerBridges: options.legacyScheduleFallback ? [] : [
        {
          consumerTaskId: "100",
          producerTaskId: "200",
          table: { platform: "hive", dataSource: "warehouse", qualifiedName: "demo.source" },
          producerRole: "PRIMARY",
          readOccurrence: options.occurrence ?? null,
        },
      ],
      ...(options.legacyScheduleFallback
        ? {
            scheduleEdges: [{ consumerTaskId: "100", producerTaskId: "200" }],
            readEdges: [{
              consumerTaskId: "100",
              recursionStatus: "ELIGIBLE",
              table: { platform: "hive", dataSource: "warehouse", qualifiedName: "demo.source" },
            }],
          }
        : {}),
      ...(options.producerBinding && options.artifactWriteEvidence !== false
        ? {
            writeEdges: [{
              producerTaskId: "200",
              table: { platform: "hive", dataSource: "warehouse", qualifiedName: "demo.source" },
              writes: [options.multipleWrites
                ? {
                    observationKind: "SQL_EXPLICIT_WRITE",
                    declaredWriteMode: null,
                    sqlWriteKind: "INSERT_OVERWRITE",
                     partition: options.aggregateWrites
                       ? [{
                           field: "src_partition",
                           expression: "'partition-a'",
                           valueStatus: "OBSERVED_RENDERED_VALUE",
                           observedValue: "partition-a",
                         }]
                       : [],
                     ...(options.aggregateWrites
                       ? { partitionStatus: "COMPLETE" }
                       : {}),
                    evidence:
                      options.artifactSqlStart === undefined
                        ? []
                        : [
                            {
                              source: "SQL_PARSE",
                              locator: `query.sql#char=${options.artifactSqlStart}`,
                              detail: {
                                statementStart: options.artifactSqlStart,
                                sqlWriteKind: "INSERT_OVERWRITE",
                              },
                            },
                          ],
                  }
                : {
                    observationKind: "DIRECT_TARGET",
                    targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
                    declaredWriteMode: null,
                    sqlWriteKind: null,
                    partition: [],
                    evidence: [],
                  }],
            }],
          }
        : {}),
    },
    taskPacks: {
      get: (taskId) =>
        taskId === "200" && options.missingProducerPack
          ? undefined
          : { "100": consumer, "200": producer }[taskId],
    },
    loadFacts: (taskId) => (taskId === "100" ? consumerLoad : producerLoad),
    factsPolicy: "current-only",
  }, { evidenceMode: options.evidenceMode });
  return { expander, consumer, consumerLoad, source };
}

const occurrence = {
  occurrenceId: "query#0:root.s.read.source",
  readRelationId: "root.s.read.source",
  statementIndex: 0,
  relationPath: ["root.s.read.source"],
};

describe("physical field expander", () => {
  it("returns a confirmed expansion only with occurrence-specific read and write evidence", () => {
    const { expander, consumer, consumerLoad, source } = context({
      occurrence,
      producerBinding: true,
    });
    const result = expander.expand({
      consumerTaskId: "100",
      consumerPack: consumer,
      consumerLoad,
      sourceNodeId: "field-source-node:100:source:src_a",
      source,
      expressionText: "s.src_a",
      depth: 0,
      maxDepth: 4,
    });
    expect(result.producers).toHaveLength(1);
    expect(result.producers[0]).toMatchObject({
      producerTaskId: "200",
      evidenceStatus: "CONFIRMED",
      producerBindings: [{ binding_id: "binding:200:0:0" }],
    });
    expect(result.producers[0]!.evidenceRefs).toEqual(
      expect.arrayContaining([
        "field-lineage:consumer-read:100:query#0:root.s.read.source:root.s.read.source",
        "field-lineage:producer-write:200:write-observation:200:0:binding:200:0:0",
      ]),
    );
    expect(result.gaps).toEqual([]);
  });

  it("keeps the producer unresolved and records a gap when the bridge is not continuous", () => {
    const { expander, consumer, consumerLoad, source } = context();
    const result = expander.expand({
      consumerTaskId: "100",
      consumerPack: consumer,
      consumerLoad,
      sourceNodeId: "field-source-node:100:source:src_a",
      source,
      expressionText: "s.src_a",
      depth: 0,
      maxDepth: 4,
    });
    expect(result.producers[0]!.evidenceStatus).toBe("UNRESOLVED");
    expect(result.producers[0]!.shouldRecurse).toBe(false);
    expect(result.gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reasonCode: "CROSS_TASK_BRIDGE_EVIDENCE_INCOMPLETE",
        }),
      ]),
    );
  });

  it("filters producer bindings to the one artifact-proven write observation", () => {
    const { expander, consumer, consumerLoad, source } = context({
      occurrence,
      producerBinding: true,
      multipleWrites: true,
    });
    const result = expander.expand({
      consumerTaskId: "100",
      consumerPack: consumer,
      consumerLoad,
      sourceNodeId: "field-source-node:100:source:src_a",
      source,
      expressionText: "s.src_a",
      depth: 0,
      maxDepth: 4,
    });
    expect(result.producers[0]).toMatchObject({
      evidenceStatus: "CONFIRMED",
      producerBindings: [
        {
          binding_id: "binding:200:0:0",
          write_observation_id: "write-observation:200:0",
        },
      ],
      shouldRecurse: true,
    });
    expect(result.producers[0]!.producerBindings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ write_observation_id: "write-observation:200:1" }),
      ]),
    );
  });

  it("uses a unique SQL write kind when parser spans are not byte-identical", () => {
    const { expander, consumer, consumerLoad, source } = context({
      occurrence,
      producerBinding: true,
      multipleWrites: true,
      artifactSqlStart: 10,
    });
    const result = expander.expand({
      consumerTaskId: "100",
      consumerPack: consumer,
      consumerLoad,
      sourceNodeId: "field-source-node:100:source:src_a",
      source,
      expressionText: "s.src_a",
      depth: 0,
      maxDepth: 4,
    });
    expect(result.producers[0]).toMatchObject({
      evidenceStatus: "CONFIRMED",
      producerBindings: [
        {
          binding_id: "binding:200:0:0",
          write_observation_id: "write-observation:200:0",
        },
      ],
      shouldRecurse: true,
    });
    expect(result.gaps).toEqual([]);
  });

  it("keeps the legacy bridge reason when the producer Task pack is missing", () => {
    const { expander, consumer, consumerLoad, source } = context({
      missingProducerPack: true,
      exposeRelationNodes: true,
    });
    const result = expander.expand({
      consumerTaskId: "100",
      consumerPack: consumer,
      consumerLoad,
      sourceNodeId: "field-source-node:100:source:src_a",
      source,
      expressionText: "s.src_a",
      depth: 0,
      maxDepth: 4,
    });

    expect(result.gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reasonCode: "CROSS_TASK_BRIDGE_EVIDENCE_INCOMPLETE",
          taskId: "200",
        }),
      ]),
    );
    expect(result.gaps).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reasonCode: "PRODUCER_WRITE_OBSERVATION_NOT_PROVEN",
        }),
      ]),
    );
  });

  it("does not fan out multiple writes without occurrence-specific write evidence", () => {
    const { expander, consumer, consumerLoad, source } = context({
      occurrence,
      producerBinding: true,
      multipleWrites: true,
      artifactWriteEvidence: false,
    });
    const result = expander.expand({
      consumerTaskId: "100",
      consumerPack: consumer,
      consumerLoad,
      sourceNodeId: "field-source-node:100:source:src_a",
      source,
      expressionText: "s.src_a",
      depth: 0,
      maxDepth: 4,
    });
    expect(result.producers[0]).toMatchObject({
      evidenceStatus: "UNRESOLVED",
      producerBindings: [],
      shouldRecurse: false,
    });
    expect(result.gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reasonCode: "CROSS_TASK_BRIDGE_EVIDENCE_INCOMPLETE",
        }),
      ]),
    );
  });

  it("aggregates same-partition writes when every occurrence resolves the same field", () => {
    const { expander, consumer, consumerLoad, source } = context({
      occurrence,
      producerBinding: true,
      multipleWrites: true,
      aggregateWrites: true,
    });
    const result = expander.expand({
      consumerTaskId: "100",
      consumerPack: consumer,
      consumerLoad,
      sourceNodeId: "field-source-node:100:source:src_a",
      source,
      expressionText: "s.src_a",
      depth: 0,
      maxDepth: 4,
    });
    expect(result.producers[0]).toMatchObject({
      evidenceStatus: "CONFIRMED",
      shouldRecurse: true,
    });
    expect(result.producers[0]!.producerBindings).toEqual([
      expect.objectContaining({ write_observation_id: "write-observation:200:0" }),
      expect.objectContaining({ write_observation_id: "write-observation:200:1" }),
    ]);
    expect(result.gaps).toEqual([]);
  });

  it("uses the same partition-field aggregation in strict causal mode", () => {
    const { expander, consumer, consumerLoad, source } = context({
      occurrence,
      producerBinding: true,
      multipleWrites: true,
      aggregateWrites: true,
      evidenceMode: "STRICT_CAUSAL",
    });
    const result = expander.expand({
      consumerTaskId: "100",
      consumerPack: consumer,
      consumerLoad,
      sourceNodeId: "field-source-node:100:source:src_a",
      source,
      expressionText: "s.src_a",
      depth: 0,
      maxDepth: 4,
    });
    expect(result.producers[0]).toMatchObject({
      evidenceStatus: "CONFIRMED",
      shouldRecurse: true,
    });
    expect(result.producers[0]!.producerBindings).toHaveLength(2);
    expect(result.gaps).toEqual([]);
  });

  it("blocks recursion when the producer physical table disagrees with the bridge table", () => {
    const { expander, consumer, consumerLoad, source } = context({
      occurrence,
      producerBinding: true,
      mismatchedProducerTarget: true,
    });
    const result = expander.expand({
      consumerTaskId: "100",
      consumerPack: consumer,
      consumerLoad,
      sourceNodeId: "field-source-node:100:source:src_a",
      source,
      expressionText: "s.src_a",
      depth: 0,
      maxDepth: 4,
    });
    expect(result.producers[0]!.shouldRecurse).toBe(false);
    expect(result.producers[0]!.producerBindings).toEqual([]);
    expect(result.gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reasonCode: "PHYSICAL_FIELD_IDENTITY_MISMATCH",
          taskId: "200",
        }),
      ]),
    );
  });

  it("keeps the legacy schedule/read fallback as an unresolved non-recursive gap", () => {
    const { expander, consumer, consumerLoad, source } = context({
      legacyScheduleFallback: true,
    });
    const result = expander.expand({
      consumerTaskId: "100",
      consumerPack: consumer,
      consumerLoad,
      sourceNodeId: "field-source-node:100:source:src_a",
      source,
      expressionText: "s.src_a",
      depth: 0,
      maxDepth: 4,
    });
    expect(result.producers[0]!.shouldRecurse).toBe(false);
    expect(result.gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reasonCode: "LEGACY_SCHEDULE_READ_FALLBACK_UNRESOLVED",
          taskId: "200",
        }),
      ]),
    );
  });
});
