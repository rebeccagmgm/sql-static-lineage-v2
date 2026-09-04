import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runInputPackMachineFacts } from "../../../scripts/machine-facts/input-pack-machine-facts.ts";
import {
  writeTableInput,
  writeTaskInput,
} from "../../../scripts/input/shared/input-pack.ts";
import {
  projectTaskLocal,
  resolveTaskLocalReadOccurrenceIdentities,
} from "../../../scripts/project-graph/task-local/project-task-local.ts";

function setupZipper105387(): { dataRoot: string; factsRoot: string } {
  const parent = mkdtempSync(join(tmpdir(), "task-local-zipper-"));
  const dataRoot = join(parent, "data");
  const factsRoot = join(parent, "facts");
  const zipperTables = [
    "demo.d_ref_fx_forward",
    "demo.d_ref_fast_trs",
    "demo.d_ref_otc_option_deal",
    "demo.d_ref_trs",
  ];
  for (const table of [
    { qualifiedName: "demo.stati", columns: "internal_trade_id STRING, stati_cont_desc STRING" },
    { qualifiedName: "demo.trades", columns: "internal_trade_id STRING, k STRING, v STRING" },
    { qualifiedName: "demo.raw_trades", columns: "internal_trade_id STRING, k STRING, v STRING" },
    ...zipperTables.map((qualifiedName) => ({
      qualifiedName,
      columns: "k STRING, v STRING",
    })),
  ]) {
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
  }
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
    taskIds: ["105387", "71698"],
    outputRoot: factsRoot,
  });
  return { dataRoot, factsRoot };
}

