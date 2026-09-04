import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  loadPhysicalTableCatalog,
  runInputPackMachineFacts,
  type PhysicalTableCatalog,
} from "../scripts/machine-facts/input-pack-machine-facts.ts";
import {
  writeTableInput,
  writeTaskInput,
} from "../scripts/input/shared/input-pack.ts";
import {
  canonicalizeFieldLineageArtifact,
  validateFieldLineageArtifact,
} from "../scripts/reconcile/consumer/field-lineage/field-lineage-contract.ts";
import {
  reconcileFieldLineage,
  valueContributionInputFields,
} from "../scripts/reconcile/consumer/field-lineage/field-lineage.ts";
import { formatFieldLineageSummary } from "../scripts/reconcile/consumer/field-lineage/format-field-lineage.ts";
import { runFieldLineageCli } from "../scripts/reconcile/consumer/field-lineage/reconcile-field-lineage.ts";
import {
  createSyntheticFieldLineageInputPack,
  syntheticTableLineage,
  syntheticTableLineageWithFacts,
} from "./fixtures/field-lineage/cases.ts";

function fixture(rootTaskName?: string) {
  const parent = mkdtempSync(join(tmpdir(), "field-lineage-"));
  const dataRoot = join(parent, "data");
  const factsRoot = join(parent, "facts");
  createSyntheticFieldLineageInputPack(dataRoot, { rootTaskName });
  runInputPackMachineFacts({
    dataRoot,
    taskIds: ["100", "200", "300", "400"],
    outputRoot: factsRoot,
  });
  return { dataRoot, factsRoot };
}

