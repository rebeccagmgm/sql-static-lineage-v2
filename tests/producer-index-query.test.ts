import { describe, expect, it } from "vitest";

import {
  lookupConfirmedProducers,
  lookupProducerWritesByTask,
  lookupProducersByTablePartition,
  matchProducersByReadScope,
  type PartitionQuery,
} from "../scripts/query/producer-index-query.ts";
import type { ReadPartitionScope } from "../scripts/evidence/sql-read-scope.ts";
import { resolveReadPartitionScope } from "../scripts/evidence/sql-read-scope.ts";
import type {
  ProducerTableIdentity,
  TableProducerIndex,
} from "../scripts/reconcile/producer/producer-index.ts";

const table: ProducerTableIdentity = {
  platform: "hive",
  dataSource: "gfhive",
  qualifiedName: "dm_cisp_n.otc_deri_swap_trd_equi_pymt_det",
};

function write(
  partition: Array<{
    field: string;
    expression: string;
    valueStatus: "OBSERVED_RENDERED_VALUE" | "RUNTIME_EXPRESSION" | "UNKNOWN";
    observedValue: string | null;
  }>,
) {
  return {
    observationKind: "DIRECT_TARGET" as const,
    declaredWriteMode: null,
    sqlWriteKind: null,
    partition,
    partitionStatus: "COMPLETE" as const,
    partitionReasonCodes: ["PARTITION_EVIDENCE_COMPLETE"],
    evidence: [
      {
        source: "INPUT_PACK_TASK" as const,
        provider: "test",
        locator: "tasks/sparkIndex/207229/task.json",
        observedAt: null,
        contentHash: "a".repeat(64),
      },
      {
        source: "TABLE_PACK" as const,
        provider: "test",
        locator: "tables/hive/table/table.json",
        observedAt: null,
        contentHash: "b".repeat(64),
      },
    ],
    writeDirection: "WRITE_CONFIRMED" as const,
    operationClass: "PLATFORM_TRANSFER" as const,
    dataPathRole: "PRODUCER" as const,
  };
}

const index = {
  schemaVersion: "1.1.0",
  artifactType: "TABLE_PRODUCER_INDEX",
  generatedAt: "2026-08-25T00:00:00.000Z",
  buildStatus: "SUCCESS",
  coverageSemantics: "OBSERVED_EVIDENCE_ONLY",
  inputFingerprint: "c".repeat(64),
  confirmedProducerEdges: [
    {
      taskId: "207229",
      taskCategory: "sparkIndex",
      taskContentHash: "a".repeat(64),
      table: { ...table, identityStatus: "RESOLVED" as const },
      writes: [
        write([
          {
            field: "src_tbl",
            expression: "*",
            valueStatus: "OBSERVED_RENDERED_VALUE",
            observedValue: "*",
          },
          {
            field: "busi_date",
            expression: "${YYYY-MM-DD}",
            valueStatus: "RUNTIME_EXPRESSION",
            observedValue: null,
          },
        ]),
      ],
    },
  ],
  nonConfirmedRelations: [],
  intermediateMaterializations: [],
  counts: {
    taskPacksDiscovered: 1,
    taskPacksIndexed: 1,
    invalidTaskPacks: 0,
    tablePacksDiscovered: 1,
    tablePacksIndexed: 1,
    invalidTablePacks: 0,
    confirmedTables: 1,
    confirmedProducerEdges: 1,
    confirmedWriteObservations: 1,
    candidateObservations: 0,
    intermediateMaterializations: 0,
  },
  issues: [],
  boundaries: {
    openCli: "NOT_USED",
    partitionScope: "TASK_TO_TABLE_WRITE",
    schedulerExecution: "NOT_EVALUATED",
    runtimeDelivery: "NOT_EVALUATED",
    businessCorrectness: "NOT_EVALUATED",
  },
  contentHash: "d".repeat(64),
} as unknown as TableProducerIndex;

