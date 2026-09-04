import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { normalizeName } from "../../../scripts/machine-facts/machine-facts-contract.ts";
import { loadCurrentTaskBundle } from "../../../scripts/query/current-task-bundle.ts";
import {
  anchorFromTempTableSource,
  createFieldEvidenceQueryContext,
  fieldEvidenceGoldenRequired,
  fieldEvidenceQueryRoots,
  primaryFinalWrite,
} from "../../../scripts/project-graph/field-evidence-v1/impact-query-harness.ts";
import type { FieldImpactResult } from "../../../scripts/project-graph/field-evidence-v1/impact-result-contract.ts";
import type { TaskLocalProjection } from "../../../scripts/project-graph/task-local/contract.ts";

const FIXTURE_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/field-evidence-v1",
);

const roots = fieldEvidenceQueryRoots();
if (!roots && fieldEvidenceGoldenRequired()) {
  throw new Error("FIELD_EVIDENCE_GOLDEN_REQUIRED but field-facts or INDEX path is missing");
}
const describeGolden = roots ? describe : describe.skip;

function loadExpected(caseId: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(join(FIXTURE_ROOT, caseId, "expected.json"), "utf8"),
  ) as Record<string, unknown>;
}

function valueAtDepth(result: FieldImpactResult, depth: number) {
  return result.value.filter((entry) => entry.depth === depth);
}

function controlsForRelation(result: FieldImpactResult, relationSuffix: string) {
  return result.control.filter((entry) => entry.relationId.includes(relationSuffix));
}

function findOutputAnchor(
  projection: TaskLocalProjection,
  outputColumn: string,
  sourceTableSuffix: string,
): { writeObservationId: string; outputColumn: string } | null {
  const write = primaryFinalWrite(projection);
  if (!write) return null;
  const normalizedSuffix = normalizeName(sourceTableSuffix);
  const hasSource = projection.edges.some((edge) => {
    if (edge.edgeType !== "FIELD_DIRECT" && edge.edgeType !== "FIELD_CONDITIONAL") {
      return false;
    }
    if (String(edge.properties.outputColumn ?? "").toLowerCase() !== outputColumn) {
      return false;
    }
    const from = projection.nodes.find((node) => node.nodeId === edge.fromNodeId);
    const qualifiedName = String(from?.properties.qualifiedName ?? "");
    return normalizeName(qualifiedName).endsWith(normalizedSuffix)
      || normalizeName(qualifiedName).includes(normalizedSuffix);
  });
  if (!hasSource) return null;
  return { writeObservationId: write.writeObservationId, outputColumn };
}

function maxSetopBranchCount(factsRoot: string, taskId: string): number {
  const bundle = loadCurrentTaskBundle(factsRoot, taskId);
  const nodes = bundle.records["relation-nodes.jsonl"] ?? [];
  let maxBranches = 0;
  for (const row of nodes) {
    const relationType = String(row.relation_type ?? "").toLowerCase();
    const body = (row.relation ?? row) as Record<string, unknown>;
    const innerType = String(body.type ?? "").toLowerCase();
    if (relationType !== "setop" && innerType !== "setop") continue;
    const branches = Array.isArray(body.branches) ? body.branches.length : 0;
    if (branches > maxBranches) maxBranches = branches;
  }
  return maxBranches;
}

function assertShadowSetopMaterialization(
  caseId: string,
  context: ReturnType<typeof createFieldEvidenceQueryContext>,
): void {
  const expected = loadExpected(caseId);
  const taskId = String(expected.taskId);
  const projection = context.projectionForTask(taskId);
  expect(maxSetopBranchCount(roots!.factsRoot, taskId)).toBeGreaterThanOrEqual(
    Number(expected.minSetopBranches ?? 2),
  );
  const matGap = projection.gaps?.find(
    (gap) => gap.reasonCode === "TASK_LOCAL_MATERIALIZATION_FIELD_BREAK",
  );
  const tempMarker = String(expected.tempTableMarker ?? "");
  if (matGap) {
    expect(Array.isArray(matGap.details.columns) && matGap.details.columns.length > 0).toBe(true);
    const anchor = anchorFromTempTableSource(projection);
    expect(anchor).not.toBeNull();
    const result = context.runImpactQuery(anchor!);
    expect(result.gaps.some(
      (gap) => gap.reasonCode === "TASK_LOCAL_MATERIALIZATION_FIELD_BREAK",
    )).toBe(true);
    expect(result.gaps.some((gap) =>
      gap.reasonCode === "PRODUCER_NOT_PROJECTED"
      && String(gap.details.physicalDataset ?? "").includes(tempMarker),
    )).toBe(false);
    return;
  }

  // Facts may omit task-local-materializations; still require shadow setop + projected temp sources.
  const tempEdges = projection.edges.filter((edge) => {
    if (edge.edgeType !== "FIELD_DIRECT" && edge.edgeType !== "FIELD_CONDITIONAL") {
      return false;
    }
    const from = projection.nodes.find((node) => node.nodeId === edge.fromNodeId);
    const qualifiedName = normalizeName(String(from?.properties.qualifiedName ?? ""));
    return tempMarker.length > 0
      ? qualifiedName.includes(normalizeName(tempMarker))
      : qualifiedName.includes("temp.");
  });
  expect(tempEdges.length).toBeGreaterThan(0);
  const write = primaryFinalWrite(projection);
  expect(write).not.toBeNull();
  const result = context.runImpactQuery({
    taskId: projection.taskId,
    writeObservationId: write!.writeObservationId,
    outputColumn: String(tempEdges[0]!.properties.outputColumn ?? ""),
  });
  expect(result.gaps.some((gap) =>
    gap.reasonCode === "PRODUCER_NOT_PROJECTED"
    && String(gap.details.physicalDataset ?? "").includes(tempMarker),
  )).toBe(false);
}

