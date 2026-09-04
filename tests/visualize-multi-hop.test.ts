import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  renderMultiHopHtml,
  resolveMultiHopArtifactPath,
  visualizeMultiHop,
  type MultiHopArtifact,
} from "../scripts/visualize/multi-hop-visualize.ts";
import { buildMultiHopVizModel } from "../scripts/visualize/multi-hop-viz-model.ts";

function artifact(): MultiHopArtifact {
  return {
    artifactType: "TABLE_MULTI_HOP_RECONCILIATION",
    rootTaskId: "ROOT",
    generatedAt: "2026-08-26T00:00:00.000Z",
    taskNodes: [
      {
        taskId: "ROOT",
        minDepth: 0,
        expansionStatus: "EXPANDED",
        taskInputPackStatus: "TASK_INPUT_PACK_AVAILABLE",
        taskContentHash: null,
        evidence: [],
        upstreamDecision: null,
      },
      {
        taskId: "PRODUCER",
        minDepth: 1,
        expansionStatus: "TERMINAL",
        taskInputPackStatus: null,
        taskContentHash: null,
        evidence: [],
        upstreamDecision: null,
      },
    ],
    tableNodes: [
      {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "dm.orders_source",
        identityStatus: "RESOLVED",
      },
    ],
    readEdges: [
      {
        consumerTaskId: "ROOT",
        table: {
          platform: "hive",
          dataSource: "gfhive",
          qualifiedName: "dm.orders_source",
          identityStatus: "RESOLVED",
        },
        recursionStatus: "ELIGIBLE",
      },
    ],
    writeEdges: [
      {
        producerTaskId: "PRODUCER",
        table: {
          platform: "hive",
          dataSource: "gfhive",
          qualifiedName: "dm.orders_source",
          identityStatus: "RESOLVED",
        },
        writes: [
          {
            partitionStatus: "COMPLETE",
            partition: [
              {
                field: "dt",
                expression: "2026-08-26",
                observedValue: "2026-08-26",
                valueStatus: "OBSERVED_RENDERED_VALUE",
              },
            ],
          },
          {
            partitionStatus: "COMPLETE",
            partition: [
              {
                field: "dt",
                expression: "2026-08-26",
                observedValue: "2026-08-26",
                valueStatus: "OBSERVED_RENDERED_VALUE",
              },
            ],
          },
        ],
      },
    ],
    producerBridges: [
      {
        consumerTaskId: "ROOT",
        producerTaskId: "PRODUCER",
        table: {
          platform: "hive",
          dataSource: "gfhive",
          qualifiedName: "dm.orders_source",
          identityStatus: "RESOLVED",
        },
        producerDepth: 1,
      },
    ],
    scheduleEdges: [],
    terminals: [
      { taskId: "PRODUCER", depth: 1, reason: "CYCLE" },
    ],
    coverage: { status: "COMPLETE_OBSERVED_EVIDENCE" },
    limits: { maxDepth: 2, truncationReason: null },
    counts: { taskNodes: 2, tableNodes: 1, readEdges: 1 },
    boundaries: { staticSqlOnly: true },
    contentHash: "a".repeat(64),
  };
}

