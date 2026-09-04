import { describe, expect, it } from "vitest";
import {
  buildFieldLineageImpactGraph,
  renderFieldLineageImpactTree,
  renderFieldLineageHtml,
} from "../scripts/visualize/field-lineage-visualize.ts";
import type { FieldLineageArtifact, FieldLineageNode } from "../scripts/reconcile/consumer/field-lineage/field-lineage-contract.ts";

function field(qualifiedName: string, column: string) {
  return {
    platform: "hive",
    dataSource: "gfhive",
    stableTableId: `${qualifiedName}__gfhive`,
    qualifiedName,
    column,
    identityStatus: "SCHEMA_BACKED" as const,
  };
}

function node(
  nodeId: string,
  taskId: string,
  qualifiedName: string,
  column: string,
  depth: number,
): FieldLineageNode {
  return {
    nodeId,
    taskId,
    taskName: `Task ${taskId}`,
    depth,
    field: field(qualifiedName, column),
    bindingId: `output-binding:${taskId}`,
    expressionId: `task:${taskId}:expression:0`,
    expressionText: column,
    evidenceStatus: "CONFIRMED",
  };
}

function artifact(): FieldLineageArtifact {
  const targetId = "field-node:ROOT:target:amount";
  const sourceAId = "field-source-node:UP_A:source:amount_a";
  const sourceBId = "field-source-node:UP_B:source:amount_b";
  const nodes = [
    node(targetId, "ROOT", "dm.target", "amount", 0),
    node(sourceAId, "UP_A", "dm.source_a", "amount_a", 1),
    node(sourceBId, "UP_B", "dm.source_b", "amount_b", 1),
  ];

  return {
    schemaVersion: "1.2.0",
    artifactType: "FIELD_MULTI_HOP_RECONCILIATION",
    generatedAt: "2026-08-27T00:00:00.000Z",
    request: {
      rootTaskId: "ROOT",
      rootTable: "dm.target",
      rootWriteObservationIds: ["write-observation:ROOT:0"],
      rootFields: ["amount"],
      rootFieldSelection: "EXPLICIT",
      factsPolicy: "current-only",
    },
    overallStatus: "COMPLETE",
    rootNodeIds: [targetId],
    nodes,
    edges: [
      {
        edgeId: "edge-a",
        fromNodeId: sourceAId,
        toNodeId: targetId,
        consumerTaskId: "ROOT",
        producerTaskId: "UP_A",
        kind: "VALUE_FLOW",
        mapping: "amount_a -> amount",
        evidenceStatus: "CONFIRMED",
        evidenceRefs: [],
      },
      {
        edgeId: "edge-b",
        fromNodeId: sourceBId,
        toNodeId: targetId,
        consumerTaskId: "ROOT",
        producerTaskId: "UP_B",
        kind: "VALUE_FLOW",
        mapping: "amount_b -> amount",
        evidenceStatus: "CONFIRMED",
        evidenceRefs: [],
      },
    ],
    datasetControls: [],
    fieldConditionals: [],
    candidates: [],
    gaps: [],
    tableEdges: [],
    limits: {
      maxDepth: 25,
      maxStates: 500,
      maxPaths: 1000,
      truncated: false,
      reasons: [],
    },
    counts: {
      nodes: nodes.length,
      edges: 2,
      datasetControls: 0,
      fieldConditionals: 0,
      candidates: 0,
      gaps: 0,
    },
    boundaries: {
      staticSqlOnly: true,
      runtimeExecution: "NOT_EVALUATED",
      dataCorrectness: "NOT_EVALUATED",
      businessAcceptance: "NOT_EVALUATED",
    },
    contentHash: "a".repeat(64),
  };
}