describeGolden("field-evidence-v1 impact query goldens", () => {
  const context = createFieldEvidenceQueryContext(roots!);

  it("case A: pric identity with setop-disjoint b0 controls", () => {
    const expected = loadExpected("a");
    const projection = context.projectionForTask(String(expected.taskId));
    const anchor = findOutputAnchor(
      projection,
      String(expected.outputColumn),
      String(expected.sourceTableSuffix),
    );
    expect(anchor).not.toBeNull();
    const result = context.runImpactQuery({
      taskId: projection.taskId,
      writeObservationId: anchor!.writeObservationId,
      outputColumn: anchor!.outputColumn,
    });
    const depthZero = valueAtDepth(result, 0);
    const b1Values = depthZero.filter((entry) =>
      entry.source.qualifiedName.includes(String(expected.sourceTableSuffix))
      && entry.sourceRelationId?.includes("setop.b1"),
    );
    expect(b1Values.length).toBeGreaterThan(0);
    expect(b1Values.some((entry) => entry.subtype === "IDENTITY")).toBe(true);
    expect(depthZero.every((entry) => entry.sourceReadOccurrenceStatus === "RESOLVED")).toBe(true);
    const b1RelationIds = new Set(
      b1Values.map((entry) => entry.sourceRelationId).filter(Boolean),
    );
    const b0Controls = result.control.filter((entry) =>
      String(expected.b0RelationMarker ?? "").length > 0
      && entry.relationId.includes(String(expected.b0RelationMarker))
      && entry.valueSourceRelationId != null
      && b1RelationIds.has(entry.valueSourceRelationId),
    );
    expect(b0Controls.length).toBeGreaterThan(0);
    expect(b0Controls.some((entry) => entry.scope === "SCOPE_DISJOINT")).toBe(true);
    expect(b0Controls.filter((entry) => entry.subtype === "FILTER").some(
      (entry) => entry.scope === "SCOPE_DISJOINT",
    )).toBe(true);
    const innerControls = result.control.filter((entry) =>
      entry.joinType === "INNER"
      && entry.relationId.includes("setop.b1")
      && entry.valueSourceRelationId != null
      && b1RelationIds.has(entry.valueSourceRelationId),
    );
    expect(innerControls.every((entry) => entry.scope === "DATASET_SCOPED")).toBe(true);
  }, 300_000);

  it("case B: gamma cross-branch fan-in", () => {
    const expected = loadExpected("b");
    const projection = context.projectionForTask(String(expected.taskId));
    const write = primaryFinalWrite(projection)!;
    const result = context.runImpactQuery({
      taskId: projection.taskId,
      writeObservationId: write.writeObservationId,
      outputColumn: String(expected.outputColumn),
    });
    const relationIds = new Set(
      valueAtDepth(result, 0).map((entry) => entry.sourceRelationId).filter(Boolean),
    );
    expect(relationIds.size).toBeGreaterThanOrEqual(Number(expected.minDistinctSourceRelations ?? 2));
    const dateColumns = (expected.dateColumns as string[] | undefined) ?? [];
    for (const dateColumn of dateColumns) {
      const identityHits = result.value.filter((entry) =>
        entry.depth === 0
        && entry.source.column === dateColumn
        && entry.subtype === "IDENTITY",
      );
      expect(identityHits).toHaveLength(0);
    }
    const conditionalDateHits = result.value.filter((entry) =>
      entry.depth === 0
      && ["erly_trmt_date", "end_prcg_date", "trgr_date", "trgr_line_date", "src_busi_date"].includes(entry.source.column)
      && entry.subtype === "IDENTITY",
    );
    expect(conditionalDateHits.length).toBeLessThan(
      result.value.filter((entry) => entry.depth === 0).length,
    );
    const viewGamma = result.value.filter((entry) =>
      entry.source.qualifiedName.includes(String(expected.viewTableMarker ?? ""))
      && entry.source.column === "gamma",
    );
    expect(viewGamma.some((entry) =>
      entry.subtype === "IDENTITY" || entry.subtype === "TRANSFORMATION",
    )).toBe(true);
    if (expected.expectConfirmedDepthOne) {
      expect(result.value.some((entry) =>
        entry.depth === 1 && entry.evidenceStatus === "CONFIRMED",
      )).toBe(true);
    } else {
      const hasDepthOne = result.value.some((entry) => entry.depth === 1);
      const hasFrontier = result.frontier.length > 0;
      expect(hasDepthOne || hasFrontier || result.value.length > 0).toBe(true);
    }
  }, 300_000);

  it("case C: same join, different scopes for gamma_pct vs nom", () => {
    const expected = loadExpected("c");
    const projection = context.projectionForTask(String(expected.taskId));
    const write = primaryFinalWrite(projection)!;
    const joinMarker = String(expected.joinRelationMarker);
    const gammaResult = context.runImpactQuery({
      taskId: projection.taskId,
      writeObservationId: write.writeObservationId,
      outputColumn: String(expected.nullableSideColumn),
    });
    const nomResult = context.runImpactQuery({
      taskId: projection.taskId,
      writeObservationId: write.writeObservationId,
      outputColumn: String(expected.preservedSideColumn),
    });
    const gammaJoinControls = controlsForRelation(gammaResult, joinMarker).filter(
      (entry) => entry.joinType === "LEFT" && entry.valueSourceRelationId != null,
    );
    const nomJoinControls = controlsForRelation(nomResult, joinMarker).filter(
      (entry) => entry.joinType === "LEFT" && entry.valueSourceRelationId != null,
    );
    expect(gammaJoinControls.some((entry) => entry.scope === "FIELD_SCOPED")).toBe(true);
    expect(nomJoinControls.some((entry) => entry.scope === "DATASET_SCOPED")).toBe(true);
    expect(nomJoinControls.some((entry) => entry.grain === "EXPAND_RISK")).toBe(true);
  }, 300_000);

  it("case D: vola hop confirms unique overlapping Horae parent", () => {
    const expected = loadExpected("d");
    const projection = context.projectionForTask(String(expected.taskId));
    const anchor = findOutputAnchor(
      projection,
      String(expected.outputColumn),
      String(expected.sourceTableSuffix),
    );
    expect(anchor).not.toBeNull();
    const result = context.runImpactQuery({
      taskId: projection.taskId,
      writeObservationId: anchor!.writeObservationId,
      outputColumn: anchor!.outputColumn,
    });
    expect(result.value.every((entry) =>
      !(entry.depth >= 1 && entry.source.column === String(expected.outputColumn)),
    )).toBe(true);
    const scheduleStatus = context.scheduleRelationLookup.statusFor(projection.taskId);
    if (scheduleStatus === "AVAILABLE") {
      expect(result.value.some((entry) =>
        entry.depth === 1
        && entry.evidenceStatus === "CONFIRMED"
        && entry.taskId === "121574",
      )).toBe(true);
      expect(result.frontier.every((entry) => entry.candidates.length <= 1)).toBe(true);
    } else if (fieldEvidenceGoldenRequired()) {
      throw new Error(
        "FIELD_EVIDENCE_GOLDEN_REQUIRED but Horae schedule cache is unavailable for case D",
      );
    } else {
      expect(result.frontier.some((entry) =>
        entry.reasonCode === "MULTI_WRITER_CANDIDATE_FRONTIER",
      )).toBe(true);
      const frontier = result.frontier.find((entry) =>
        entry.reasonCode === "MULTI_WRITER_CANDIDATE_FRONTIER",
      );
      expect(frontier!.candidates.every((candidate) =>
        candidate.scheduleRelation === "HORAE_UNAVAILABLE",
      )).toBe(true);
    }
  }, 300_000);

  it("case E: materialization gap passthrough without fake producer gap", () => {
    const expected = loadExpected("e");
    const projection = context.projectionForTask(String(expected.taskId));
    const columns = projection.gaps?.find(
      (gap) => gap.reasonCode === "TASK_LOCAL_MATERIALIZATION_FIELD_BREAK",
    )?.details.columns;
    expect(Array.isArray(columns) && columns.length > 0).toBe(true);
    const anchor = anchorFromTempTableSource(projection);
    expect(anchor).not.toBeNull();
    const result = context.runImpactQuery(anchor!);
    const materializationGaps = result.gaps.filter(
      (gap) => gap.reasonCode === "TASK_LOCAL_MATERIALIZATION_FIELD_BREAK",
    );
    expect(materializationGaps.length).toBeGreaterThan(0);
    expect(materializationGaps[0]!.details.columns).toBeTruthy();
    expect(result.gaps.some((gap) =>
      gap.reasonCode === "PRODUCER_NOT_PROJECTED"
      && String(gap.details.physicalDataset ?? "").includes(String(expected.tempTableMarker ?? "")),
    )).toBe(false);
  }, 300_000);

  it("case F: shadow setop + materialization (77078)", () => {
    assertShadowSetopMaterialization("f", context);
  }, 300_000);

  it("case G: shadow setop + materialization (104298)", () => {
    assertShadowSetopMaterialization("g", context);
  }, 300_000);
});
