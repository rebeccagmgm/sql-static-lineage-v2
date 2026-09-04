import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

import {
  buildTableProducerIndex,
  writeTableProducerIndex,
} from "../scripts/reconcile/producer/producer-index.ts";
import { runMultiHopClosureAudit } from "../scripts/reconcile/consumer/multi-hop/audit-multi-hop-closure.ts";
import { writeHoraeRelationCache } from "../scripts/reconcile/consumer/one-hop/schedule-evidence-cache.ts";
import { writeTaskInput } from "../scripts/input/shared/input-pack.ts";

function root(): string {
  return mkdtempSync(join(tmpdir(), "sql-lineage-closure-audit-"));
}

describe("multi-hop closure audit", () => {
  it("uses cached Horae parents and reports only missing task packs", () => {
    const dataRoot = root();
    writeTaskInput(dataRoot, {
      taskId: "root",
      taskCategory: "sparkIndex",
      collectedAt: "2026-08-30T00:00:00.000Z",
      evidenceProvider: "fixture",
      sql: {
        query: {
          content: "SELECT * FROM lake.input",
          evidenceProvider: "fixture",
        },
      },
    });
    const scheduleRoot = join(dataRoot, "schedule-cache");
    writeHoraeRelationCache(
      "root",
      "2026-08-30T00:00:00.000Z",
      [{ task_id: "missing-parent" }],
      scheduleRoot,
    );
    const producerIndexPath = join(dataRoot, "producer-index.json");
    writeTableProducerIndex(
      producerIndexPath,
      buildTableProducerIndex(dataRoot),
    );

    const report = runMultiHopClosureAudit(
      {
        dataRoot,
        taskCategory: "sparkIndex",
        producerIndexPath,
        scheduleEvidenceCacheRoot: scheduleRoot,
        terminalTableConfigPath: "config/multi-hop-terminal-table-rules.json",
        maxDepth: 3,
        maxTasks: 100,
        maxEdges: 100,
        maxTableQueries: 10,
        cacheOnly: true,
      },
      () => {
        throw new Error("cache-only must not call Horae");
      },
    );

    expect(report.summary.rootCount).toBe(1);
    expect(report.missingTaskIds).toEqual(["missing-parent"]);
    expect(report.summary.scheduleCacheHits).toBe(1);
    expect(report.summary.scheduleCacheMisses).toBe(1);
    expect(report.summary.closureStatus).toBe("PARTIAL_CACHE");
    expect(report.summary.missingTaskPackCountIsFinal).toBe(false);
    expect(report.boundaries.inputPackCollection).toBe("NOT_PERFORMED");
  });

  it("keeps missing-pack counts non-final while producer tables are unresolved", () => {
    const dataRoot = root();
    writeTaskInput(dataRoot, {
      taskId: "root",
      taskCategory: "sparkIndex",
      collectedAt: "2026-08-30T00:00:00.000Z",
      evidenceProvider: "fixture",
      sql: {
        query: {
          content: "SELECT * FROM lake.input",
          evidenceProvider: "fixture",
        },
      },
    });
    const scheduleRoot = join(dataRoot, "schedule-cache");
    writeHoraeRelationCache(
      "root",
      "2026-08-30T00:00:00.000Z",
      [],
      scheduleRoot,
    );
    const producerIndexPath = join(dataRoot, "producer-index.json");
    writeTableProducerIndex(
      producerIndexPath,
      buildTableProducerIndex(dataRoot),
    );

    const report = runMultiHopClosureAudit({
      dataRoot,
      taskCategory: "sparkIndex",
      producerIndexPath,
      scheduleEvidenceCacheRoot: scheduleRoot,
      terminalTableConfigPath: "config/multi-hop-terminal-table-rules.json",
      maxDepth: 3,
      maxTasks: 100,
      maxEdges: 100,
      maxTableQueries: 10,
      cacheOnly: true,
    });

    expect(report.summary.scheduleCacheMisses).toBe(0);
    expect(report.unresolvedTables).toEqual(["lake.input"]);
    expect(report.summary.closureStatus).toBe("PARTIAL");
    expect(report.summary.missingTaskPackCountIsFinal).toBe(false);
  });

  it("continues cached schedule traversal through tasks without Input Packs", () => {
    const dataRoot = root();
    writeTaskInput(dataRoot, {
      taskId: "root",
      taskCategory: "sparkIndex",
      collectedAt: "2026-08-30T00:00:00.000Z",
      evidenceProvider: "fixture",
      sql: {
        query: { content: "SELECT 1", evidenceProvider: "fixture" },
      },
    });
    const scheduleRoot = join(dataRoot, "schedule-cache");
    writeHoraeRelationCache(
      "root",
      "2026-08-30T00:00:00.000Z",
      [{ task_id: "missing-parent" }],
      scheduleRoot,
    );
    writeHoraeRelationCache(
      "missing-parent",
      "2026-08-30T00:00:00.000Z",
      [{ task_id: "grandparent" }],
      scheduleRoot,
    );
    writeHoraeRelationCache(
      "grandparent",
      "2026-08-30T00:00:00.000Z",
      [],
      scheduleRoot,
    );
    const producerIndexPath = join(dataRoot, "producer-index.json");
    writeTableProducerIndex(
      producerIndexPath,
      buildTableProducerIndex(dataRoot),
    );

    const report = runMultiHopClosureAudit({
      dataRoot,
      taskCategory: "sparkIndex",
      producerIndexPath,
      scheduleEvidenceCacheRoot: scheduleRoot,
      terminalTableConfigPath: "config/multi-hop-terminal-table-rules.json",
      maxDepth: 3,
      maxTasks: 100,
      maxEdges: 100,
      maxTableQueries: 10,
      cacheOnly: true,
    });

    expect(report.summary.scheduleCacheHits).toBe(3);
    expect(report.summary.scheduleCacheMisses).toBe(0);
    expect(report.missingTaskIds).toEqual(["grandparent", "missing-parent"]);
    expect(report.perRoot[0]).toMatchObject({
      closureTaskCount: 3,
      existingTaskPackCount: 1,
      missingTaskPackCount: 2,
      maxDepth: 2,
      truncated: false,
    });
    expect(report.summary.closureStatus).toBe("PARTIAL");
    expect(report.summary.missingTaskPackCountIsFinal).toBe(false);
  });

  it("marks a root partial when traversal reaches the depth budget", () => {
    const dataRoot = root();
    writeTaskInput(dataRoot, {
      taskId: "root",
      taskCategory: "sparkIndex",
      collectedAt: "2026-08-30T00:00:00.000Z",
      evidenceProvider: "fixture",
      sql: {
        query: { content: "SELECT 1", evidenceProvider: "fixture" },
      },
    });
    const scheduleRoot = join(dataRoot, "schedule-cache");
    writeHoraeRelationCache(
      "root",
      "2026-08-30T00:00:00.000Z",
      [{ task_id: "boundary-parent" }],
      scheduleRoot,
    );
    const producerIndexPath = join(dataRoot, "producer-index.json");
    writeTableProducerIndex(
      producerIndexPath,
      buildTableProducerIndex(dataRoot),
    );

    const report = runMultiHopClosureAudit({
      dataRoot,
      taskCategory: "sparkIndex",
      producerIndexPath,
      scheduleEvidenceCacheRoot: scheduleRoot,
      terminalTableConfigPath: "config/multi-hop-terminal-table-rules.json",
      maxDepth: 1,
      maxTasks: 100,
      maxEdges: 100,
      maxTableQueries: 10,
      cacheOnly: true,
    });

    expect(report.perRoot[0]).toMatchObject({
      maxDepth: 1,
      truncated: true,
    });
    expect(report.summary.closureStatus).toBe("PARTIAL");
    expect(report.summary.missingTaskPackCountIsFinal).toBe(false);
  });
});
