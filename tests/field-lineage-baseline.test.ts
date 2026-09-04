import { readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { runInputPackMachineFacts } from "../scripts/machine-facts/input-pack-machine-facts.ts";
import { reconcileFieldLineage } from "../scripts/reconcile/consumer/field-lineage/field-lineage.ts";
import { formatFieldLineageSummary } from "../scripts/reconcile/consumer/field-lineage/format-field-lineage.ts";
import { visualizeFieldLineage } from "../scripts/visualize/field-lineage-visualize.ts";
import {
  createDefaultHiveSchemaFixture,
  createSelfJoinFixture,
  createValueAndRowsetFixture,
  readRelationOccurrence,
  valueAndRowsetTableLineage,
} from "./fixtures/field-lineage/baseline/metadata.ts";

const BASELINE_ROOT = resolve("tests/fixtures/field-lineage/baseline");

function json<T>(name: string): T {
  return JSON.parse(readFileSync(join(BASELINE_ROOT, name), "utf8")) as T;
}

function roots(name: string): { readonly dataRoot: string; readonly factsRoot: string } {
  const parent = mkdtempSync(join(tmpdir(), `field-lineage-baseline-${name}-`));
  return { dataRoot: join(parent, "data"), factsRoot: join(parent, "facts") };
}

describe("field-lineage 1.2 baseline", () => {
  it("freezes current VALUE_FLOW and DATASET_CONTROL behavior", () => {
    const fixture = roots("value-rowset");
    createValueAndRowsetFixture(fixture.dataRoot);
    runInputPackMachineFacts({
      dataRoot: fixture.dataRoot,
      taskIds: ["100", "200", "300", "400"],
      outputRoot: fixture.factsRoot,
    });

    const artifact = reconcileFieldLineage({
      dataRoot: fixture.dataRoot,
      factsRoot: fixture.factsRoot,
      tableLineage: valueAndRowsetTableLineage(fixture.factsRoot),
      rootTaskId: "100",
      rootTable: "demo.root",
      rootFields: ["out_a"],
      factsPolicy: "allow-legacy-partial",
      maxDepth: 8,
      maxStates: 100,
      maxPaths: 100,
    });

    expect(artifact.overallStatus).toBe("PARTIAL");
    expect(artifact.edges.every((edge) => edge.kind === "VALUE_FLOW")).toBe(true);
    expect(artifact.edges.some((edge) => edge.producerTaskId === "200")).toBe(true);
    expect(artifact.edges.some((edge) => edge.producerTaskId === "300")).toBe(true);
    expect(artifact.edges.some((edge) => edge.producerTaskId === "400")).toBe(false);
    expect(
      artifact.candidates.some(
        (candidate) => candidate.producerTaskId === "400",
      ),
    ).toBe(true);
    expect(
      artifact.datasetControls.some((control) => control.subtype === "FILTER"),
    ).toBe(true);
    expect(
      artifact.datasetControls.every(
        (control) =>
          control.grain === "PRESERVE" ||
          (typeof control.grainReason === "string" && control.grainReason.length > 0),
      ),
    ).toBe(true);
    expect(
      artifact.datasetControls.some(
        (control) =>
          control.subtype === "FILTER" &&
          control.grainReason === "GRAIN_FILTER_MAY_DROP_ROWS",
      ),
    ).toBe(true);
    expect(
      artifact.gaps.some(
        (gap) =>
          gap.taskId === "500" && gap.reasonCode === "TASK_INPUT_PACK_EXCLUDED",
      ),
    ).toBe(true);
    expect(artifact.gaps.some((gap) => gap.reasonCode === "CYCLE")).toBe(true);
    expect(formatFieldLineageSummary(artifact)).toContain("DATASET_CONTROL");
    expect(formatFieldLineageSummary(artifact)).not.toContain("ROWSET_CONTROL");
  });

  it("freezes Task default-Hive-schema resolution for value and rowset inputs", () => {
    const fixture = roots("default-hive");
    createDefaultHiveSchemaFixture(fixture.dataRoot);
    runInputPackMachineFacts({
      dataRoot: fixture.dataRoot,
      taskIds: ["110"],
      outputRoot: fixture.factsRoot,
    });

    const artifact = reconcileFieldLineage({
      dataRoot: fixture.dataRoot,
      factsRoot: fixture.factsRoot,
      tableLineage: {
        rootTaskId: "110",
        taskNodes: [
          {
            taskId: "110",
            upstreamDecision: { primary: [], additional: [], unknown: [] },
          },
        ],
        producerBridges: [],
      },
      rootTaskId: "110",
      rootTable: "hive_db.root",
      rootFields: ["out_a"],
      factsPolicy: "current-only",
      maxDepth: 8,
      maxStates: 100,
      maxPaths: 100,
    });

    expect(
      artifact.nodes.some(
        (node) =>
          node.taskId === "110" &&
          node.field.qualifiedName === "hive_db.root" &&
          node.field.column === "out_a",
      ),
    ).toBe(true);
    expect(
      artifact.gaps.some(
        (gap) => gap.reasonCode === "SOURCE_FIELD_SCHEMA_UNVERIFIED",
      ),
    ).toBe(true);
    expect(
      artifact.datasetControls.some(
        (control) =>
          control.subtype === "FILTER" &&
          control.field === null &&
          control.reasonCode === "ROWSET_FIELD_IDENTITY_UNRESOLVED",
      ),
    ).toBe(true);
    expect(
      artifact.gaps.some((gap) =>
        [
          "SOURCE_TABLE_PACK_MISSING",
          "SOURCE_TABLE_IDENTITY_AMBIGUOUS",
          "SOURCE_FIELD_NOT_IN_SCHEMA",
        ].includes(gap.reasonCode),
      ),
    ).toBe(false);
  });

  it("freezes self-join occurrence isolation for bridges and value paths", () => {
    const fixture = roots("self-join");
    createSelfJoinFixture(fixture.dataRoot);
    runInputPackMachineFacts({
      dataRoot: fixture.dataRoot,
      taskIds: ["120", "121", "122"],
      outputRoot: fixture.factsRoot,
    });

    const artifact = reconcileFieldLineage({
      dataRoot: fixture.dataRoot,
      factsRoot: fixture.factsRoot,
      tableLineage: {
        rootTaskId: "120",
        taskNodes: [
          {
            taskId: "120",
            upstreamDecision: {
              primary: ["121", "122"],
              additional: [],
              unknown: [],
            },
          },
          {
            taskId: "121",
            upstreamDecision: { primary: [], additional: [], unknown: [] },
          },
          {
            taskId: "122",
            upstreamDecision: { primary: [], additional: [], unknown: [] },
          },
        ],
        producerBridges: [
          {
            consumerTaskId: "120",
            producerTaskId: "121",
            producerRole: "PRIMARY",
            table: {
              platform: "hive",
              dataSource: "warehouse",
              qualifiedName: "demo.same",
            },
            readOccurrence: readRelationOccurrence(fixture.factsRoot, "l"),
          },
          {
            consumerTaskId: "120",
            producerTaskId: "122",
            producerRole: "PRIMARY",
            table: {
              platform: "hive",
              dataSource: "warehouse",
              qualifiedName: "demo.same",
            },
            readOccurrence: readRelationOccurrence(fixture.factsRoot, "r"),
          },
        ],
      },
      rootTaskId: "120",
      rootTable: "demo.root",
      rootFields: ["left_amount", "right_amount"],
      factsPolicy: "current-only",
      maxDepth: 4,
      maxStates: 100,
      maxPaths: 100,
    });

    const producerIdsFor = (rootColumn: string): string[] => {
      const pending = artifact.nodes
        .filter(
          (node) => node.taskId === "120" && node.field.column === rootColumn,
        )
        .map((node) => node.nodeId);
      const seen = new Set<string>();
      const producerIds = new Set<string>();
      while (pending.length > 0) {
        const nodeId = pending.pop()!;
        if (seen.has(nodeId)) continue;
        seen.add(nodeId);
        for (const edge of artifact.edges) {
          if (edge.toNodeId !== nodeId) continue;
          if (edge.producerTaskId) producerIds.add(edge.producerTaskId);
          pending.push(edge.fromNodeId);
        }
      }
      return [...producerIds].sort();
    };

    expect(producerIdsFor("left_amount")).toContain("121");
    expect(producerIdsFor("left_amount")).not.toContain("122");
    expect(producerIdsFor("right_amount")).toContain("122");
    expect(producerIdsFor("right_amount")).not.toContain("121");
    const joinReasons = new Set(
      artifact.datasetControls
        .filter((control) => control.subtype === "JOIN")
        .map((control) => control.grainReason),
    );
    expect(joinReasons.has("GRAIN_JOIN_CARDINALITY_UNPROVEN")).toBe(true);
    expect(joinReasons.has("GRAIN_JOIN_NULLABLE_SIDE_MAY_EXPAND")).toBe(false);
    expect(
      artifact.datasetControls.every(
        (control) =>
          control.grain === "PRESERVE" ||
          (typeof control.grainReason === "string" && control.grainReason.length > 0),
      ),
    ).toBe(true);
    expect(
      artifact.gaps.some(
        (gap) => gap.reasonCode === "READ_OCCURRENCE_FIELD_BINDING_UNKNOWN",
      ),
    ).toBe(false);
  });

  it("keeps the legacy field artifact readable by the HTML consumer", () => {
    const fixture = roots("legacy");
    const artifactPath = join(BASELINE_ROOT, "legacy-field-lineage.json");
    const outputPath = join(fixture.dataRoot, "legacy-field-lineage.html");

    expect(() =>
      visualizeFieldLineage({ artifactPath, outputPath }),
    ).not.toThrow();
    const html = readFileSync(outputPath, "utf8");
    expect(html).toContain("Field lineage legacy-root");
    expect(html).toContain("legacy-source");
    expect(html).toContain("legacy-root");
    expect(html).toContain("demo.source");
  });

  it("records the 209119 immutable-input reuse contract without claiming field-only support", () => {
    const fixture = json<{
      readonly taskId: string;
      readonly sourceArtifactPolicy: string;
      readonly expected: {
        readonly reusedLayers: readonly string[];
        readonly recomputedLayers: readonly string[];
        readonly fullTaskCollection: boolean;
        readonly fullProducerIndexRebuild: boolean;
      };
      readonly fieldOnlyCliStatus: string;
      readonly blocker: string;
    }>("209119-field-only.json");

    expect(fixture.taskId).toBe("209119");
    expect(fixture.sourceArtifactPolicy).toBe("reuse-only");
    expect(fixture.expected.reusedLayers).toEqual([
      "input-pack",
      "machine-facts",
      "producer-index",
      "table-multi-hop-artifact",
    ]);
    expect(fixture.expected.recomputedLayers).toEqual([
      "field-lineage",
      "summary",
      "html",
    ]);
    expect(fixture.expected.fullTaskCollection).toBe(false);
    expect(fixture.expected.fullProducerIndexRebuild).toBe(false);
    expect(fixture.fieldOnlyCliStatus).toBe("PENDING");
    expect(fixture.blocker).toContain("no field-only CLI");
  });

  it.todo(
    "PENDING: add a field-only CLI contract test for Task 209119 once that CLI exists",
  );
});