describe("field multi-hop lineage", () => {
  it("uses VALUE_CONTRIBUTION roles instead of aggregate input scope", () => {
    const fields = valueContributionInputFields(
      {
        measures: [
          {
            output: "Allo_Prop_1",
            expression_roles: [
              {
                effects: ["BRANCH_SELECTION"],
                input_columns: [
                  {
                    physical: [
                      { table: "demo.source", column: "contract_code" },
                    ],
                  },
                ],
              },
              {
                effects: ["VALUE_CONTRIBUTION"],
                input_columns: [
                  {
                    physical: [
                      { table: "demo.source", column: "allocation_proportion" },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      "allo_prop_1",
    );

    expect(fields).toEqual([
      { table: "demo.source", column: "allocation_proportion" },
    ]);
  });

  it("publishes the versioned canonical JSON Schema", () => {
    const schema = JSON.parse(
      readFileSync(
        resolve("schemas/field-multi-hop-reconciliation.schema.json"),
        "utf8",
      ),
    );
    expect(schema.properties.artifactType.const).toBe(
      "FIELD_MULTI_HOP_RECONCILIATION",
    );
    expect(schema.properties.schemaVersion.const).toBe("1.2.0");
    expect(schema.$defs.physicalField.properties.identityStatus.enum).toEqual([
      "SCHEMA_BACKED",
      "TASK_LOCAL_SCHEMA_BACKED",
    ]);
    expect(schema.$defs.datasetControl.required).toContain("grainReason");
    expect(schema.$defs.datasetControl.properties.grainReason.anyOf).toBeDefined();
  });

  it("rejects legacy rowsetControls nodeId and affectedRootFields", () => {
    const errors = validateFieldLineageArtifact({
      schemaVersion: "1.1.0",
      rowsetControls: [{ nodeId: "field-node:x", affectedRootFields: ["out_a"] }],
      affectedRootFields: ["out_a"],
    });
    expect(errors.join(" ")).toMatch(/rowsetControls is not allowed/);
    expect(errors.join(" ")).toMatch(/affectedRootFields is not allowed/);
    expect(
      validateFieldLineageArtifact({
        schemaVersion: "1.2.0",
        datasetControls: [{ nodeId: "field-node:x", controlId: "x" }],
      }).join(" "),
    ).toMatch(/datasetControls must not include nodeId/);
    expect(
      validateFieldLineageArtifact({
        schemaVersion: "1.2.0",
        datasetControls: [
          {
            controlId: "dataset-control:missing-grain-reason",
            subtype: "JOIN",
            grain: "UNKNOWN",
            grainReason: null,
            masking: false,
          },
        ],
      }).join(" "),
    ).toMatch(/missing grainReason/);
  });
  it("recurses primary only, annotates rowset control, and preserves gaps", () => {
    const f = fixture();
    const artifact = reconcileFieldLineage({
      dataRoot: f.dataRoot,
      factsRoot: f.factsRoot,
      tableLineage: syntheticTableLineageWithFacts(
        f.factsRoot,
        syntheticTableLineage(),
      ),
      rootTaskId: "100",
      rootTable: "demo.root",
      rootFields: ["out_a"],
      factsPolicy: "allow-legacy-partial",
      maxDepth: 8,
      maxStates: 100,
      maxPaths: 100,
    });
    expect(artifact.overallStatus).toBe("PARTIAL");
    expect(
      artifact.nodes.some((node) => node.evidenceStatus === "PROVISIONAL_LEGACY"),
    ).toBe(true);
    expect(
      artifact.nodes.some((node) => node.evidenceStatus === "CONFIRMED"),
    ).toBe(false);
    expect(artifact.edges.some((edge) => edge.producerTaskId === "200")).toBe(
      true,
    );
    expect(artifact.edges.some((edge) => edge.producerTaskId === "300")).toBe(
      true,
    );
    expect(artifact.edges.some((edge) => edge.producerTaskId === "400")).toBe(
      false,
    );
    expect(
      artifact.candidates.some(
        (candidate) => candidate.producerTaskId === "400",
      ),
    ).toBe(true);
    expect(
      artifact.gaps.some(
        (gap) =>
          gap.taskId === "500" && gap.reasonCode === "TASK_INPUT_PACK_EXCLUDED",
      ),
    ).toBe(true);
    expect(artifact.gaps.some((gap) => gap.reasonCode === "CYCLE")).toBe(true);
    expect(
      artifact.datasetControls.some(
        (control) => control.subtype === "FILTER",
      ),
    ).toBe(true);
    expect(
      artifact.datasetControls.every(
        (control) =>
          control.grain === "PRESERVE" ||
          (typeof control.grainReason === "string" && control.grainReason.length > 0),
      ),
    ).toBe(true);
    expect(validateFieldLineageArtifact(artifact)).toEqual([]);
    const summary = formatFieldLineageSummary(artifact);
    expect(summary).toContain("字段 VALUE_FLOW Task 树");
    expect(summary).toContain("DATASET_CONTROL");
    expect(summary).not.toContain("ROWSET_CONTROL");
    expect(summary).not.toContain("影响表数");
  });

  it("uses the Task Pack default schema before resolving a bare field input", () => {
    const f = fixture("demo.root");
    const baseCatalog = loadPhysicalTableCatalog(f.dataRoot, { lazyDdl: true });
    const demoMid = baseCatalog.byQualifiedName.get("demo.mid")?.[0];
    if (!demoMid) throw new Error("TEST_FIXTURE_TABLE_MISSING:demo.mid");
    const duplicateMid = {
      ...demoMid,
      qualifiedName: "other.mid",
      stableTableId: "other.mid__warehouse",
    };
    const byQualifiedName = new Map(baseCatalog.byQualifiedName);
    byQualifiedName.set("other.mid", [duplicateMid]);
    const byNameTail = new Map(baseCatalog.byNameTail);
    byNameTail.set("mid", [demoMid, duplicateMid]);
    const ambiguousCatalog: PhysicalTableCatalog = {
      ...baseCatalog,
      entries: [...baseCatalog.entries, duplicateMid],
      byQualifiedName,
      byNameTail,
    };
    const artifact = reconcileFieldLineage({
      dataRoot: f.dataRoot,
      factsRoot: f.factsRoot,
      tableCatalog: ambiguousCatalog,
      tableLineage: syntheticTableLineage(),
      rootTaskId: "100",
      rootTable: "demo.root",
      rootFields: ["out_a"],
      factsPolicy: "allow-legacy-partial",
      maxDepth: 8,
      maxStates: 100,
      maxPaths: 100,
    });

    expect(
      artifact.gaps.filter(
        (gap) =>
          gap.taskId === "100" &&
          [
            "SOURCE_TABLE_PACK_MISSING",
            "SOURCE_TABLE_IDENTITY_AMBIGUOUS",
            "SOURCE_FIELD_NOT_IN_SCHEMA",
          ].includes(gap.reasonCode),
      ),
    ).toEqual([]);
    expect(
      artifact.nodes.some(
        (node) =>
          node.taskId === "100" &&
          node.field.qualifiedName === "demo.mid" &&
          node.field.column === "mid_a",
      ),
    ).toBe(true);
    expect(
      artifact.datasetControls.some(
        (control) =>
          control.taskId === "100" &&
          control.subtype === "FILTER" &&
          control.reasonCode === null &&
          control.field?.qualifiedName === "demo.mid" &&
          control.field.column === "filter_key",
      ),
    ).toBe(true);
  });

  it("uses every target schema column when no root fields are specified", () => {
    const f = fixture();
    const artifact = reconcileFieldLineage({
      dataRoot: f.dataRoot,
      factsRoot: f.factsRoot,
      tableLineage: syntheticTableLineage(),
      rootTaskId: "100",
      rootTable: "demo.root",
      rootFields: [],
      factsPolicy: "allow-legacy-partial",
      maxDepth: 8,
      maxStates: 100,
      maxPaths: 100,
    });
    expect(artifact.request.rootFieldSelection).toBe("ALL_TARGET_COLUMNS");
    expect(artifact.request.rootFields).toEqual(["out_a", "out_b"]);
    expect(artifact.rootNodeIds).toHaveLength(2);
    const oneField = reconcileFieldLineage({
      dataRoot: f.dataRoot,
      factsRoot: f.factsRoot,
      tableLineage: syntheticTableLineage(),
      rootTaskId: "100",
      rootTable: "demo.root",
      rootFields: ["out_a"],
      factsPolicy: "allow-legacy-partial",
      maxDepth: 8,
      maxStates: 100,
      maxPaths: 100,
    });
    expect(artifact.datasetControls.map((control) => control.controlId).sort()).toEqual(
      oneField.datasetControls.map((control) => control.controlId).sort(),
    );
    expect(artifact.datasetControls.every((control) => !("nodeId" in control))).toBe(
      true,
    );
  });

  it("skips checkdbflag upstream tasks without turning them into field gaps", () => {
    const f = fixture();
    writeTaskInput(f.dataRoot, {
      taskId: "901",
      taskCategory: "checkdbflag",
      taskName: "checker.demo.mid",
      evidenceProvider: "synthetic:test",
      collectedAt: "2026-01-01T00:00:00.000Z",
    });
    const artifact = reconcileFieldLineage({
      dataRoot: f.dataRoot,
      factsRoot: f.factsRoot,
      tableLineage: {
        ...syntheticTableLineage(),
        taskNodes: [
          {
            taskId: "100",
            upstreamDecision: { primary: ["901"], additional: [], unknown: [] },
          },
        ],
        producerBridges: [
          {
            consumerTaskId: "100",
            producerTaskId: "901",
            table: {
              platform: "hive",
              dataSource: "warehouse",
              qualifiedName: "demo.mid",
            },
          },
        ],
      },
      rootTaskId: "100",
      rootTable: "demo.root",
      rootFields: ["out_a"],
      factsPolicy: "allow-legacy-partial",
      maxDepth: 8,
      maxStates: 100,
      maxPaths: 100,
    });
    expect(artifact.gaps).toEqual([]);
    expect(artifact.nodes.some((node) => node.taskId === "901")).toBe(false);
  });

  it("prepares Machine Facts lazily for field-reachable primary tasks", () => {
    const parent = mkdtempSync(join(tmpdir(), "field-lineage-lazy-facts-"));
    const dataRoot = join(parent, "data");
    const factsRoot = join(parent, "facts");
    const tableLineagePath = join(parent, "table-lineage.json");
    const outputPath = join(parent, "field-lineage.json");
    const timingPath = join(parent, "field-lineage-timing.json");
    createSyntheticFieldLineageInputPack(dataRoot);
    writeTableInput(dataRoot, {
      platform: "hive",
      dataSource: "warehouse",
      qualifiedName: "demo.other",
      objectType: "hive_table",
      partitionFields: [],
      ddl: "CREATE TABLE demo.other (other_a STRING);",
      evidenceProvider: "synthetic:test",
      collectedAt: "2026-01-01T00:00:00.000Z",
    });
    writeTaskInput(dataRoot, {
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
          evidenceProvider: "synthetic:test",
        },
        query: {
          content:
            "SELECT m.mid_a AS out_a, o.other_a AS out_b FROM demo.mid m CROSS JOIN demo.other o;",
          evidenceProvider: "synthetic:test",
        },
      },
      evidenceProvider: "synthetic:test",
      collectedAt: "2026-01-01T00:00:00.000Z",
    });
    writeTaskInput(dataRoot, {
      taskId: "610",
      taskCategory: "sparkIndex",
      taskName: "demo.other.task",
      target: {
        platform: "hive",
        dataSource: "warehouse",
        qualifiedName: "demo.other",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
      partition: null,
      sql: {
        query: {
          content: "SELECT src_a AS other_a FROM demo.extra;",
          evidenceProvider: "synthetic:test",
        },
      },
      evidenceProvider: "synthetic:test",
      collectedAt: "2026-01-01T00:00:00.000Z",
    });
    const tableLineage = syntheticTableLineage();
    const evidenceFactsRoot = join(parent, "evidence-facts");
    runInputPackMachineFacts({
      dataRoot,
      taskIds: ["100", "200", "300"],
      outputRoot: evidenceFactsRoot,
    });
    const tableLineageWithEvidence = syntheticTableLineageWithFacts(
      evidenceFactsRoot,
      tableLineage,
    );
    const tableLineageForCli = syntheticTableLineageWithFacts(
      evidenceFactsRoot,
      {
        ...tableLineageWithEvidence,
        taskNodes: [
          ...tableLineage.taskNodes.map((node) =>
            node.taskId === "100"
              ? {
                  ...node,
                  upstreamDecision: {
                    primary: ["200", "610"],
                    additional: [],
                    unknown: [],
                  },
                }
              : node,
          ),
          {
            taskId: "610",
            upstreamDecision: { primary: [], additional: [], unknown: [] },
          },
        ],
        producerBridges: [
          ...tableLineageWithEvidence.producerBridges,
          {
            consumerTaskId: "100",
            producerTaskId: "610",
            table: {
              platform: "hive",
              dataSource: "warehouse",
              qualifiedName: "demo.other",
            },
          },
        ],
      },
    );
    writeFileSync(
      tableLineagePath,
      `${JSON.stringify(tableLineageForCli)}\n`,
      "utf8",
    );

    runFieldLineageCli({
      dataRoot,
      factsRoot,
      multiHopArtifact: tableLineagePath,
      taskId: "100",
      targetTable: "demo.root",
      fields: ["out_a"],
      factsPolicy: "allow-legacy-partial",
      maxDepth: 8,
      maxStates: 100,
      maxPaths: 100,
      output: outputPath,
      timingOutput: timingPath,
      prepareFacts: true,
    });

    const timing = JSON.parse(readFileSync(timingPath, "utf8"));
    expect(timing.schema_version).toBe("field-lineage-timing-v1");
    expect(timing.counters.machine_facts_prepare_batches).toBeGreaterThan(0);
    expect(timing.counters.reconcile_calls).toBeGreaterThan(0);
    expect(timing.phases_ms.machine_facts_index_ms).toBeGreaterThanOrEqual(0);

    const indexedTaskIds = readFileSync(
      join(factsRoot, "indexes", "task-fact-index.jsonl"),
      "utf8",
    )
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line).task_id)
      .sort();
    expect(indexedTaskIds).toEqual(["100", "200", "300"]);
    expect(indexedTaskIds).not.toContain("400");
    expect(indexedTaskIds).not.toContain("610");
  });

  it("accepts freshly prepared facts from the active Machine Facts contract", () => {
    const parent = mkdtempSync(join(tmpdir(), "field-lineage-preflight-"));
    const dataRoot = join(parent, "data");
    const factsRoot = join(parent, "facts");
    const tableLineagePath = join(parent, "table-lineage.json");
    const outputPath = join(parent, "field-lineage.json");
    createSyntheticFieldLineageInputPack(dataRoot);
    writeFileSync(tableLineagePath, `${JSON.stringify(syntheticTableLineage())}\n`, "utf8");

    expect(() =>
      runFieldLineageCli({
        dataRoot,
        factsRoot,
        multiHopArtifact: tableLineagePath,
        taskId: "100",
        targetTable: "demo.root",
        fields: [],
        factsPolicy: "current-only",
        maxDepth: 8,
        maxStates: 100,
        maxPaths: 100,
        output: outputPath,
        prepareFacts: true,
      }),
    ).not.toThrow();
    expect(existsSync(outputPath)).toBe(true);
  });

  it("keeps same-physical-table producers as candidates instead of recursing", () => {
    const f = fixture();
    writeTaskInput(f.dataRoot, {
      taskId: "1300",
      taskCategory: "hiveTask",
      taskName: "demo.same.table.read",
      target: {
        platform: "hive",
        dataSource: "warehouse",
        qualifiedName: "demo.source",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
      partition: null,
      sql: {
        query: {
          content: "SELECT s.src_a, s.filter_key FROM demo.source s;",
          evidenceProvider: "synthetic:test",
        },
      },
      evidenceProvider: "synthetic:test",
      collectedAt: "2026-01-01T00:00:00.000Z",
    });
    runInputPackMachineFacts({
      dataRoot: f.dataRoot,
      taskIds: ["1300"],
      outputRoot: f.factsRoot,
    });
    const artifact = reconcileFieldLineage({
      dataRoot: f.dataRoot,
      factsRoot: f.factsRoot,
      tableLineage: {
        ...syntheticTableLineage(),
        rootTaskId: "1300",
        taskNodes: [
          {
            taskId: "1300",
            upstreamDecision: { primary: ["300", "400"], additional: [], unknown: [] },
          },
        ],
        producerBridges: [
          {
            consumerTaskId: "1300",
            producerTaskId: "300",
            table: { platform: "hive", dataSource: "warehouse", qualifiedName: "demo.source" },
          },
          {
            consumerTaskId: "1300",
            producerTaskId: "400",
            table: { platform: "hive", dataSource: "warehouse", qualifiedName: "demo.source" },
          },
        ],
      },
      rootTaskId: "1300",
      rootTable: "demo.source",
      rootFields: ["src_a"],
      factsPolicy: "allow-legacy-partial",
      maxDepth: 8,
      maxStates: 100,
      maxPaths: 100,
    });
    expect(artifact.edges.some((edge) => edge.producerTaskId !== null)).toBe(false);
    expect(
      artifact.candidates.filter(
        (candidate) => candidate.reasonCode === "SAME_PHYSICAL_TABLE_PRODUCER_NOT_RECURSED",
      ),
    ).toHaveLength(2);
    expect(artifact.gaps.some((gap) => gap.reasonCode === "CYCLE")).toBe(false);
  });

  it("binds same-table producer bridges to the field expression read occurrence", () => {
    const f = fixture();
    writeTaskInput(f.dataRoot, {
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
        query: {
          content:
            "SELECT c.mid_a AS out_a, k.mid_a AS out_b FROM demo.mid c JOIN demo.mid k ON c.mid_a = k.mid_a",
          evidenceProvider: "synthetic:test",
        },
      },
      evidenceProvider: "synthetic:test",
      collectedAt: "2026-01-01T00:00:00.000Z",
    });
    for (const taskId of ["201", "202"])
      writeTaskInput(f.dataRoot, {
        taskId,
        taskCategory: "sparkIndex",
        taskName: `demo.mid.${taskId}`,
        target: {
          platform: "hive",
          dataSource: "warehouse",
          qualifiedName: "demo.mid",
        },
        targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
        partition: null,
        sql: {
          query: {
            content:
              "SELECT src_a AS mid_a, src_b AS mid_b FROM demo.source",
            evidenceProvider: "synthetic:test",
          },
        },
        evidenceProvider: "synthetic:test",
        collectedAt: "2026-01-01T00:00:00.000Z",
      });
    runInputPackMachineFacts({
      dataRoot: f.dataRoot,
      taskIds: ["100", "201"],
      outputRoot: f.factsRoot,
    });
    const occurrence = (alias: "c" | "k") => ({
      occurrenceId: `query#0:root.${alias}.read.mid`,
      readRelationId: `root.${alias}.read.mid`,
      statementIndex: 0,
      relationPath: [`root.${alias}.read.mid`],
    });
    const artifact = reconcileFieldLineage({
      dataRoot: f.dataRoot,
      factsRoot: f.factsRoot,
      tableLineage: {
        rootTaskId: "100",
        taskNodes: [
          {
            taskId: "100",
            upstreamDecision: {
              primary: ["200", "201"],
              additional: [],
              unknown: [],
            },
          },
          {
            taskId: "200",
            upstreamDecision: { primary: [], additional: [], unknown: [] },
          },
          {
            taskId: "201",
            upstreamDecision: { primary: [], additional: [], unknown: [] },
          },
        ],
        producerBridges: [
          {
            consumerTaskId: "100",
            producerTaskId: "200",
            table: {
              platform: "hive",
              dataSource: "warehouse",
              qualifiedName: "demo.mid",
            },
            producerRole: "PRIMARY",
            readOccurrence: occurrence("c"),
          },
          {
            consumerTaskId: "100",
            producerTaskId: "201",
            table: {
              platform: "hive",
              dataSource: "warehouse",
              qualifiedName: "demo.mid",
            },
            producerRole: "PRIMARY",
            readOccurrence: occurrence("k"),
          },
          {
            consumerTaskId: "100",
            producerTaskId: "202",
            table: {
              platform: "hive",
              dataSource: "warehouse",
              qualifiedName: "demo.mid",
            },
            producerRole: "CANDIDATE",
            readOccurrence: occurrence("c"),
          },
        ],
      },
      rootTaskId: "100",
      rootTable: "demo.root",
      rootFields: ["out_a", "out_b"],
      factsPolicy: "current-only",
      maxDepth: 4,
      maxStates: 100,
      maxPaths: 100,
    });
    const producerIdsForRoot = (rootColumn: string): string[] => {
      const pending = artifact.nodes
        .filter(
          (node) => node.taskId === "100" && node.field.column === rootColumn,
        )
        .map((node) => node.nodeId);
      const seen = new Set<string>();
      const producerIds = new Set<string>();
      while (pending.length > 0) {
        const nodeId = pending.pop()!;
        if (seen.has(nodeId)) continue;
        seen.add(nodeId);
        for (const edge of artifact.edges.filter(
          (candidate) => candidate.toNodeId === nodeId,
        )) {
          if (edge.producerTaskId) producerIds.add(edge.producerTaskId);
          pending.push(edge.fromNodeId);
        }
      }
      return [...producerIds].sort();
    };

    expect(producerIdsForRoot("out_a")).toContain("200");
    expect(producerIdsForRoot("out_a")).not.toContain("201");
    expect(producerIdsForRoot("out_b")).toContain("201");
    expect(producerIdsForRoot("out_b")).not.toContain("200");
    expect(artifact.edges.some((edge) => edge.producerTaskId === "202")).toBe(
      false,
    );
    expect(
      artifact.candidates.some(
        (candidate) => candidate.producerTaskId === "202",
      ),
    ).toBe(true);
  });

  it("binds nested derived same-table reads to their source occurrence", () => {
    const f = fixture();
    writeTaskInput(f.dataRoot, {
      taskId: "100",
      taskCategory: "sparkIndex",
      taskName: "demo.root.nested.task",
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
            "SELECT c.mid_a AS out_a, k.mid_a AS out_b FROM (SELECT m.mid_a FROM demo.mid m) c JOIN (SELECT n.mid_a FROM demo.mid n) k ON c.mid_a = k.mid_a",
          evidenceProvider: "synthetic:test",
        },
      },
      evidenceProvider: "synthetic:test",
      collectedAt: "2026-01-01T00:00:00.000Z",
    });
    for (const taskId of ["201", "202"])
      writeTaskInput(f.dataRoot, {
        taskId,
        taskCategory: "sparkIndex",
        taskName: `demo.mid.${taskId}`,
        target: {
          platform: "hive",
          dataSource: "warehouse",
          qualifiedName: "demo.mid",
        },
        targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
        partition: null,
        sql: {
          query: {
            content: "SELECT src_a AS mid_a, filter_key FROM demo.source",
            evidenceProvider: "synthetic:test",
          },
        },
        evidenceProvider: "synthetic:test",
        collectedAt: "2026-01-01T00:00:00.000Z",
      });
    runInputPackMachineFacts({
      dataRoot: f.dataRoot,
      taskIds: ["100", "201", "202"],
      outputRoot: f.factsRoot,
    });
    const relationNodes = readFileSync(
      join(
        f.factsRoot,
        "registry",
        "tasks",
        "100",
        "bundle",
        "relation-nodes.jsonl",
      ),
      "utf8",
    )
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const readRelation = (scope: "c" | "k") => {
      const relation = relationNodes.find(
        (candidate: { relation_id?: string; relation_type?: string }) =>
          candidate.relation_type === "read" &&
          String(candidate.relation_id).includes(`:root.${scope}.read.`),
      );
      const fullRelationId = String(relation?.relation_id ?? "");
      const relativeRelationId = fullRelationId.split(":relation:")[1];
      return {
        occurrenceId: `query#0:${relativeRelationId}`,
        readRelationId: relativeRelationId,
        statementIndex: 0,
        relationPath: [relativeRelationId],
      };
    };
    const artifact = reconcileFieldLineage({
      dataRoot: f.dataRoot,
      factsRoot: f.factsRoot,
      tableLineage: {
        rootTaskId: "100",
        taskNodes: [
          {
            taskId: "100",
            upstreamDecision: { primary: ["201", "202"], additional: [], unknown: [] },
          },
          {
            taskId: "201",
            upstreamDecision: { primary: [], additional: [], unknown: [] },
          },
          {
            taskId: "202",
            upstreamDecision: { primary: [], additional: [], unknown: [] },
          },
        ],
        producerBridges: [
          {
            consumerTaskId: "100",
            producerTaskId: "201",
            producerRole: "PRIMARY",
            table: { platform: "hive", dataSource: "warehouse", qualifiedName: "demo.mid" },
            readOccurrence: readRelation("c"),
          },
          {
            consumerTaskId: "100",
            producerTaskId: "202",
            producerRole: "PRIMARY",
            table: { platform: "hive", dataSource: "warehouse", qualifiedName: "demo.mid" },
            readOccurrence: readRelation("k"),
          },
        ],
      },
      rootTaskId: "100",
      rootTable: "demo.root",
      rootFields: ["out_a", "out_b"],
      factsPolicy: "current-only",
      maxDepth: 4,
      maxStates: 100,
      maxPaths: 100,
    });
    const producerIdsForRoot = (rootColumn: string): string[] => {
      const pending = artifact.nodes
        .filter(
          (node) => node.taskId === "100" && node.field.column === rootColumn,
        )
        .map((node) => node.nodeId);
      const seen = new Set<string>();
      const producerIds = new Set<string>();
      while (pending.length > 0) {
        const nodeId = pending.pop()!;
        if (seen.has(nodeId)) continue;
        seen.add(nodeId);
        for (const edge of artifact.edges.filter(
          (candidate) => candidate.toNodeId === nodeId,
        )) {
          if (edge.producerTaskId) producerIds.add(edge.producerTaskId);
          pending.push(edge.fromNodeId);
        }
      }
      return [...producerIds].sort();
    };

    expect(producerIdsForRoot("out_a")).toContain("201");
    expect(producerIdsForRoot("out_a")).not.toContain("202");
    expect(producerIdsForRoot("out_b")).toContain("202");
    expect(producerIdsForRoot("out_b")).not.toContain("201");
    expect(
      artifact.gaps.some(
        (gap) => gap.reasonCode === "READ_OCCURRENCE_FIELD_BINDING_UNKNOWN",
      ),
    ).toBe(false);
  });

  it("binds aggregate same-table reads by their relation scope", () => {
    const f = fixture();
    writeTaskInput(f.dataRoot, {
      taskId: "100",
      taskCategory: "sparkIndex",
      taskName: "demo.root.aggregate-occurrence.task",
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
            "SELECT init.total AS out_a, em.mid_a AS out_b FROM (SELECT SUM(mid_a) AS total FROM demo.mid WHERE filter_key = 'init') init JOIN (SELECT * FROM demo.mid WHERE filter_key = 'em') em ON 1 = 1",
          evidenceProvider: "synthetic:test",
        },
      },
      evidenceProvider: "synthetic:test",
      collectedAt: "2026-01-01T00:00:00.000Z",
    });
    for (const taskId of ["201", "202"])
      writeTaskInput(f.dataRoot, {
        taskId,
        taskCategory: "sparkIndex",
        taskName: `demo.mid.${taskId}`,
        target: {
          platform: "hive",
          dataSource: "warehouse",
          qualifiedName: "demo.mid",
        },
        targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
        partition: null,
        sql: {
          query: {
            content: "SELECT src_a AS mid_a, filter_key FROM demo.source",
            evidenceProvider: "synthetic:test",
          },
        },
        evidenceProvider: "synthetic:test",
        collectedAt: "2026-01-01T00:00:00.000Z",
      });
    runInputPackMachineFacts({
      dataRoot: f.dataRoot,
      taskIds: ["100", "201", "202"],
      outputRoot: f.factsRoot,
    });
    const relationNodes = readFileSync(
      join(
        f.factsRoot,
        "registry",
        "tasks",
        "100",
        "bundle",
        "relation-nodes.jsonl",
      ),
      "utf8",
    )
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const readRelation = (scope: "init" | "em") => {
      const relation = relationNodes.find(
        (candidate: { relation_id?: string; relation_type?: string }) =>
          candidate.relation_type === "read" &&
          String(candidate.relation_id).includes(`:root.${scope}.read.`),
      );
      const fullRelationId = String(relation?.relation_id ?? "");
      const relativeRelationId = fullRelationId.split(":relation:")[1];
      return {
        occurrenceId: `query#0:${relativeRelationId}`,
        readRelationId: relativeRelationId,
        statementIndex: 0,
        relationPath: [relativeRelationId],
      };
    };
    const artifact = reconcileFieldLineage({
      dataRoot: f.dataRoot,
      factsRoot: f.factsRoot,
      tableLineage: {
        rootTaskId: "100",
        taskNodes: [
          {
            taskId: "100",
            upstreamDecision: { primary: ["201", "202"], additional: [], unknown: [] },
          },
          {
            taskId: "201",
            upstreamDecision: { primary: [], additional: [], unknown: [] },
          },
          {
            taskId: "202",
            upstreamDecision: { primary: [], additional: [], unknown: [] },
          },
        ],
        producerBridges: [
          {
            consumerTaskId: "100",
            producerTaskId: "201",
            producerRole: "PRIMARY",
            table: { platform: "hive", dataSource: "warehouse", qualifiedName: "demo.mid" },
            readOccurrence: readRelation("init"),
          },
          {
            consumerTaskId: "100",
            producerTaskId: "202",
            producerRole: "PRIMARY",
            table: { platform: "hive", dataSource: "warehouse", qualifiedName: "demo.mid" },
            readOccurrence: readRelation("em"),
          },
        ],
      },
      rootTaskId: "100",
      rootTable: "demo.root",
      rootFields: ["out_a", "out_b"],
      factsPolicy: "current-only",
      maxDepth: 4,
      maxStates: 100,
      maxPaths: 100,
    });
    const producerIdsForRoot = (rootColumn: string): string[] => {
      const pending = artifact.nodes
        .filter(
          (node) => node.taskId === "100" && node.field.column === rootColumn,
        )
        .map((node) => node.nodeId);
      const seen = new Set<string>();
      const producerIds = new Set<string>();
      while (pending.length > 0) {
        const nodeId = pending.pop()!;
        if (seen.has(nodeId)) continue;
        seen.add(nodeId);
        for (const edge of artifact.edges.filter(
          (candidate) => candidate.toNodeId === nodeId,
        )) {
          if (edge.producerTaskId) producerIds.add(edge.producerTaskId);
          pending.push(edge.fromNodeId);
        }
      }
      return [...producerIds].sort();
    };

    expect(producerIdsForRoot("out_a")).toContain("201");
    expect(producerIdsForRoot("out_a")).not.toContain("202");
    expect(producerIdsForRoot("out_b")).toContain("202");
    expect(producerIdsForRoot("out_b")).not.toContain("201");
    expect(
      artifact.gaps.some(
        (gap) =>
          gap.reasonCode === "READ_OCCURRENCE_FIELD_BINDING_UNKNOWN",
      ),
    ).toBe(false);
  });

  it("accepts the active publisher facts under the current-only policy", () => {
    const f = fixture();
    const artifact = reconcileFieldLineage({
      dataRoot: f.dataRoot,
      factsRoot: f.factsRoot,
      tableLineage: syntheticTableLineage(),
      rootTaskId: "100",
      rootTable: "demo.root",
      rootFields: ["out_a"],
      factsPolicy: "current-only",
      maxDepth: 8,
      maxStates: 100,
      maxPaths: 100,
    });
    expect(artifact.overallStatus).not.toBe("BLOCKED");
    expect(
      artifact.gaps.some(
        (gap) => gap.reasonCode === "LEGACY_FACTS_NOT_ALLOWED",
      ),
    ).toBe(false);
    expect(
      artifact.nodes.some((node) => node.evidenceStatus === "CONFIRMED"),
    ).toBe(true);
  });

  it("is deterministic and rejects COMPLETE artifacts with legacy evidence", () => {
    const f = fixture();
    const options = {
      dataRoot: f.dataRoot,
      factsRoot: f.factsRoot,
      tableLineage: syntheticTableLineage(),
      rootTaskId: "100",
      rootTable: "demo.root",
      rootFields: ["out_a"],
      factsPolicy: "allow-legacy-partial" as const,
      maxDepth: 8,
      maxStates: 100,
      maxPaths: 100,
    };
    const left = reconcileFieldLineage(options);
    const right = reconcileFieldLineage(options);
    expect(right).toEqual(left);
    const invalid = { ...left, overallStatus: "COMPLETE" };
    expect(validateFieldLineageArtifact(invalid).join(" ")).toMatch(
      /COMPLETE cannot contain/,
    );
    expect(() =>
      canonicalizeFieldLineageArtifact({
        ...invalid,
        contentHash: undefined,
      } as never),
    ).toThrow();
  });

  it("rejects a root field missing from Schema", () => {
    const f = fixture();
    expect(() =>
      reconcileFieldLineage({
        dataRoot: f.dataRoot,
        factsRoot: f.factsRoot,
        tableLineage: syntheticTableLineage(),
        rootTaskId: "100",
        rootTable: "demo.root",
        rootFields: ["guessed_name"],
        factsPolicy: "allow-legacy-partial",
        maxDepth: 8,
        maxStates: 100,
        maxPaths: 100,
      }),
    ).toThrow(/ROOT_FIELD_NOT_IN_SCHEMA/);
  });

  it("keeps unknown producers and source fields without Schema as unresolved", () => {
    const f = fixture();
    runInputPackMachineFacts({
      dataRoot: f.dataRoot,
      taskIds: ["700"],
      outputRoot: f.factsRoot,
    });
    const tableLineage = {
      ...syntheticTableLineage(),
      rootTaskId: "700",
      taskNodes: [
        {
          taskId: "700",
          upstreamDecision: { primary: [], additional: [], unknown: ["999"] },
        },
      ],
      producerBridges: [],
    };
    const artifact = reconcileFieldLineage({
      dataRoot: f.dataRoot,
      factsRoot: f.factsRoot,
      tableLineage,
      rootTaskId: "700",
      rootTable: "demo.root",
      rootFields: ["out_a", "out_b"],
      factsPolicy: "allow-legacy-partial",
      maxDepth: 8,
      maxStates: 100,
      maxPaths: 100,
    });
    expect(artifact.rootNodeIds).toHaveLength(2);
    expect(
      artifact.gaps.some(
        (gap) =>
          gap.reasonCode === "SOURCE_FIELD_SCHEMA_UNVERIFIED" ||
          gap.reasonCode === "PHYSICAL_FIELD_UNRESOLVED",
      ),
    ).toBe(true);
    expect(artifact.edges.some((edge) => edge.producerTaskId === "999")).toBe(
      false,
    );
  });

  it("does not attach unrelated table-level unknowns to a field value path", () => {
    const f = fixture();
    const base = syntheticTableLineage();
    const artifact = reconcileFieldLineage({
      dataRoot: f.dataRoot,
      factsRoot: f.factsRoot,
      tableLineage: {
        ...base,
        taskNodes: base.taskNodes.map((node) =>
          node.taskId === "100"
            ? {
                ...node,
                upstreamDecision: {
                  ...node.upstreamDecision,
                  unknown: ["400"],
                },
              }
            : node,
        ),
      },
      rootTaskId: "100",
      rootTable: "demo.root",
      rootFields: ["out_a"],
      factsPolicy: "allow-legacy-partial",
      maxDepth: 8,
      maxStates: 100,
      maxPaths: 100,
    });

    expect(
      artifact.tableEdges.some(
        (edge) =>
          edge.consumerTaskId === "100" &&
          edge.producerTaskId === "400" &&
          edge.classification === "UNKNOWN",
      ),
    ).toBe(true);
    expect(
      artifact.gaps.some(
        (gap) => gap.reasonCode === "ONE_HOP_UPSTREAM_UNKNOWN",
      ),
    ).toBe(false);
  });

  it("stops a table-level unknown only when it matches the current physical source", () => {
    const f = fixture();
    const base = syntheticTableLineage();
    const artifact = reconcileFieldLineage({
      dataRoot: f.dataRoot,
      factsRoot: f.factsRoot,
      tableLineage: {
        ...base,
        rootTaskId: "200",
        taskNodes: [
          {
            taskId: "200",
            upstreamDecision: {
              primary: [],
              additional: [],
              unknown: ["400"],
            },
          },
        ],
      },
      rootTaskId: "200",
      rootTable: "demo.mid",
      rootFields: ["mid_a"],
      factsPolicy: "allow-legacy-partial",
      maxDepth: 8,
      maxStates: 100,
      maxPaths: 100,
    });

    expect(
      artifact.gaps.some(
        (gap) =>
          gap.reasonCode === "ONE_HOP_UPSTREAM_UNKNOWN" &&
          gap.taskId === "400" &&
          gap.field?.qualifiedName === "demo.source",
      ),
    ).toBe(true);
    expect(
      artifact.candidates.some(
        (candidate) =>
          candidate.consumerTaskId === "200" &&
          candidate.producerTaskId === "400" &&
          candidate.reasonCode === "ONE_HOP_UNKNOWN_NOT_RECURSED",
      ),
    ).toBe(true);
    expect(artifact.edges.some((edge) => edge.producerTaskId === "400")).toBe(
      false,
    );
  });

  it("deduplicates a relevant unknown across repeated bindings of the same physical field", () => {
    const f = fixture();
    runInputPackMachineFacts({
      dataRoot: f.dataRoot,
      taskIds: ["900"],
      outputRoot: f.factsRoot,
    });
    const artifact = reconcileFieldLineage({
      dataRoot: f.dataRoot,
      factsRoot: f.factsRoot,
      tableLineage: {
        ...syntheticTableLineage(),
        rootTaskId: "900",
        taskNodes: [
          {
            taskId: "900",
            upstreamDecision: {
              primary: [],
              additional: [],
              unknown: ["1100"],
            },
          },
        ],
        producerBridges: [
          {
            consumerTaskId: "900",
            producerTaskId: "1100",
            table: {
              platform: "hive",
              dataSource: "warehouse",
              qualifiedName: "demo.extra",
            },
          },
        ],
      },
      rootTaskId: "900",
      rootTable: "demo.root",
      rootFields: ["out_a"],
      factsPolicy: "allow-legacy-partial",
      maxDepth: 8,
      maxStates: 100,
      maxPaths: 100,
    });

    expect(
      artifact.gaps.filter(
        (gap) =>
          gap.reasonCode === "ONE_HOP_UPSTREAM_UNKNOWN" &&
          gap.taskId === "1100",
      ),
    ).toHaveLength(1);
  });

  it("branches traversal state by output binding when a Task writes the same field more than once", () => {
    const f = fixture();
    runInputPackMachineFacts({
      dataRoot: f.dataRoot,
      taskIds: ["900"],
      outputRoot: f.factsRoot,
    });
    const artifact = reconcileFieldLineage({
      dataRoot: f.dataRoot,
      factsRoot: f.factsRoot,
      tableLineage: {
        ...syntheticTableLineage(),
        rootTaskId: "900",
        taskNodes: [
          {
            taskId: "900",
            upstreamDecision: { primary: [], additional: [], unknown: [] },
          },
        ],
        producerBridges: [],
      },
      rootTaskId: "900",
      rootTable: "demo.root",
      rootFields: ["out_a"],
      factsPolicy: "allow-legacy-partial",
      maxDepth: 8,
      maxStates: 100,
      maxPaths: 100,
    });
    expect(artifact.rootNodeIds).toHaveLength(2);
    expect(
      new Set(
        artifact.rootNodeIds.map(
          (id) => artifact.nodes.find((node) => node.nodeId === id)?.bindingId,
        ),
      ).size,
    ).toBe(2);
    expect(
      artifact.gaps.some(
        (gap) => gap.reasonCode === "OUTPUT_FIELD_BINDING_NOT_PROVABLE",
      ),
    ).toBe(false);
    expect(validateFieldLineageArtifact(artifact)).toEqual([]);
  });

  it("surfaces an excluded schedule-fallback parent when one eligible read makes the stop unambiguous", () => {
    const f = fixture();
    const artifact = reconcileFieldLineage({
      dataRoot: f.dataRoot,
      factsRoot: f.factsRoot,
      tableLineage: {
        ...syntheticTableLineage(),
        rootTaskId: "200",
        taskNodes: [
          {
            taskId: "200",
            upstreamDecision: { primary: ["500"], additional: [], unknown: [] },
          },
        ],
        producerBridges: [],
        scheduleEdges: [{ consumerTaskId: "200", producerTaskId: "500" }],
        readEdges: [
          {
            consumerTaskId: "200",
            recursionStatus: "ELIGIBLE",
            table: {
              platform: "hive",
              dataSource: "warehouse",
              qualifiedName: "demo.source",
            },
          },
        ],
      },
      rootTaskId: "200",
      rootTable: "demo.mid",
      rootFields: ["mid_a"],
      factsPolicy: "allow-legacy-partial",
      maxDepth: 8,
      maxStates: 100,
      maxPaths: 100,
    });
    expect(
      artifact.gaps.some(
        (gap) =>
          gap.taskId === "500" && gap.reasonCode === "TASK_INPUT_PACK_EXCLUDED",
      ),
    ).toBe(true);
    expect(artifact.edges.some((edge) => edge.producerTaskId === "500")).toBe(
      false,
    );
  });

  it("stitches Task-local CTAS fields across Input Pack SQL slots without exposing them as cross-Task identities", () => {
    const f = fixture();
    runInputPackMachineFacts({
      dataRoot: f.dataRoot,
      taskIds: ["1000"],
      outputRoot: f.factsRoot,
    });
    const artifact = reconcileFieldLineage({
      dataRoot: f.dataRoot,
      factsRoot: f.factsRoot,
      tableLineage: {
        ...syntheticTableLineage(),
        rootTaskId: "1000",
        taskNodes: [
          {
            taskId: "1000",
            upstreamDecision: { primary: [], additional: [], unknown: [] },
          },
        ],
        producerBridges: [],
      },
      rootTaskId: "1000",
      rootTable: "demo.root",
      rootFields: ["out_a"],
      factsPolicy: "allow-legacy-partial",
      maxDepth: 8,
      maxStates: 100,
      maxPaths: 100,
    });
    expect(
      artifact.nodes.some(
        (node) =>
          node.field.identityStatus === "TASK_LOCAL_SCHEMA_BACKED" &&
          node.field.qualifiedName === "temp.local_stage",
      ),
    ).toBe(true);
    expect(
      artifact.nodes.some(
        (node) =>
          node.field.identityStatus === "TASK_LOCAL_SCHEMA_BACKED" &&
          node.field.qualifiedName === "temp.mid_stage",
      ),
    ).toBe(true);
    expect(
      artifact.nodes.some(
        (node) =>
          node.field.identityStatus === "SCHEMA_BACKED" &&
          node.field.qualifiedName === "demo.extra" &&
          node.field.column === "src_a",
      ),
    ).toBe(true);
    expect(
      artifact.gaps.some(
        (gap) => gap.reasonCode === "SOURCE_TABLE_PACK_MISSING",
      ),
    ).toBe(false);
    expect(
      artifact.edges.filter((edge) => edge.producerTaskId !== null),
    ).toHaveLength(0);
    expect(validateFieldLineageArtifact(artifact)).toEqual([]);
  });

  it("stitches Task-local INSERT OVERWRITE materialization before consulting table additional producers", () => {
    const f = fixture();
    writeTableInput(f.dataRoot, {
      platform: "hive",
      dataSource: "warehouse",
      qualifiedName: "demo.local_stage",
      objectType: "hive_table",
      partitionFields: [],
      ddl: "CREATE TABLE demo.local_stage (stage_a STRING, stage_b STRING);",
      evidenceProvider: "synthetic:test",
      collectedAt: "2026-01-01T00:00:00.000Z",
    });
    writeTaskInput(f.dataRoot, {
      taskId: "1200",
      taskCategory: "sparkIndex",
      taskName: "demo.local.materialization",
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
            "INSERT OVERWRITE TABLE demo.local_stage SELECT src_a AS stage_a, filter_key AS stage_b FROM demo.extra; SELECT stage_a AS out_a, stage_b AS out_b FROM demo.local_stage;",
          evidenceProvider: "synthetic:test",
        },
      },
      evidenceProvider: "synthetic:test",
      collectedAt: "2026-01-01T00:00:00.000Z",
    });
    runInputPackMachineFacts({
      dataRoot: f.dataRoot,
      taskIds: ["1200"],
      outputRoot: f.factsRoot,
    });

    const artifact = reconcileFieldLineage({
      dataRoot: f.dataRoot,
      factsRoot: f.factsRoot,
      tableLineage: {
        ...syntheticTableLineage(),
        rootTaskId: "1200",
        taskNodes: [
          {
            taskId: "1200",
            upstreamDecision: { primary: [], additional: [], unknown: [] },
          },
        ],
        producerBridges: [],
      },
      rootTaskId: "1200",
      rootTable: "demo.root",
      rootFields: ["out_a"],
      factsPolicy: "allow-legacy-partial",
      maxDepth: 8,
      maxStates: 100,
      maxPaths: 100,
    });
    expect(artifact.nodes.some(
      (node) =>
        node.field.identityStatus === "TASK_LOCAL_SCHEMA_BACKED" &&
        node.field.qualifiedName === "demo.local_stage" &&
        node.field.column === "stage_a",
    )).toBe(true);
    expect(artifact.nodes.some(
      (node) =>
        node.field.identityStatus === "SCHEMA_BACKED" &&
        node.field.qualifiedName === "demo.extra" &&
        node.field.column === "src_a",
    )).toBe(true);
    expect(artifact.candidates).toHaveLength(0);
    expect(artifact.gaps).toHaveLength(0);
    expect(artifact.edges.some((edge) => edge.producerTaskId === "1200")).toBe(
      false,
    );
    expect(validateFieldLineageArtifact(artifact)).toEqual([]);
  });

  it("bridges a bare-name Task-local materialization and keeps it attached to its preceding write", () => {
    const parent = mkdtempSync(join(tmpdir(), "field-lineage-task-local-schema-"));
    const dataRoot = join(parent, "data");
    const factsRoot = join(parent, "facts");
    for (const table of [
      { qualifiedName: "pdata_n.root", columns: "out_a STRING" },
      { qualifiedName: "pdata_n.source", columns: "src_a STRING" },
      { qualifiedName: "pdata_n.raw", columns: "raw_a STRING" },
    ])
      writeTableInput(dataRoot, {
        platform: "hive",
        dataSource: "warehouse",
        qualifiedName: table.qualifiedName,
        objectType: "hive_table",
        partitionFields: [],
        ddl: `CREATE TABLE ${table.qualifiedName} (${table.columns});`,
        evidenceProvider: "synthetic:test",
        collectedAt: "2026-01-01T00:00:00.000Z",
      });
    writeTaskInput(dataRoot, {
      taskId: "100",
      taskCategory: "hiveTask",
      taskName: "pdata_n.root",
      target: {
        platform: "hive",
        dataSource: "warehouse",
        qualifiedName: "pdata_n.root",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
      partition: null,
      sql: {
        query: {
          content:
            "INSERT OVERWRITE TABLE otc_div_temp SELECT s.src_a AS allo_prop_3 FROM pdata_n.source s; SELECT t.allo_prop_3 AS out_a FROM otc_div_temp t;",
          evidenceProvider: "synthetic:test",
        },
      },
      evidenceProvider: "synthetic:test",
      collectedAt: "2026-01-01T00:00:00.000Z",
    });
    writeTaskInput(dataRoot, {
      taskId: "200",
      taskCategory: "hiveTask",
      taskName: "pdata_n.source.task",
      target: {
        platform: "hive",
        dataSource: "warehouse",
        qualifiedName: "pdata_n.source",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
      partition: null,
      sql: {
        query: {
          content: "INSERT OVERWRITE TABLE pdata_n.source SELECT raw_a AS src_a FROM pdata_n.raw;",
          evidenceProvider: "synthetic:test",
        },
      },
      evidenceProvider: "synthetic:test",
      collectedAt: "2026-01-01T00:00:00.000Z",
    });
    runInputPackMachineFacts({
      dataRoot,
      taskIds: ["100", "200"],
      outputRoot: factsRoot,
    });

    const artifact = reconcileFieldLineage({
      dataRoot,
      factsRoot,
      tableLineage: syntheticTableLineageWithFacts(factsRoot, {
        ...syntheticTableLineage(),
        rootTaskId: "100",
        taskNodes: [
          {
            taskId: "100",
            upstreamDecision: { primary: ["200"], additional: [], unknown: [] },
          },
          {
            taskId: "200",
            upstreamDecision: { primary: [], additional: [], unknown: [] },
          },
        ],
        producerBridges: [
          {
            consumerTaskId: "100",
            producerTaskId: "200",
            table: {
              platform: "hive",
              dataSource: "warehouse",
              qualifiedName: "pdata_n.source",
            },
          },
        ],
      }),
      rootTaskId: "100",
      rootTable: "pdata_n.root",
      rootFields: ["out_a"],
      factsPolicy: "allow-legacy-partial",
      maxDepth: 8,
      maxStates: 100,
      maxPaths: 100,
    });

    expect(
      artifact.nodes.some(
        (node) =>
          node.field.qualifiedName === "pdata_n.source" &&
          node.field.column === "src_a",
      ),
    ).toBe(true);
    expect(
      artifact.nodes.some(
        (node) =>
          node.field.qualifiedName === "otc_div_temp" &&
          node.field.column === "allo_prop_3" &&
          node.bindingId === "output-binding:100:task:100:slot:query:statement:0:0" &&
          node.expressionText?.includes("s.src_a AS allo_prop_3"),
      ),
    ).toBe(true);
    expect(
      artifact.edges.some(
        (edge) =>
          edge.mapping === "src_a -> allo_prop_3" &&
          edge.toNodeId.includes("output-binding:100:task:100:slot:query:statement:0:0"),
      ),
    ).toBe(true);
    expect(artifact.nodes.some((node) => node.taskId === "200")).toBe(true);
    expect(artifact.edges.some((edge) => edge.producerTaskId === "200")).toBe(true);
    expect(validateFieldLineageArtifact(artifact)).toEqual([]);
  });

  it("connects a pre-bound Task-local materialization to an external producer path", () => {
    const f = fixture();
    writeTableInput(f.dataRoot, {
      platform: "hive",
      dataSource: "warehouse",
      qualifiedName: "demo.local_stage",
      objectType: "hive_table",
      partitionFields: [],
      ddl: "CREATE TABLE demo.local_stage (stage_a STRING, stage_b STRING);",
      evidenceProvider: "synthetic:test",
      collectedAt: "2026-01-01T00:00:00.000Z",
    });
    writeTaskInput(f.dataRoot, {
      taskId: "1200",
      taskCategory: "sparkIndex",
      taskName: "demo.local.materialization.consumer",
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
            "INSERT OVERWRITE TABLE demo.local_stage SELECT src_a AS stage_a, filter_key AS stage_b FROM demo.extra; SELECT stage_a AS out_a, stage_b AS out_b FROM demo.local_stage;",
          evidenceProvider: "synthetic:test",
        },
      },
      evidenceProvider: "synthetic:test",
      collectedAt: "2026-01-01T00:00:00.000Z",
    });
    writeTaskInput(f.dataRoot, {
      taskId: "1300",
      taskCategory: "hiveTask",
      taskName: "demo.extra.producer",
      target: {
        platform: "hive",
        dataSource: "warehouse",
        qualifiedName: "demo.extra",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
      partition: null,
      sql: {
        query: {
          content: "SELECT src_a FROM demo.source;",
          evidenceProvider: "synthetic:test",
        },
      },
      evidenceProvider: "synthetic:test",
      collectedAt: "2026-01-01T00:00:00.000Z",
    });
    runInputPackMachineFacts({
      dataRoot: f.dataRoot,
      taskIds: ["1200", "1300"],
      outputRoot: f.factsRoot,
    });

    const artifact = reconcileFieldLineage({
      dataRoot: f.dataRoot,
      factsRoot: f.factsRoot,
      tableLineage: syntheticTableLineageWithFacts(f.factsRoot, {
        ...syntheticTableLineage(),
        rootTaskId: "1200",
        taskNodes: [
          {
            taskId: "1200",
            upstreamDecision: { primary: ["1300"], additional: [], unknown: [] },
          },
          {
            taskId: "1300",
            upstreamDecision: { primary: [], additional: [], unknown: [] },
          },
        ],
        producerBridges: [
          {
            consumerTaskId: "1200",
            producerTaskId: "1300",
            table: {
              platform: "hive",
              dataSource: "warehouse",
              qualifiedName: "demo.extra",
            },
          },
        ],
      }),
      rootTaskId: "1200",
      rootTable: "demo.root",
      rootFields: ["out_a"],
      factsPolicy: "allow-legacy-partial",
      maxDepth: 8,
      maxStates: 100,
      maxPaths: 100,
    });

    const reverse = new Map<string, string[]>();
    for (const edge of artifact.edges) {
      const incoming = reverse.get(edge.toNodeId) ?? [];
      incoming.push(edge.fromNodeId);
      reverse.set(edge.toNodeId, incoming);
    }
    const reachable = new Set<string>();
    const pending = [...artifact.rootNodeIds];
    while (pending.length > 0) {
      const nodeId = pending.pop()!;
      if (reachable.has(nodeId)) continue;
      reachable.add(nodeId);
      pending.push(...(reverse.get(nodeId) ?? []));
    }
    const reachableTasks = new Set(
      artifact.nodes
        .filter((node) => reachable.has(node.nodeId))
        .map((node) => node.taskId),
    );
    const localBridgeEdges = artifact.edges.filter((edge) => {
      const from = artifact.nodes.find((node) => node.nodeId === edge.fromNodeId);
      const to = artifact.nodes.find((node) => node.nodeId === edge.toNodeId);
      return (
        from?.taskId === "1200" &&
        from.bindingId !== null &&
        from.field.qualifiedName === "demo.local_stage" &&
        from.field.column === "stage_a" &&
        to?.taskId === "1200" &&
        to.field.qualifiedName === "demo.local_stage" &&
        to.field.column === "stage_a"
      );
    });

    expect(localBridgeEdges).toHaveLength(1);
    expect(localBridgeEdges[0]!.fromNodeId).toMatch(/^field-node:/);
    expect(localBridgeEdges[0]!.toNodeId).toMatch(/^field-source-node:/);
    expect(
      new Set(artifact.edges.map((edge) => edge.edgeId)).size,
    ).toBe(artifact.edges.length);
    expect(artifact.nodes.some((node) => node.taskId === "1300")).toBe(true);
    expect(reachableTasks).toContain("1300");
    expect(
      artifact.edges.some(
        (edge) => edge.producerTaskId === "1300" && reachable.has(edge.toNodeId),
      ),
    ).toBe(true);
    expect(validateFieldLineageArtifact(artifact)).toEqual([]);

    const disconnectedNode = {
      ...artifact.nodes[0]!,
      nodeId: "field-node:disconnected",
      taskId: "9900",
      taskName: "disconnected.producer",
    };
    const disconnectedEdge = {
      ...artifact.edges[0]!,
      edgeId: "value-edge:disconnected",
      fromNodeId: disconnectedNode.nodeId,
      toNodeId: disconnectedNode.nodeId,
      consumerTaskId: "9900",
      producerTaskId: "9900",
    };
    const summary = formatFieldLineageSummary({
      ...artifact,
      nodes: [...artifact.nodes, disconnectedNode],
      edges: [...artifact.edges, disconnectedEdge],
    });
    expect(summary).not.toContain("9900");
  });

  it("anchors a root to an explicit SQL write when it differs from the platform target", () => {
    const f = fixture();
    writeTableInput(f.dataRoot, {
      platform: "hive",
      dataSource: "warehouse",
      qualifiedName: "demo.formal_root",
      objectType: "hive_table",
      partitionFields: [],
      ddl: "CREATE TABLE demo.formal_root (out_a STRING, out_b STRING);",
      evidenceProvider: "synthetic:test",
      collectedAt: "2026-01-01T00:00:00.000Z",
    });
    writeTaskInput(f.dataRoot, {
      taskId: "1400",
      taskCategory: "hiveTask",
      taskName: "demo.platform.target.with.formal.write",
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
            "INSERT OVERWRITE TABLE demo.formal_root SELECT src_a AS out_a, src_a AS out_b FROM demo.extra;",
          evidenceProvider: "synthetic:test",
        },
      },
      evidenceProvider: "synthetic:test",
      collectedAt: "2026-01-01T00:00:00.000Z",
    });
    runInputPackMachineFacts({
      dataRoot: f.dataRoot,
      taskIds: ["1400"],
      outputRoot: f.factsRoot,
    });

    const artifact = reconcileFieldLineage({
      dataRoot: f.dataRoot,
      factsRoot: f.factsRoot,
      tableLineage: {
        ...syntheticTableLineage(),
        rootTaskId: "1400",
        taskNodes: [
          {
            taskId: "1400",
            upstreamDecision: { primary: [], additional: [], unknown: [] },
          },
        ],
        producerBridges: [],
      },
      rootTaskId: "1400",
      rootTable: "demo.formal_root",
      rootWriteObservationIds: ["write-observation:1400:0"],
      rootFields: ["out_a"],
      factsPolicy: "allow-legacy-partial",
      maxDepth: 8,
      maxStates: 100,
      maxPaths: 100,
    });

    expect(artifact.request.rootWriteObservationIds).toEqual([
      "write-observation:1400:0",
    ]);
    expect(artifact.rootNodeIds).toHaveLength(1);
    expect(
      artifact.nodes.some(
        (node) =>
          node.field.qualifiedName === "demo.formal_root" &&
          node.field.column === "out_a",
      ),
    ).toBe(true);
    expect(artifact.gaps).toHaveLength(0);
    expect(validateFieldLineageArtifact(artifact)).toEqual([]);
  });

  it("does not guess a formal root when the target has multiple SQL writes", () => {
    const f = fixture();
    writeTableInput(f.dataRoot, {
      platform: "hive",
      dataSource: "warehouse",
      qualifiedName: "demo.formal_root",
      objectType: "hive_table",
      partitionFields: [],
      ddl: "CREATE TABLE demo.formal_root (out_a STRING, out_b STRING);",
      evidenceProvider: "synthetic:test",
      collectedAt: "2026-01-01T00:00:00.000Z",
    });
    writeTaskInput(f.dataRoot, {
      taskId: "1401",
      taskCategory: "hiveTask",
      taskName: "demo.ambiguous.formal.writes",
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
            "INSERT OVERWRITE TABLE demo.formal_root SELECT src_a AS out_a, src_a AS out_b FROM demo.extra; INSERT OVERWRITE TABLE demo.formal_root SELECT src_a AS out_a, src_a AS out_b FROM demo.extra;",
          evidenceProvider: "synthetic:test",
        },
      },
      evidenceProvider: "synthetic:test",
      collectedAt: "2026-01-01T00:00:00.000Z",
    });
    runInputPackMachineFacts({
      dataRoot: f.dataRoot,
      taskIds: ["1401"],
      outputRoot: f.factsRoot,
    });
    expect(() =>
      reconcileFieldLineage({
        dataRoot: f.dataRoot,
        factsRoot: f.factsRoot,
        tableLineage: {
          ...syntheticTableLineage(),
          rootTaskId: "1401",
          taskNodes: [
            {
              taskId: "1401",
              upstreamDecision: { primary: [], additional: [], unknown: [] },
            },
          ],
          producerBridges: [],
        },
        rootTaskId: "1401",
        rootTable: "demo.formal_root",
        rootFields: ["out_a"],
        factsPolicy: "allow-legacy-partial",
        maxDepth: 8,
        maxStates: 100,
        maxPaths: 100,
      }),
    ).toThrow(/ROOT_WRITE_OBSERVATION_REQUIRED|ROOT_WRITE_OBSERVATION_NOT_FOUND/);
  });

  it("keeps zipper LEFT refs off internal_trade_id VALUE_FLOW and on 105387 JOIN controls", () => {
    const parent = mkdtempSync(join(tmpdir(), "field-lineage-zipper-"));
    const dataRoot = join(parent, "data");
    const factsRoot = join(parent, "facts");
    const zipperTables = [
      "demo.d_ref_fx_forward",
      "demo.d_ref_fast_trs",
      "demo.d_ref_otc_option_deal",
      "demo.d_ref_trs",
    ];
    for (const table of [
      { qualifiedName: "demo.audit_log", columns: "internal_trade_id STRING, entity_id STRING" },
      { qualifiedName: "demo.stati", columns: "internal_trade_id STRING, stati_cont_desc STRING" },
      { qualifiedName: "demo.audit", columns: "entity_id STRING" },
      { qualifiedName: "demo.audit_src", columns: "entity_id STRING" },
      { qualifiedName: "demo.raw_audit", columns: "entity_id STRING" },
      { qualifiedName: "demo.trades", columns: "internal_trade_id STRING, k STRING, v STRING" },
      { qualifiedName: "demo.raw_trades", columns: "internal_trade_id STRING, k STRING, v STRING" },
      ...zipperTables.map((qualifiedName) => ({
        qualifiedName,
        columns: "k STRING, v STRING",
      })),
    ])
      writeTableInput(dataRoot, {
        platform: "hive",
        dataSource: "warehouse",
        qualifiedName: table.qualifiedName,
        objectType: "hive_table",
        partitionFields: [],
        ddl: `CREATE TABLE ${table.qualifiedName} (${table.columns});`,
        evidenceProvider: "synthetic:test",
        collectedAt: "2026-01-01T00:00:00.000Z",
      });
    writeTaskInput(dataRoot, {
      taskId: "155015",
      taskCategory: "sparkIndex",
      taskName: "demo.audit_log.task",
      target: {
        platform: "hive",
        dataSource: "warehouse",
        qualifiedName: "demo.audit_log",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
      partition: null,
      sql: {
        query: {
          content:
            "SELECT s.internal_trade_id AS internal_trade_id, a.entity_id AS entity_id FROM demo.stati s JOIN demo.audit a ON s.internal_trade_id = a.entity_id",
          evidenceProvider: "synthetic:test",
        },
      },
      evidenceProvider: "synthetic:test",
      collectedAt: "2026-01-01T00:00:00.000Z",
    });
    writeTaskInput(dataRoot, {
      taskId: "105387",
      taskCategory: "sparkIndex",
      taskName: "demo.stati.zipper",
      target: {
        platform: "hive",
        dataSource: "warehouse",
        qualifiedName: "demo.stati",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
      partition: null,
      sql: {
        query: {
          content:
            "INSERT OVERWRITE TABLE demo.stati SELECT t.internal_trade_id AS internal_trade_id, CASE WHEN r1.k IS NOT NULL THEN r1.v ELSE t.v END AS stati_cont_desc FROM demo.trades t LEFT JOIN demo.d_ref_fx_forward r1 ON t.k = r1.k LEFT JOIN demo.d_ref_fast_trs r2 ON t.k = r2.k LEFT JOIN demo.d_ref_otc_option_deal r3 ON t.k = r3.k LEFT JOIN demo.d_ref_trs r4 ON t.k = r4.k",
          evidenceProvider: "synthetic:test",
        },
      },
      evidenceProvider: "synthetic:test",
      collectedAt: "2026-01-01T00:00:00.000Z",
    });
    writeTaskInput(dataRoot, {
      taskId: "114026",
      taskCategory: "sparkIndex",
      taskName: "demo.audit.task",
      target: {
        platform: "hive",
        dataSource: "warehouse",
        qualifiedName: "demo.audit",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
      partition: null,
      sql: {
        query: {
          content: "INSERT OVERWRITE TABLE demo.audit SELECT src.entity_id AS entity_id FROM demo.audit_src src",
          evidenceProvider: "synthetic:test",
        },
      },
      evidenceProvider: "synthetic:test",
      collectedAt: "2026-01-01T00:00:00.000Z",
    });
    writeTaskInput(dataRoot, {
      taskId: "112715",
      taskCategory: "sparkIndex",
      taskName: "demo.audit_src.task",
      target: {
        platform: "hive",
        dataSource: "warehouse",
        qualifiedName: "demo.audit_src",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
      partition: null,
      sql: {
        query: {
          content: "INSERT OVERWRITE TABLE demo.audit_src SELECT src.entity_id AS entity_id FROM demo.raw_audit src",
          evidenceProvider: "synthetic:test",
        },
      },
      evidenceProvider: "synthetic:test",
      collectedAt: "2026-01-01T00:00:00.000Z",
    });
    writeTaskInput(dataRoot, {
      taskId: "71698",
      taskCategory: "sparkIndex",
      taskName: "demo.trades.task",
      target: {
        platform: "hive",
        dataSource: "warehouse",
        qualifiedName: "demo.trades",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
      partition: null,
      sql: {
        query: {
          content:
            "INSERT OVERWRITE TABLE demo.trades SELECT src.internal_trade_id AS internal_trade_id, src.k AS k, src.v AS v FROM demo.raw_trades src",
          evidenceProvider: "synthetic:test",
        },
      },
      evidenceProvider: "synthetic:test",
      collectedAt: "2026-01-01T00:00:00.000Z",
    });
    runInputPackMachineFacts({
      dataRoot,
      taskIds: ["155015", "105387", "114026", "112715", "71698"],
      outputRoot: factsRoot,
    });
    const hive = { platform: "hive", dataSource: "warehouse" };
    const artifact = reconcileFieldLineage({
      dataRoot,
      factsRoot,
      tableLineage: syntheticTableLineageWithFacts(factsRoot, {
        ...syntheticTableLineage(),
        rootTaskId: "155015",
        taskNodes: [
          {
            taskId: "155015",
            upstreamDecision: { primary: ["114026", "105387"], additional: [], unknown: [] },
          },
          {
            taskId: "114026",
            upstreamDecision: { primary: ["112715"], additional: [], unknown: [] },
          },
          {
            taskId: "105387",
            upstreamDecision: { primary: ["71698"], additional: [], unknown: [] },
          },
          {
            taskId: "112715",
            upstreamDecision: { primary: [], additional: [], unknown: [] },
          },
          {
            taskId: "71698",
            upstreamDecision: { primary: [], additional: [], unknown: [] },
          },
        ],
        producerBridges: [
          {
            consumerTaskId: "155015",
            producerTaskId: "114026",
            table: { ...hive, qualifiedName: "demo.audit" },
          },
          {
            consumerTaskId: "155015",
            producerTaskId: "105387",
            table: { ...hive, qualifiedName: "demo.stati" },
          },
          {
            consumerTaskId: "114026",
            producerTaskId: "112715",
            table: { ...hive, qualifiedName: "demo.audit_src" },
          },
          {
            consumerTaskId: "105387",
            producerTaskId: "71698",
            table: { ...hive, qualifiedName: "demo.trades" },
          },
        ],
      }),
      rootTaskId: "155015",
      rootTable: "demo.audit_log",
      rootFields: ["internal_trade_id", "entity_id"],
      factsPolicy: "current-only",
      maxDepth: 8,
      maxStates: 100,
      maxPaths: 100,
    });
    const zipperName = (qualifiedName: string): boolean =>
      zipperTables.some((table) => qualifiedName.includes(table.split(".").at(-1)!));
    const walkTasks = (rootColumn: string): string[] => {
      const pending = artifact.nodes
        .filter((node) => node.taskId === "155015" && node.field.column === rootColumn)
        .map((node) => node.nodeId);
      const seen = new Set<string>();
      const tasks = new Set<string>();
      const tables = new Set<string>();
      while (pending.length > 0) {
        const nodeId = pending.pop()!;
        if (seen.has(nodeId)) continue;
        seen.add(nodeId);
        const node = artifact.nodes.find((candidate) => candidate.nodeId === nodeId);
        if (node) {
          tasks.add(node.taskId);
          tables.add(node.field.qualifiedName);
        }
        for (const edge of artifact.edges.filter((candidate) => candidate.toNodeId === nodeId))
          pending.push(edge.fromNodeId);
      }
      return [...tasks].sort();
    };
    const tradeTables = new Set(
      artifact.nodes
        .filter((node) => {
          const pending = [node.nodeId];
          const seen = new Set<string>();
          const roots = new Set(
            artifact.nodes
              .filter((candidate) => candidate.taskId === "155015" && candidate.field.column === "internal_trade_id")
              .map((candidate) => candidate.nodeId),
          );
          while (pending.length > 0) {
            const nodeId = pending.pop()!;
            if (seen.has(nodeId)) continue;
            seen.add(nodeId);
            if (roots.has(nodeId)) return true;
            for (const edge of artifact.edges.filter((candidate) => candidate.fromNodeId === nodeId))
              pending.push(edge.toNodeId);
          }
          return false;
        })
        .map((node) => node.field.qualifiedName),
    );
    expect([...tradeTables].some(zipperName)).toBe(false);
    expect(
      artifact.fieldConditionals.some((item) => item.fields.some((field) => zipperName(field.qualifiedName))),
    ).toBe(false);
    const joinControls = artifact.datasetControls.filter(
      (control) =>
        control.taskId === "105387" &&
        control.subtype === "JOIN" &&
        control.field !== null &&
        zipperName(control.field.qualifiedName),
    );
    expect(new Set(joinControls.map((control) => control.field!.qualifiedName.split(".").at(-1))).size).toBe(4);
    expect(joinControls.every((control) => control.grain === "EXPAND_RISK" || control.grain === "UNKNOWN")).toBe(
      true,
    );
    expect(joinControls.every((control) => control.grain !== "PRESERVE")).toBe(true);
    expect(
      joinControls.every((control) => control.grainReason === "GRAIN_JOIN_NULLABLE_SIDE_MAY_EXPAND"),
    ).toBe(true);
    expect(
      artifact.datasetControls.every(
        (control) =>
          control.grain === "PRESERVE" ||
          (typeof control.grainReason === "string" && control.grainReason.length > 0),
      ),
    ).toBe(true);
    const tradeTasks = walkTasks("internal_trade_id");
    const auditTasks = walkTasks("entity_id");
    expect(tradeTasks).toEqual(expect.arrayContaining(["71698", "105387", "155015"]));
    expect(auditTasks).toEqual(expect.arrayContaining(["112715", "114026", "155015"]));
    expect(validateFieldLineageArtifact(artifact)).toEqual([]);
  });

  it("assigns distinct grainReason codes to INNER JOIN and LEFT JOIN", () => {
    const parent = mkdtempSync(join(tmpdir(), "field-lineage-grain-reason-"));
    const dataRoot = join(parent, "data");
    const factsRoot = join(parent, "facts");
    for (const table of [
      { qualifiedName: "demo.root", columns: "out_a STRING" },
      { qualifiedName: "demo.left_keep", columns: "k STRING, v STRING" },
      { qualifiedName: "demo.inner_side", columns: "k STRING, v STRING" },
      { qualifiedName: "demo.left_side", columns: "k STRING, v STRING" },
    ])
      writeTableInput(dataRoot, {
        platform: "hive",
        dataSource: "warehouse",
        qualifiedName: table.qualifiedName,
        objectType: "hive_table",
        partitionFields: [],
        ddl: `CREATE TABLE ${table.qualifiedName} (${table.columns});`,
        evidenceProvider: "synthetic:test",
        collectedAt: "2026-01-01T00:00:00.000Z",
      });
    writeTaskInput(dataRoot, {
      taskId: "1600",
      taskCategory: "sparkIndex",
      taskName: "demo.root.grain",
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
            "SELECT a.v AS out_a FROM demo.left_keep a INNER JOIN demo.inner_side b ON a.k = b.k LEFT JOIN demo.left_side c ON a.k = c.k",
          evidenceProvider: "synthetic:test",
        },
      },
      evidenceProvider: "synthetic:test",
      collectedAt: "2026-01-01T00:00:00.000Z",
    });
    runInputPackMachineFacts({
      dataRoot,
      taskIds: ["1600"],
      outputRoot: factsRoot,
    });
    const artifact = reconcileFieldLineage({
      dataRoot,
      factsRoot,
      tableLineage: {
        rootTaskId: "1600",
        taskNodes: [
          {
            taskId: "1600",
            upstreamDecision: { primary: [], additional: [], unknown: [] },
          },
        ],
        producerBridges: [],
      },
      rootTaskId: "1600",
      rootTable: "demo.root",
      rootFields: ["out_a"],
      factsPolicy: "current-only",
      maxDepth: 4,
      maxStates: 100,
      maxPaths: 100,
    });
    const joinControls = artifact.datasetControls.filter((control) => control.subtype === "JOIN");
    const innerReasons = new Set(
      joinControls
        .filter((control) => control.field?.qualifiedName === "demo.inner_side")
        .map((control) => control.grainReason),
    );
    const leftReasons = new Set(
      joinControls
        .filter((control) => control.field?.qualifiedName === "demo.left_side")
        .map((control) => control.grainReason),
    );
    expect(innerReasons.size).toBeGreaterThan(0);
    expect(leftReasons.size).toBeGreaterThan(0);
    expect([...innerReasons]).toEqual(["GRAIN_JOIN_CARDINALITY_UNPROVEN"]);
    expect([...leftReasons]).toEqual(["GRAIN_JOIN_NULLABLE_SIDE_MAY_EXPAND"]);
    expect(
      joinControls
        .filter((control) => control.field?.qualifiedName === "demo.inner_side")
        .every((control) => control.grain === "EXPAND_RISK"),
    ).toBe(true);
    expect(joinControls.every((control) => control.grain !== "UNKNOWN")).toBe(true);
    expect(
      artifact.datasetControls.every(
        (control) =>
          control.grain === "PRESERVE" ||
          (typeof control.grainReason === "string" && control.grainReason.length > 0),
      ),
    ).toBe(true);
    expect(validateFieldLineageArtifact(artifact)).toEqual([]);
  });
});