describe("field lineage visualization", () => {
  it("aggregates reachable field references into task and table impact nodes", () => {
    const graph = buildFieldLineageImpactGraph(artifact());

    expect(graph.fieldCount).toBe(1);
    expect(graph.tasks.map((task) => [task.taskId, task.fieldCount])).toEqual([
      ["ROOT", 1],
      ["UP_A", 1],
      ["UP_B", 1],
    ]);
    expect(graph.edges.map((edge) => [edge.fromTaskId, edge.toTaskId])).toEqual([
      ["UP_A", "ROOT"],
      ["UP_B", "ROOT"],
    ]);
    expect(renderFieldLineageImpactTree(graph)).toContain(
      "ROOT:Task ROOT（影响最终字段 1 个）\n├── UP_A:Task UP_A（影响最终字段 1 个）\n└── UP_B:Task UP_B（影响最终字段 1 个）",
    );
  });

  it("renders a collapsed multi-branch overview and keeps route evidence inside details", () => {
    const html = renderFieldLineageHtml(artifact());

    expect(html).toContain("taskGroupHtml(group,field)");
    expect(html).toContain("const confirmedGroups=groupPathsBySemantic(confirmedPaths);");
    expect(html).toContain("const provisionalGroups=groupPathsBySemantic(provisionalPaths);");
    expect(html).toContain("function routeGroupTitle(group)");
    expect(html).toContain("routeGroupTitle(group)");
    expect(html).toContain("return pathTaskChain(first);");
    expect(html).not.toContain("const fieldChain=humanPathNodes(first)");
    expect(html).not.toContain("const routeGroups=groupPathsByTaskChain(paths);");
    expect(html).not.toContain('data-view="code"');
    expect(html).not.toContain('id="code-view"');
    expect(html).not.toContain("代码证据");
    expect(html).not.toContain("CODE_FLOW");
    expect(html).not.toContain("task-code");
    expect(html).not.toContain("highlightSql");
    expect(html).toContain("影响范围");
    expect(html).toContain("调度影响范围");
    expect(html).toContain("链路总览");
    expect(html).toContain('id="impact-tree-stats"');
    expect(html).toContain("impactTreeStatsRows");
    expect(html).toContain("调度任务（含根）");
    expect(html).toContain("上游调度");
    expect(html).toContain("调度边（上游 → 下游）");
    expect(html).toContain("影响最终字段");
    expect(html).not.toContain("相关 ROWSET_CONTROL");
    expect(html).toContain("DATASET_CONTROL");
    expect(html).toContain('"datasetControls":[]');
    expect(html).not.toContain("影响表数");
    expect(html).toContain("const IMPACT=");
    expect(html).toContain('class="impact-card-name" title="');
    const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
    expect(script).toBeDefined();
    expect(() => new Function(script ?? "")).not.toThrow();
    expect(html).toContain("当前字段的多分支汇聚");
    expect(html).toContain("max-height:calc(100vh - 28px)");
    expect(html).toContain("overflow-y:auto");
    expect(html).toContain("min-width:0;max-width:100%;width:100%;overflow-x:auto");
    expect(html).toContain('class="lineage-overview"');
    expect(html).toContain("confirmedGroups.length+' 条确认分支");
    expect(html).toContain("临时 / 历史证据");
    expect(html).toContain("const className=provisional?'branch-detail provisional':'branch-detail';");
    expect(html).toContain("确认分支 ");
    expect(html).toContain("临时证据 ");
    expect(html).toContain("查看技术证据（'+group.paths.length+' 条）");
    expect(html).not.toContain('<details class="branch-detail" open>');
  });

  it("keeps a confirmed no-input expression out of UNRESOLVED", () => {
    const base = artifact();
    const target = {
      ...base.nodes[0]!,
      inputDependencyStatus: "DERIVED_OUTPUT" as const,
    };
    const constantArtifact: FieldLineageArtifact = {
      ...base,
      nodes: [target],
      rootNodeIds: [target.nodeId],
      edges: [],
      counts: { ...base.counts, nodes: 1, edges: 0 },
    };
    const html = renderFieldLineageHtml(constantArtifact);

    expect(html).toContain("function branchStatus(paths)");
    expect(html).toContain("NO_PHYSICAL_INPUT（常量/系统值，无上游字段）");
    expect(html).toContain("nodeStatuses.join('、')||'UNRESOLVED'");
  });
});