describe("multi-hop visualization", () => {
  it("renders one unified table, task and partition node instead of separate task cards", () => {
    const html = renderMultiHopHtml(artifact());

    expect(html).toContain('"rootTaskId":"ROOT"');
    expect(html).toContain("dm.orders_source");
    expect(html).toContain("每个节点 = 物理表 + 调度 ID + 对应分区");
    expect(html).toContain("同一物理表的多个调度合并在节点内");
    expect(html).toContain("CYCLE");
    expect(html).toContain("调度：");
    expect(html).toContain("分区：");
    expect(html).toContain("drawLineage();");
    expect(html).not.toContain("调度任务（含关联表）");
    expect(html).not.toContain("蓝色箭头");
    expect(html).not.toContain("原始证据");
    expect(html).toContain('id="graph"');
  });

  it("aggregates one physical table by producer task and keeps partition rows", () => {
    const model = buildMultiHopVizModel(artifact() as unknown as Record<string, unknown>);
    const table = model.lineageNodes.find(
      (node) => node.qualifiedName === "dm.orders_source",
    ) as Record<string, unknown>;
    const producerGroups = table.producerGroups as Array<Record<string, unknown>>;
    const partitions = producerGroups[0].partitions as Array<Record<string, unknown>>;
    expect(partitions[0]).toMatchObject({
      status: "COMPLETE",
      display: "dt=2026-08-26",
    });
    expect(partitions).toHaveLength(1);
    expect(model.lineageNodes).toHaveLength(2);
    expect(model.lineageNodes).toContainEqual(
      expect.objectContaining({
        nodeType: "TABLE_TASK",
        qualifiedName: "dm.orders_source",
        producerTaskIds: ["PRODUCER"],
      }),
    );
    expect(model.lineageNodes).toContainEqual(
      expect.objectContaining({
        nodeType: "UNKNOWN_OUTPUT",
        qualifiedName: "产出表未确认",
        producerTaskIds: ["ROOT"],
      }),
    );
    expect(model.lineageEdges).toContainEqual(
      expect.objectContaining({
        fromNodeId: "table:hive|gfhive|dm.orders_source",
        toNodeId: "unknown-output:ROOT",
        viaTaskId: "ROOT",
      }),
    );
  });

  it("wraps long physical table names without truncating the identifier", () => {
    const html = renderMultiHopHtml(artifact());

    expect(html).toContain("splitFull(item.qualifiedName,48)");
    expect(html).not.toContain("short(item.qualifiedName");
    expect(html).toContain("lineY+=18");
  });

  it("surfaces configured definition-table boundaries instead of calling them missing producers", () => {
    const definitionTable = {
      platform: "hive",
      dataSource: "gfhive",
      qualifiedName: "dm_index_n.grp_def",
      identityStatus: "RESOLVED",
    };
    const definitionArtifact: MultiHopArtifact = {
      ...artifact(),
      tableNodes: [definitionTable],
      readEdges: [
        {
          consumerTaskId: "ROOT",
          table: definitionTable,
          recursionStatus: "ELIGIBLE",
        },
      ],
      writeEdges: [],
      producerBridges: [],
      terminals: [
        {
          taskId: "ROOT",
          depth: 0,
          reason: "REFERENCE_CONFIG",
          table: definitionTable,
          detail: { role: "REFERENCE_CONFIG", configVersion: "1.0.0" },
        },
      ],
    };
    const model = buildMultiHopVizModel(
      definitionArtifact as unknown as Record<string, unknown>,
    );
    expect(model.lineageNodes[0]).toMatchObject({
      qualifiedName: "dm_index_n.grp_def",
      terminalReasons: ["REFERENCE_CONFIG"],
      terminalBoundary: "REFERENCE_CONFIG",
    });
    expect(renderMultiHopHtml(definitionArtifact)).toContain(
      "定义/参考表 · 已停止溯源",
    );
  });

  it("resolves one artifact by task ID and writes an HTML file", () => {
    const root = mkdtempSync(join(tmpdir(), "sql-lineage-visualize-"));
    const artifactPath = join(root, "reconcile-multi-ROOT.json");
    writeFileSync(artifactPath, `${JSON.stringify(artifact())}\n`, "utf8");

    expect(resolveMultiHopArtifactPath({ taskId: "ROOT", artifactDir: root })).toBe(
      artifactPath,
    );
    const output = visualizeMultiHop({ taskId: "ROOT", artifactDir: root });

    expect(output).toBe(join(root, "multi-hop-ROOT.html"));
    expect(readFileSync(output, "utf8")).toContain("dm.orders_source");
  });

  it("does not place a raw closing script tag into embedded JSON", () => {
    const unsafe: MultiHopArtifact = {
      ...artifact(),
      tableNodes: [
      {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "x</script><script>alert(1)</script>",
        identityStatus: "RESOLVED",
      },
      ],
    };

    expect(renderMultiHopHtml(unsafe)).not.toContain("</script><script>");
  });
});