describe("producer-index-query", () => {
  it("does not infer a direct partition constraint through a function", () => {
    const column = {
      name: "busi_date",
      clause: "where" as const,
      physical: [{ table: "src.partitioned", column: "busi_date" }],
    };
    const result = resolveReadPartitionScope({
      tableQualifiedName: "src.partitioned",
      partitionFields: ["busi_date"],
      predicate: {
        kind: "ATOM",
        operator: "EQ",
        operands: [
          {
            kind: "OTHER",
            expression: "date(busi_date)",
            inputColumns: [column],
          },
          {
            kind: "LITERAL",
            expression: "'2026-08-23'",
            observedValue: "2026-08-23",
          },
        ],
        span: { start: 0, end: 20 },
      },
    });
    expect(result.status).toBe("UNKNOWN");
    expect(result.reasonCodes).toContain(
      "PARTITION_COLUMN_PHYSICAL_ORIGIN_UNRESOLVED",
    );
  });

  it("recognizes a year-to-date busi_date range on a composite partition", () => {
    const column = {
      name: "busi_date",
      clause: "where" as const,
      physical: [{ table: "src.partitioned", column: "busi_date" }],
    };
    const result = resolveReadPartitionScope({
      tableQualifiedName: "src.partitioned",
      partitionFields: ["busi_date", "grp_id"],
      predicate: {
        kind: "ATOM",
        operator: "BETWEEN",
        operands: [
          { kind: "COLUMN", expression: "busi_date", column },
          {
            kind: "OTHER",
            expression: "concat(substr('${YYYY-MM-DD}',1,5),'01-01')",
            inputColumns: [],
          },
          {
            kind: "LITERAL",
            expression: "'${YYYY-MM-DD}'",
            observedValue: "${YYYY-MM-DD}",
          },
        ],
        span: { start: 0, end: 70 },
      },
    });

    expect(result.status).toBe("PARTIAL");
    expect(result.predicate).toMatchObject({
      kind: "ATOM",
      field: "busi_date",
      operator: "BETWEEN",
      values: [
        { kind: "RUNTIME_EXPRESSION" },
        { kind: "RUNTIME_EXPRESSION" },
      ],
    });
    expect(
      matchProducersByReadScope(index, table, result)[0]?.status,
    ).toBe("POSSIBLE_OVERLAP");
  });

  function scope(
    observedValue: string,
    operator: "EQ" | "IN" = "EQ",
  ): ReadPartitionScope {
    return {
      status: "CONSTRAINED",
      partitionFields: ["busi_date"],
      predicate: {
        kind: "ATOM",
        field: "busi_date",
        operator,
        values: [
          {
            kind: "LITERAL",
            expression: `'${observedValue}'`,
            observedValue,
          },
        ],
      },
      reasonCodes: [],
      evidence: [],
    };
  }

  it("distinguishes proven, possible, and disjoint partition matches", () => {
    const exactIndex = {
      ...index,
      confirmedProducerEdges: [
        {
          ...index.confirmedProducerEdges[0]!,
          writes: [
            write([
              {
                field: "busi_date",
                expression: "'2026-05-24'",
                valueStatus: "OBSERVED_RENDERED_VALUE",
                observedValue: "2026-05-24",
              },
            ]),
          ],
        },
      ],
    } as TableProducerIndex;

    expect(
      matchProducersByReadScope(
        exactIndex,
        table,
        scope("2026-05-24"),
      )[0]?.status,
    ).toBe("PROVEN_OVERLAP");
    expect(
      matchProducersByReadScope(
        exactIndex,
        table,
        scope("2026-05-25"),
      )[0]?.status,
    ).toBe("PROVEN_DISJOINT");
    expect(
      matchProducersByReadScope(index, table, scope("2026-05-24"))[0]?.status,
    ).toBe("PROVEN_OVERLAP");
  });

  it("proves equal runtime templates regardless of case", () => {
    const readScope: ReadPartitionScope = {
      status: "CONSTRAINED",
      partitionFields: ["busi_date"],
      predicate: {
        kind: "ATOM",
        field: "busi_date",
        operator: "EQ",
        values: [
          {
            kind: "RUNTIME_EXPRESSION",
            expression: "'${yyyy-MM-dd}'",
            observedValue: null,
          },
        ],
      },
      reasonCodes: [],
      evidence: [],
    };
    const result = matchProducersByReadScope(index, table, readScope)[0];
    expect(result?.status).toBe("PROVEN_OVERLAP");
    expect(result?.reasonCodes).toContain("PARTITION_RUNTIME_TEMPLATE_EQUAL");
  });

  it("looks up confirmed producers and writes by task", () => {
    expect(
      lookupConfirmedProducers(index, table).map((item) => item.taskId),
    ).toEqual(["207229"]);
    expect(lookupProducerWritesByTask(index, "207229")).toMatchObject({
      confirmedWrites: [expect.objectContaining({ taskId: "207229" })],
      nonConfirmedRelations: [],
    });
  });

  it("matches a direct target with a date template and partition wildcard", () => {
    const result = lookupProducersByTablePartition(index, {
      table,
      partition: { src_tbl: "*", busi_date: "2026-05-24" },
    });
    expect(result.map((item) => item.taskId)).toEqual(["207229"]);
  });

  it("matches the same template when the query uses the template", () => {
    const partition: PartitionQuery = {
      src_tbl: "*",
      busi_date: "${YYYY-MM-DD}",
    };
    const result = lookupProducersByTablePartition(index, { table, partition });
    expect(result).toHaveLength(1);
  });

  it("matches all producer writes when only the physical table is provided", () => {
    const result = lookupProducersByTablePartition(index, {
      table: { qualifiedName: table.qualifiedName },
    });
    expect(result.map((item) => item.taskId)).toEqual(["207229"]);
    expect(result[0]?.writes).toHaveLength(1);
  });

  it("returns all physical identities when the table name is shared", () => {
    const firstEdge = index.confirmedProducerEdges[0]!;
    const ambiguous = {
      ...index,
      confirmedProducerEdges: [
        ...index.confirmedProducerEdges,
        {
          ...firstEdge,
          taskId: "other-task",
          table: { ...firstEdge.table, dataSource: "other" },
        },
      ],
    } as TableProducerIndex;
    const result = lookupProducersByTablePartition(ambiguous, {
      table: { qualifiedName: table.qualifiedName },
    });
    expect(result.map((item) => item.taskId)).toEqual(["207229", "other-task"]);
  });

  it("does not match a different physical table or missing partition field", () => {
    expect(
      lookupProducersByTablePartition(index, {
        table: { ...table, dataSource: "other" },
        partition: { src_tbl: "*", busi_date: "2026-05-24" },
      }),
    ).toEqual([]);
    expect(
      lookupProducersByTablePartition(index, {
        table,
        partition: { grp_id: "01" },
      }),
    ).toEqual([]);
  });
});
