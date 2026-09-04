import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { openWriterCatalog, writerCatalogPort } from "../../../../scripts/query/writer-catalog.ts";
import { applyPartitionRematch } from "../../../../scripts/project-graph/field-evidence-v1/continuation/rules/partition-rematch.ts";
import { continuationCandidateFromIndex } from "../../../../scripts/project-graph/field-evidence-v1/continuation/types.ts";
import type { UnionContinuationIndexCandidate } from "../../../../scripts/reconcile/consumer/target-table-upstream-causal-closure/union-continuation-candidate-source.ts";

function indexCandidate(
  overrides: Partial<UnionContinuationIndexCandidate> = {},
): UnionContinuationIndexCandidate {
  return {
    taskId: "producer-a",
    writeObservationId: "write-observation:producer-a:0",
    targetWriteNodeId: "target-write:producer-a:0",
    datasetNodeId: "dataset:example",
    qualifiedName: "pdata.example_table",
    source: "IN_UNION_FINAL_WRITE",
    partitionMatchStatus: "UNKNOWN",
    partition: [],
    evidenceLayer: "L2",
    l1Eligible: false,
    ...overrides,
  };
}

describe("partition-rematch rule", () => {
  it("keeps candidates unchanged when writer catalog has no partition evidence", () => {
    const catalogPath = mkdtempSync(join(tmpdir(), "writer-catalog-rematch-"));
    const catalog = writerCatalogPort(openWriterCatalog(join(catalogPath, "catalog.sqlite")));
    const table = {
      platform: "pdata",
      dataSource: "default",
      qualifiedName: "example_table",
    };
    const readScope = {
      status: "CONSTRAINED" as const,
      partitionFields: ["busi_date"],
      predicate: {
        kind: "ATOM" as const,
        field: "busi_date",
        operator: "EQ" as const,
        values: [{
          kind: "RUNTIME_EXPRESSION" as const,
          expression: "${busi_date}",
          observedValue: null,
        }],
      },
      reasonCodes: [],
      evidence: [],
    };

    const result = applyPartitionRematch({
      consumerTaskId: "consumer-1",
      readOccurrenceId: "read:consumer-1:0",
      column: "amount",
      qualifiedName: "pdata.example_table",
      candidates: [continuationCandidateFromIndex(indexCandidate())],
      ports: {
        scheduleLookup: null,
        writerCatalog: catalog,
        readScopeFor: () => ({ kind: "OK", scope: readScope }),
        tableIdentityFor: () => table,
        taskCategoryFor: () => "sparkIndex",
      },
    });

    expect(result.gaps).toEqual([]);
    expect(result.candidates[0]?.partitionOverlap).toBe("UNKNOWN");
  });

  it("skips rematch without crashing when writer catalog is missing", () => {
    const result = applyPartitionRematch({
      consumerTaskId: "consumer-1",
      readOccurrenceId: "read:consumer-1:0",
      column: "amount",
      qualifiedName: "pdata.example_table",
      candidates: [continuationCandidateFromIndex(indexCandidate())],
      ports: {
        scheduleLookup: null,
        writerCatalog: null,
        readScopeFor: () => ({ kind: "UNAVAILABLE", reasonCode: "READ_SCOPE_UNAVAILABLE" }),
        tableIdentityFor: ({ qualifiedName }) => ({
          platform: "pdata",
          dataSource: "default",
          qualifiedName,
        }),
        taskCategoryFor: () => "sparkIndex",
      },
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.gaps.some((gap) => gap.reasonCode === "WRITER_CATALOG_UNAVAILABLE")).toBe(true);
  });

  it("surfaces SOURCE_ENDPOINT_BOUNDARY instead of inventing a hive read scope", () => {
    const catalogPath = mkdtempSync(join(tmpdir(), "writer-catalog-rematch-"));
    const catalog = writerCatalogPort(openWriterCatalog(join(catalogPath, "catalog.sqlite")));
    const result = applyPartitionRematch({
      consumerTaskId: "consumer-1",
      readOccurrenceId: "read:consumer-1:0",
      column: "amount",
      qualifiedName: "source_schema.example_table",
      candidates: [continuationCandidateFromIndex(indexCandidate())],
      ports: {
        scheduleLookup: null,
        writerCatalog: catalog,
        readScopeFor: () => ({ kind: "UNAVAILABLE", reasonCode: "SOURCE_ENDPOINT_BOUNDARY" }),
        tableIdentityFor: ({ qualifiedName }) => ({
          platform: "unknown",
          dataSource: "unknown",
          qualifiedName,
        }),
        taskCategoryFor: () => "oracle2hive",
      },
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.partitionOverlap).toBe("UNKNOWN");
    expect(result.gaps.map((gap) => gap.reasonCode)).toEqual(["SOURCE_ENDPOINT_BOUNDARY"]);
  });
});