describe("projectTaskLocal", () => {
  it("recovers a canonical read occurrence from exact relation evidence", () => {
    const occurrenceId = "task:102845:statement:0:relation:root.read.ref_option_deal_pr";
    const result = resolveTaskLocalReadOccurrenceIdentities({
      taskId: "102845",
      qualifiedName: "titans_dm.ref_option_deal_pr",
      read: {
        direction: "READ",
        physical_dataset: "titans_dm.ref_option_deal_pr",
        statement_id: "task:102845:slot:query:statement:0",
        task_id: "102845",
      },
      relationRecords: [{
        relation_id: occurrenceId,
        relation_type: "read",
        relation: {
          id: occurrenceId,
          table: "TITANS_DM.REF_OPTION_DEAL_PR",
          type: "read",
        },
        statement_id: "task:102845:slot:query:statement:0",
        task_id: "102845",
      }],
    });

    expect(result).toEqual([{ occurrenceId, relationId: occurrenceId }]);
  });

  it("matches an unqualified dataset read to the same unqualified relation evidence", () => {
    const occurrenceId = "task:106661:statement:3:relation:root.setop.b0.read.t03_agt_clas_h";
    const result = resolveTaskLocalReadOccurrenceIdentities({
      taskId: "106661",
      qualifiedName: "pdata_n.t03_agt_clas_h",
      read: {
        direction: "READ",
        physical_dataset: "t03_agt_clas_h",
        statement_id: "task:106661:slot:query:statement:0",
        task_id: "106661",
      },
      relationRecords: [{
        relation_id: occurrenceId,
        relation_type: "read",
        relation: { table: "T03_AGT_CLAS_H", type: "read" },
        statement_id: "task:106661:slot:query:statement:0",
        task_id: "106661",
      }],
    });

    expect(result).toEqual([{ occurrenceId, relationId: occurrenceId }]);
  });

  it("keeps the legacy fallback when relation evidence is not unique", () => {
    const result = resolveTaskLocalReadOccurrenceIdentities({
      taskId: "102845",
      qualifiedName: "titans_dm.ref_option_deal_pr",
      read: {
        direction: "READ",
        physical_dataset: "titans_dm.ref_option_deal_pr",
        statement_id: "task:102845:slot:query:statement:0",
        task_id: "102845",
        read_occurrences: [{ relation_id: "missing-relation-id" }],
      },
      relationRecords: [
        {
          relation_id: "task:102845:statement:0:relation:root.a",
          relation_type: "read",
          relation: { table: "TITANS_DM.REF_OPTION_DEAL_PR", type: "read" },
          statement_id: "task:102845:slot:query:statement:0",
          task_id: "102845",
        },
        {
          relation_id: "task:102845:statement:0:relation:root.b",
          relation_type: "read",
          relation: { table: "TITANS_DM.REF_OPTION_DEAL_PR", type: "read" },
          statement_id: "task:102845:slot:query:statement:0",
          task_id: "102845",
        },
      ],
    });

    expect(result).toEqual([{
      occurrenceId: "legacy:102845:task:102845:slot:query:statement:0:titans_dm.ref_option_deal_pr:0",
      relationId: null,
    }]);
  });

  it("keeps zipper refs on DATASET_CONTROL JOIN, not FIELD_DIRECT (105387 shape)", () => {
    const { dataRoot, factsRoot } = setupZipper105387();
    const projection = projectTaskLocal({
      dataRoot,
      factsRoot,
      taskId: "105387",
      generatedAt: "2026-09-02T00:00:00.000Z",
    });
    expect(projection.coverageStatus).toBe("PROJECTED");
    expect(projection.taskId).toBe("105387");
    expect(projection.nodes.some((node) => node.nodeId.startsWith("task:71698"))).toBe(false);

    const targetWrites = projection.nodes.filter((node) => node.nodeType === "TARGET_WRITE");
    expect(targetWrites.length).toBeGreaterThan(0);
    for (const writeNode of targetWrites) {
      const taskToWrite = projection.edges.some(
        (edge) =>
          edge.edgeType === "WRITES"
          && edge.fromNodeId === "task:105387"
          && edge.toNodeId === writeNode.nodeId,
      );
      const writeToDataset = projection.edges.find(
        (edge) =>
          edge.edgeType === "WRITES"
          && edge.fromNodeId === writeNode.nodeId
          && projection.nodes.find((node) => node.nodeId === edge.toNodeId)?.nodeType
            === "PHYSICAL_DATASET",
      );
      expect(taskToWrite).toBe(true);
      expect(writeToDataset).toBeDefined();
    }

    const zipperTail = (name: string): boolean =>
      ["d_ref_fx_forward", "d_ref_fast_trs", "d_ref_otc_option_deal", "d_ref_trs"].includes(name);
    const fieldDirectSourcesFor = (outputColumn: string): string[] =>
      projection.edges
        .filter(
          (edge) =>
            edge.edgeType === "FIELD_DIRECT"
            && String(edge.properties.outputColumn ?? "") === outputColumn,
        )
        .map((edge) => projection.nodes.find((node) => node.nodeId === edge.fromNodeId))
        .filter((node) => node?.nodeType === "PHYSICAL_FIELD")
        .map((node) => String(node!.properties.qualifiedName ?? ""));

    const internalTradeSources = fieldDirectSourcesFor("internal_trade_id");
    expect(internalTradeSources.some((name) => zipperTail(name.split(".").at(-1)!))).toBe(false);
    expect(internalTradeSources.some((name) => name.includes("demo.trades"))).toBe(true);

    const joinControls = projection.edges.filter(
      (edge) =>
        edge.edgeType === "DATASET_CONTROL"
        && edge.properties.subtype === "JOIN",
    );
    const joinRefTables = new Set(
      joinControls
        .map((edge) => projection.nodes.find((node) => node.nodeId === edge.fromNodeId))
        .map((node) => String(node?.properties.qualifiedName ?? "").split(".").at(-1) ?? "")
        .filter((tail) => zipperTail(tail)),
    );
    expect(joinRefTables.size).toBe(4);
    expect(joinControls.every((edge) => edge.properties.grain === "EXPAND_RISK")).toBe(true);

    const outputColumns = new Set(
      projection.edges
        .filter((edge) => edge.edgeType === "FIELD_DIRECT")
        .map((edge) => String(edge.properties.outputColumn ?? "")),
    );
    expect(joinControls.length).toBeLessThanOrEqual(outputColumns.size * 4);
    expect(joinControls.length).toBeGreaterThan(0);
  }, 60_000);
});
