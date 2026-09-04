import { existsSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  validateTaskLocalProjection,
  type TaskLocalEdge,
  type TaskLocalProjection,
} from "../../../scripts/project-graph/task-local/contract.ts";
import { projectTaskLocal } from "../../../scripts/project-graph/task-local/project-task-local.ts";
import {
  FIELD_EVIDENCE_ANCHOR_TASK_IDS,
  FIELD_EVIDENCE_BASELINE_PATH,
  fieldEvidenceGoldenRoots,
} from "./golden-roots.ts";

const roots = fieldEvidenceGoldenRoots();
const describeGolden = roots ? describe : describe.skip;

function nodeById(projection: TaskLocalProjection): Map<string, (typeof projection.nodes)[number]> {
  return new Map(projection.nodes.map((node) => [node.nodeId, node]));
}

function fieldEdges(projection: TaskLocalProjection): TaskLocalEdge[] {
  return projection.edges.filter(
    (edge) => edge.edgeType === "FIELD_DIRECT" || edge.edgeType === "FIELD_CONDITIONAL",
  );
}

function readOccurrenceGapKeys(projection: TaskLocalProjection): Set<string> {
  const keys = new Set<string>();
  for (const gap of projection.gaps ?? []) {
    if (
      gap.reasonCode !== "FIELD_SOURCE_READ_OCCURRENCE_AMBIGUOUS"
      && gap.reasonCode !== "FIELD_SOURCE_READ_OCCURRENCE_UNRESOLVED"
    ) {
      continue;
    }
    const details = gap.details;
    keys.add(
      [
        String(details.expressionId ?? ""),
        String(details.sourceTable ?? ""),
        String(details.sourceColumn ?? ""),
        String(details.sourceReadOccurrenceStatus ?? ""),
        String(details.reasonCode ?? ""),
      ].join("\u0000"),
    );
  }
  return keys;
}

function nonResolvedEdgesMissingGap(projection: TaskLocalProjection): string[] {
  const gaps = readOccurrenceGapKeys(projection);
  const nodes = nodeById(projection);
  const missing: string[] = [];
  for (const edge of fieldEdges(projection)) {
    const status = edge.properties.sourceReadOccurrenceStatus;
    if (status !== "AMBIGUOUS" && status !== "UNRESOLVED") continue;
    const from = nodes.get(edge.fromNodeId);
    const key = [
      String(edge.properties.expressionId ?? ""),
      String(from?.properties.qualifiedName ?? ""),
      String(from?.properties.column ?? ""),
      String(status ?? ""),
      String(edge.properties.sourceReadOccurrenceReason ?? ""),
    ].join("\u0000");
    if (!gaps.has(key)) {
      missing.push(
        `${edge.edgeType}:${edge.properties.expressionId}:${from?.properties.qualifiedName}.${from?.properties.column}`,
      );
    }
  }
  return missing;
}

function resolvedDirectRatio(projection: TaskLocalProjection): number {
  const direct = projection.edges.filter((edge) => edge.edgeType === "FIELD_DIRECT");
  if (direct.length === 0) return 0;
  const resolved = direct.filter(
    (edge) => edge.properties.sourceReadOccurrenceStatus === "RESOLVED",
  ).length;
  return resolved / direct.length;
}

describeGolden("field-evidence-v1 phase1 acceptance", () => {
  for (const taskId of FIELD_EVIDENCE_ANCHOR_TASK_IDS) {
    it(`validates ${taskId} task-local projection (1.3.0 contract)`, () => {
      const projection = projectTaskLocal({
        factsRoot: roots!.factsRoot,
        dataRoot: roots!.dataRoot,
        taskId,
      });
      expect(projection.schemaVersion).toBe("1.3.0");
      expect(projection.coverageStatus).toBe("PROJECTED");
      validateTaskLocalProjection(projection);
    }, 180_000);

    it(`maps every non-RESOLVED field edge on ${taskId} to a read-occurrence gap`, () => {
      const projection = projectTaskLocal({
        factsRoot: roots!.factsRoot,
        dataRoot: roots!.dataRoot,
        taskId,
      });
      expect(nonResolvedEdgesMissingGap(projection)).toEqual([]);
    }, 180_000);

    it(`requires subtypeReason on UNKNOWN field edges for ${taskId}`, () => {
      const projection = projectTaskLocal({
        factsRoot: roots!.factsRoot,
        dataRoot: roots!.dataRoot,
        taskId,
      });
      const unknownWithoutReason = fieldEdges(projection).filter(
        (edge) => edge.properties.subtype === "UNKNOWN" && !edge.properties.subtypeReason,
      );
      expect(unknownWithoutReason).toEqual([]);
    }, 180_000);
  }

  it("181058 resolved-direct ratio exceeds pre-field-evidence reference", () => {
    const projection = projectTaskLocal({
      factsRoot: roots!.factsRoot,
      dataRoot: roots!.dataRoot,
      taskId: "181058",
    });
    expect(resolvedDirectRatio(projection)).toBeGreaterThan(0.1156);
    expect(resolvedDirectRatio(projection)).toBeGreaterThan(0.5);
  }, 180_000);

  it("176827 JOIN control edges carry joinType; BOTH sides emit control-side gaps", () => {
    const projection = projectTaskLocal({
      factsRoot: roots!.factsRoot,
      dataRoot: roots!.dataRoot,
      taskId: "176827",
    });
    const joinControls = projection.edges.filter(
      (edge) => edge.edgeType === "DATASET_CONTROL" && edge.properties.subtype === "JOIN",
    );
    expect(joinControls.length).toBeGreaterThan(0);
    expect(joinControls.every((edge) => edge.properties.joinType && edge.properties.joinType !== "N/A"))
      .toBe(true);
    const bothControls = joinControls.filter((edge) => edge.properties.controlSide === "BOTH");
    const controlSideGaps = (projection.gaps ?? []).filter(
      (gap) => gap.reasonCode === "CONTROL_SIDE_UNRESOLVED",
    );
    expect(controlSideGaps.length).toBeGreaterThanOrEqual(bothControls.length);
  }, 180_000);
});

describe("field-evidence-v1 phase1 baseline artifact", () => {
  const describeBaseline = existsSync(FIELD_EVIDENCE_BASELINE_PATH) ? describe : describe.skip;

  describeBaseline("phase1-baseline.json", () => {
    it("records anchor task ratios and reference lines for §5.5 audit", () => {
      const baseline = JSON.parse(readFileSync(FIELD_EVIDENCE_BASELINE_PATH, "utf8")) as {
        anchorTaskRatios?: Record<string, { resolvedDirectRatio: number }>;
        referenceLines?: {
          anchorTaskRatiosPreFieldEvidence?: Record<string, number>;
          criterion1Note?: string;
        };
        cohorts?: {
          anchorExpansionBatch?: { resolvedDirectRatio: number };
          shadowEvaluationSlice?: { resolvedDirectRatio: number };
        };
      };
      expect(baseline.anchorTaskRatios?.["181058"]?.resolvedDirectRatio).toBeGreaterThan(0.8);
      expect(baseline.referenceLines?.anchorTaskRatiosPreFieldEvidence?.["181058"]).toBe(0.1156);
      expect(baseline.cohorts?.anchorExpansionBatch?.resolvedDirectRatio).toBeGreaterThan(0.5);
      expect(baseline.cohorts?.shadowEvaluationSlice?.resolvedDirectRatio).toBeGreaterThan(0.4);
      expect(baseline.referenceLines?.criterion1Note).toMatch(/1\.2\.0/);
    });
  });
});
