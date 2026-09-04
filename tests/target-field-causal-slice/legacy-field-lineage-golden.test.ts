import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { runInputPackMachineFacts } from "../../scripts/machine-facts/input-pack-machine-facts.ts";
import { reconcileFieldLineage } from "../../scripts/reconcile/consumer/field-lineage/field-lineage.ts";
import { visualizeFieldLineage } from "../../scripts/visualize/field-lineage-visualize.ts";
import {
  createDefaultHiveSchemaFixture,
  createSelfJoinFixture,
  createValueAndRowsetFixture,
  valueAndRowsetTableLineage,
} from "../fixtures/field-lineage/baseline/metadata.ts";
import {
  stableArtifactProjection,
  stableProjection,
} from "../fixtures/target-field-causal-slice/legacy-field-lineage-golden/stable-projection.ts";

const GOLDEN_ROOT = resolve(
  "tests/fixtures/target-field-causal-slice/legacy-field-lineage-golden",
);
const BASELINE_ROOT = resolve("tests/fixtures/field-lineage/baseline");
type JsonRecord = Record<string, unknown>;

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(GOLDEN_ROOT, name), "utf8")) as T;
}

const UPDATE_GOLDEN = process.env.UPDATE_FIELD_LINEAGE_GOLDEN === "1";

function writeGolden(name: string, value: unknown): void {
  writeFileSync(join(GOLDEN_ROOT, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function expectGolden(name: string, actual: unknown): void {
  if (UPDATE_GOLDEN) writeGolden(name, actual);
  expect(actual).toEqual(readJson(name));
}

function roots(name: string): {
  readonly tempRoot: string;
  readonly dataRoot: string;
  readonly factsRoot: string;
} {
  const parent = mkdtempSync(join(tmpdir(), `legacy-field-lineage-golden-${name}-`));
  return {
    tempRoot: parent,
    dataRoot: join(parent, "data"),
    factsRoot: join(parent, "facts"),
  };
}

function selfJoinOccurrenceIdentities(factsRoot: string): JsonRecord {
  const records = readFileSync(
    join(
      factsRoot,
      "registry",
      "tasks",
      "120",
      "bundle",
      "relation-nodes.jsonl",
    ),
    "utf8",
  )
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line) as JsonRecord);
  const occurrenceFor = (alias: "l" | "r") => {
    const relation = records.find(
      (candidate) =>
        candidate.relation_type === "read" &&
        String(candidate.relation_id).includes(`:root.read.${alias}`),
    );
    if (typeof relation?.relation_id !== "string")
      throw new Error(`GOLDEN_READ_OCCURRENCE_MISSING:${alias}`);
    const readRelationId = relation.relation_id.split(":relation:")[1];
    if (!readRelationId) throw new Error(`GOLDEN_READ_RELATION_ID_MISSING:${alias}`);
    return {
      occurrenceId: `query#0:${readRelationId}`,
      readRelationId,
      statementIndex: 0,
      relationPath: [readRelationId],
    };
  };
  return { left: occurrenceFor("l"), right: occurrenceFor("r") };
}

describe("legacy field-lineage 1.1 golden compatibility", () => {
  it("deep-compares the complete VALUE_FLOW stable projection", () => {
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

    expectGolden(
      "value-flow.json",
      stableArtifactProjection(artifact, fixture.tempRoot),
    );
  });

  it("deep-compares the complete ROWSET_CONTROL stable projection", () => {
    const fixture = roots("rowset-control");
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

    expectGolden(
      "rowset-control.json",
      stableProjection(artifact.datasetControls, {
        tempRoots: [fixture.tempRoot],
      }),
    );
  });

  it("deep-compares default-Hive output and its explicit physical identities", () => {
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
    const identityProjection = {
      rootNodeFields: artifact.nodes.map((node) => node.field),
      datasetControlFields: artifact.datasetControls.map((control) => control.field),
      datasetControlReasonCodes: artifact.datasetControls.map(
        (control) => control.reasonCode,
      ),
    };

    expectGolden(
      "default-hive-schema.json",
      stableProjection(artifact, { tempRoots: [fixture.tempRoot] }),
    );
    expectGolden("default-hive-identities.json", identityProjection);
  });

  it("deep-compares self-join paths with hard-coded occurrence identities", () => {
    const fixture = roots("self-join");
    createSelfJoinFixture(fixture.dataRoot);
    runInputPackMachineFacts({
      dataRoot: fixture.dataRoot,
      taskIds: ["120", "121", "122"],
      outputRoot: fixture.factsRoot,
    });
    const golden = readJson<{
      readonly occurrences: {
        readonly left: JsonRecord;
        readonly right: JsonRecord;
      };
      readonly artifact: unknown;
    }>("self-join-occurrence.json");
    const occurrences = selfJoinOccurrenceIdentities(fixture.factsRoot);
    if (!UPDATE_GOLDEN)
      expect(occurrences).toEqual(golden.occurrences);
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
            readOccurrence: UPDATE_GOLDEN ? occurrences.left : golden.occurrences.left,
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
            readOccurrence: UPDATE_GOLDEN ? occurrences.right : golden.occurrences.right,
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

    expectGolden("self-join-occurrence.json", {
      occurrences,
      artifact: stableProjection(artifact, { tempRoots: [fixture.tempRoot] }),
    });
  });

  it("reads the legacy artifact and renders the current evidence separation", () => {
    const artifactPath = join(BASELINE_ROOT, "legacy-field-lineage.json");
    const fixture = roots("legacy");
    const outputPath = join(fixture.dataRoot, "legacy-field-lineage.html");
    visualizeFieldLineage({ artifactPath, outputPath });

    expectGolden(
      "legacy-artifact.json",
      stableProjection(JSON.parse(readFileSync(artifactPath, "utf8"))),
    );
    const html = readFileSync(outputPath, "utf8");
    expect(html).toContain("字段血缘 · legacy-root");
    expect(html).toContain('"artifactType":"FIELD_MULTI_HOP_RECONCILIATION"');
    expect(html).toContain("PROVISIONAL_LEGACY");
    expect(html).toContain("临时 / 历史证据");
    expect(html).not.toContain('data-view="code"');
  });
});
