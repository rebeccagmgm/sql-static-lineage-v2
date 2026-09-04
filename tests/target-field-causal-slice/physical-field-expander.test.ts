import { describe, expect, it } from "vitest";

import {
  createPhysicalFieldExpander,
  createCanonicalEvidenceAdapter,
  type PhysicalFieldExpanderTaskPack,
} from "../../scripts/reconcile/consumer/target-field-causal-slice/canonical-evidence-adapter.ts";
import type {
  CurrentBundleLoad,
  JsonRecord,
} from "../../scripts/query/current-task-bundle.ts";
import type {
  PhysicalTableCatalog,
  PhysicalTableCatalogEntry,
} from "../../scripts/machine-facts/input-pack-machine-facts.ts";
import type { PhysicalFieldIdentity } from "../../scripts/reconcile/consumer/field-lineage/field-lineage-contract.ts";

const sourceTable = table("demo.source", ["src_a"]);
const consumerTable = table("demo.root", ["out_a"]);
const source: PhysicalFieldIdentity = {
  platform: "hive",
  dataSource: "warehouse",
  stableTableId: sourceTable.stableTableId,
  qualifiedName: sourceTable.qualifiedName,
  column: "src_a",
  identityStatus: "SCHEMA_BACKED",
};

function table(
  qualifiedName: string,
  columns: readonly string[],
): PhysicalTableCatalogEntry {
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

function catalog(
  entries: readonly PhysicalTableCatalogEntry[],
): PhysicalTableCatalog {
  return {
    entries,
    issues: [],
    byPhysicalKey: new Map(),
    byQualifiedName: new Map([[sourceTable.qualifiedName, [sourceTable]]]),
    byNameTail: new Map(),
  };
}

function pack(
  taskId: string,
  target: PhysicalTableCatalogEntry,
): PhysicalFieldExpanderTaskPack {
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

function relationOccurrence(alias: "c" | "k") {
  const relativeId = `root.${alias}.read.source`;
  const fullId = `task:100:statement:0:relation:${relativeId}`;
  return {
    occurrenceId: `query#0:${relativeId}`,
    readRelationId: relativeId,
    statementIndex: 0,
    relationPath: [relativeId],
    relationNode: {
      relation_id: fullId,
      task_id: "100",
      statement_id: "statement:100:0",
      relation_type: "read",
      source_span: { start: alias === "c" ? 10 : 30, end: alias === "c" ? 25 : 45 },
      provenance: "SQL_PLAN",
      relation: {
        id: fullId,
        type: "read",
        table: "demo.source",
        scope_id: `root.${alias}`,
        read_occurrence_id: fullId,
        read_occurrence: {
          occurrence_id: fullId,
          relation_id: fullId,
          scope_id: `root.${alias}`,
        },
      },
    },
  };
}

function load(
  taskId: string,
  records: Readonly<Record<string, JsonRecord[]>>,
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

function exactSqlWrite(
  observationId: string,
  statementId: string,
  start: number,
  end: number,
) {
  return {
    task_id: "200",
    direction: "WRITE",
    physical_dataset: "demo.source",
    provenance: "SQL_PARSE",
    write_kind: "INSERT_OVERWRITE",
    write_observation_id: observationId,
    write_statement_id: statementId,
    statement_id: statementId,
    source_as_boundary: { statement_span: { start, end } },
  };
}

function createFixture(options: {
  readonly occurrences?: readonly ("c" | "k")[];
  readonly staleOccurrence?: boolean;
  readonly spanConflict?: boolean;
  readonly legacyAmbiguousWrite?: boolean;
  readonly missingExactWriteEvidence?: boolean;
  readonly missingProducerPack?: boolean;
  readonly candidateBranchId?: string;
  readonly producerEndOffset?: number;
} = {}) {
  const occurrenceNodes = (options.occurrences ?? ["c", "k"]).map(
    relationOccurrence,
  );
  const firstOccurrence = relationOccurrence("c");
  const occurrenceForBridge = options.staleOccurrence
    ? {
        occurrenceId: "query#0:root.stale.read.source",
        readRelationId: "root.stale.read.source",
        statementIndex: 0,
        relationPath: ["root.stale.read.source"],
      }
    : firstOccurrence;
  const writes = options.legacyAmbiguousWrite || options.missingExactWriteEvidence
    ? [
        {
          task_id: "200",
          direction: "WRITE",
          physical_dataset: "demo.source",
          provenance: "SQL_PARSE",
          write_kind: "INSERT_OVERWRITE",
          write_observation_id: "write:0",
        },
      ]
    : options.spanConflict
    ? [
        exactSqlWrite("write:0", "statement:200:0", 0, 20),
        exactSqlWrite("write:1", "statement:200:1", 100, 120),
      ]
    : [exactSqlWrite(
        "write:0",
        "statement:200:0",
        0,
        20 + (options.producerEndOffset ?? 0),
      )];
  const producerLoad = load("200", {
    "statements.jsonl": [
      {
        statement_id: "statement:200:0",
        statement_index: 0,
        span: { start: 0, end: 20 },
      },
      ...(options.spanConflict
        ? [
            {
              statement_id: "statement:200:1",
              statement_index: 1,
              span: { start: 100, end: 120 },
            },
          ]
        : []),
    ],
    "dataset-io.jsonl": writes,
    "output-field-bindings.jsonl": writes.map((write) => {
      const writeStatementId =
        "write_statement_id" in write ? write.write_statement_id : undefined;
      return {
        binding_id: `binding:${write.write_observation_id}`,
        task_id: "200",
        write_observation_id: write.write_observation_id,
        write_statement_id: writeStatementId,
        statement_id: writeStatementId,
        target_dataset: "demo.source",
        target_field: "src_a",
        binding_status: "RESOLVED",
      };
    }),
  });
  const consumerLoad = load("100", {
    "statements.jsonl": [
      {
        statement_id: "statement:100:0",
        statement_index: 0,
        span: { start: 0, end: 200 },
      },
    ],
    "dataset-io.jsonl": [
      {
        task_id: "100",
        direction: "READ",
        physical_dataset: "demo.source",
        statement_id: "statement:100:0",
        read_occurrences: occurrenceNodes.map((item) => ({
          occurrence_id: item.relationNode.relation.read_occurrence_id,
          relation_id: item.relationNode.relation.id,
        })),
      },
    ],
    "relation-nodes.jsonl": occurrenceNodes.map((item) => item.relationNode),
  });
  const consumer = pack("100", consumerTable);
  const producer = pack("200", sourceTable);
  const bridges = (options.occurrences ?? ["c", "k"]).map((alias) => ({
    consumerTaskId: "100",
    producerTaskId: "200",
    table: {
      platform: "hive",
      dataSource: "warehouse",
      qualifiedName: "demo.source",
    },
    producerRole: "PRIMARY",
    ...(options.legacyAmbiguousWrite ? {} : { writeObservationId: "write:0" }),
    readOccurrence:
      alias === "c"
        ? occurrenceForBridge
        : relationOccurrence(alias),
  }));
  const context = {
    dataRoot: "data",
    catalog: catalog([consumerTable, sourceTable]),
    tableLineage: {
      taskNodes: [
        {
          taskId: "100",
          upstreamDecision: { primary: ["200"], additional: [], unknown: [] },
        },
      ],
      producerBridges: bridges,
      writeEdges: options.legacyAmbiguousWrite
        ? []
        : [
            {
          producerTaskId: "200",
          table: {
            platform: "hive",
            dataSource: "warehouse",
            qualifiedName: "demo.source",
          },
          writes: writes.map((write, index) => ({
            observationKind: "SQL_EXPLICIT_WRITE",
            sqlWriteKind: "INSERT_OVERWRITE",
            declaredWriteMode: null,
            partition: [],
            evidence: options.missingExactWriteEvidence
              ? []
              : [
                  {
                    source: "SQL_PARSE",
                    detail: {
                      statementStart: index === 0 ? 0 : 100,
                      statementEnd: index === 0 ? 20 : 120,
                    },
                  },
                ],
          })),
            },
          ],
    },
    taskPacks: {
      get: (taskId: string) =>
        taskId === "200" && options.missingProducerPack
          ? undefined
          : { "100": consumer, "200": producer }[taskId],
    },
    loadFacts: (taskId: string) => (taskId === "100" ? consumerLoad : producerLoad),
    factsPolicy: "current-only" as const,
  };
  return {
    adapter: createCanonicalEvidenceAdapter(),
    context,
    request: {
      consumerTaskId: "100",
      consumerPack: consumer,
      consumerLoad,
      sourceNodeId: "field-source-node:100:source:src_a",
      source,
      expressionText: "src_a",
      depth: 0,
      maxDepth: 4,
      candidateBranchId: options.candidateBranchId,
      rootDependenceKind: "ROWSET",
      localDependenceKind: "FILTER_FIELD",
      pathCertainty: "CONFIRMED",
      relationState: { frontier: "CONTROL" },
    },
  };
}

describe("target-field causal-slice physical field expander", () => {
  it("branches same-producer reads by occurrence instead of selecting bridge[0]", () => {
    const fixture = createFixture();
    const result = fixture.adapter.expandPhysicalField(
      fixture.context,
      fixture.request,
    );

    expect(result.producers).toHaveLength(2);
    expect(
      result.producers.map((producer) =>
        producer.bridge?.readOccurrence?.occurrenceId,
      ),
    ).toEqual(["query#0:root.c.read.source", "query#0:root.k.read.source"]);
    expect(result.producers.every((producer) => producer.shouldRecurse)).toBe(true);
  });

  it("fails closed for a fabricated or stale read occurrence", () => {
    const fixture = createFixture({ occurrences: ["c"], staleOccurrence: true });
    const result = fixture.adapter.expandPhysicalField(
      fixture.context,
      fixture.request,
    );

    expect(result.producers[0]).toMatchObject({
      evidenceStatus: "UNRESOLVED",
      shouldRecurse: false,
    });
    expect(result.gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reasonCode: "CONSUMER_READ_OCCURRENCE_NOT_PROVEN",
        }),
      ]),
    );
  });

  it("reports the strict write-proof reason when the producer Task pack is missing", () => {
    const fixture = createFixture({
      occurrences: ["c"],
      missingProducerPack: true,
    });
    const result = fixture.adapter.expandPhysicalField(
      fixture.context,
      fixture.request,
    );

    expect(result.gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reasonCode: "PRODUCER_WRITE_OBSERVATION_NOT_PROVEN",
          taskId: "200",
        }),
      ]),
    );
  });

  it("fails closed when exact SQL write spans conflict", () => {
    const fixture = createFixture({ occurrences: ["c"], spanConflict: true });
    const result = fixture.adapter.expandPhysicalField(
      fixture.context,
      fixture.request,
    );

    expect(result.producers[0]).toMatchObject({
      evidenceStatus: "UNRESOLVED",
      producerBindings: [],
      shouldRecurse: false,
    });
  });

  it("accepts the legacy inclusive statement-end convention without widening the write match", () => {
    const fixture = createFixture({
      occurrences: ["c"],
      producerEndOffset: 1,
    });
    const result = fixture.adapter.expandPhysicalField(
      fixture.context,
      fixture.request,
    );

    expect(result.producers[0]).toMatchObject({
      evidenceStatus: "CONFIRMED",
      producerBindings: [
        expect.objectContaining({
          binding_id: "binding:write:0",
          write_observation_id: "write:0",
        }),
      ],
      shouldRecurse: true,
    });
    expect(result.gaps).toEqual([]);
  });

  it("does not use a unique table and write-kind stale fallback", () => {
    const fixture = createFixture({
      occurrences: ["c"],
      legacyAmbiguousWrite: true,
    });
    const result = fixture.adapter.expandPhysicalField(
      fixture.context,
      fixture.request,
    );

    expect(result.producers[0]).toMatchObject({
      evidenceStatus: "UNRESOLVED",
      producerBindings: [],
      shouldRecurse: false,
    });
    expect(result.gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reasonCode: "PRODUCER_WRITE_OBSERVATION_AMBIGUOUS",
        }),
      ]),
    );
  });

  it("rejects missing exact write evidence in strict mode while legacy mode preserves it", () => {
    const fixture = createFixture({
      occurrences: ["c"],
      missingExactWriteEvidence: true,
    });

    const strictResult = fixture.adapter.expandPhysicalField(
      fixture.context,
      fixture.request,
    );
    const legacyResult = createPhysicalFieldExpander(fixture.context).expand(
      fixture.request,
    );

    expect(strictResult.producers[0]).toMatchObject({
      evidenceStatus: "UNRESOLVED",
      producerBindings: [],
      shouldRecurse: false,
    });
    expect(strictResult.gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reasonCode: "PRODUCER_WRITE_OBSERVATION_AMBIGUOUS",
        }),
      ]),
    );
    expect(legacyResult.producers[0]).toMatchObject({
      evidenceStatus: "CONFIRMED",
      producerBindings: [
        expect.objectContaining({
          binding_id: "binding:write:0",
          write_observation_id: "write:0",
        }),
      ],
      shouldRecurse: true,
    });
    expect(legacyResult.gaps).toEqual([]);
  });

  it("supports control-frontier metadata and carries continuous evidence refs", () => {
    const fixture = createFixture({ occurrences: ["c"], candidateBranchId: "branch:c" });
    const result = fixture.adapter.expandPhysicalField(
      fixture.context,
      fixture.request,
    );

    expect(result.producers[0]).toMatchObject({
      evidenceStatus: "CONFIRMED",
      shouldRecurse: true,
    });
    expect(result.producers[0]!.evidenceRefs).toEqual(
      expect.arrayContaining([
        "field-lineage:candidate-branch:branch:c",
        "field-lineage:consumer-read:100:query#0:root.c.read.source:root.c.read.source",
        "field-lineage:producer-write:200:write:0:binding:write:0",
        "machine-facts:tasks/100/relation-nodes.jsonl",
        "machine-facts:tasks/200/output-field-bindings.jsonl",
      ]),
    );
  });
});
