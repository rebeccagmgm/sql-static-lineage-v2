import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createTaskDocument } from "../scripts/input/shared/input-pack.ts";

import {
  formalArtifactPaths,
  parseLineageAllArgs,
  publishStagedTask,
  runLineageAll,
  prefetchHoraeRelations,
} from "../scripts/pipeline/lineage-all.ts";
import {
  readHoraeRelationCache,
  scheduleEvidenceCachePath,
  writeHoraeRelationCache,
} from "../scripts/reconcile/consumer/one-hop/schedule-evidence-cache.ts";

function fakeMultiHop(taskId: string): any {
  return {
    schemaVersion: "1.1.0",
    artifactType: "TABLE_MULTI_HOP_RECONCILIATION",
    rootTaskId: taskId,
    generatedAt: "2026-08-26T00:00:00.000Z",
    taskNodes: [{ taskId }],
  };
}

function fakeOneHop(taskId: string): any {
  return { schemaVersion: "1.1.0", taskId, generatedAt: "2026-08-26T00:00:00.000Z" };
}

describe("lineage:all", () => {
  it("prefetches Horae relations with bounded concurrency and exact arguments", async () => {
    let active = 0;
    let peak = 0;
    const calls: readonly string[][] = [] as string[][];
    const evidence = await prefetchHoraeRelations(["a", "b", "c", "d", "e"], {
      concurrency: 4,
      now: (() => "2026-08-27T00:00:00.000Z"),
      run: async (args) => {
        (calls as string[][]).push([...args]); active += 1; peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 2)); active -= 1;
        return [{ task_id: args[2], task_name: `name-${args[2]}` }];
      },
    });
    expect(peak).toBeLessThanOrEqual(4);
    expect(calls).toHaveLength(5);
    expect(calls[0]).toEqual(["horae", "relation", "a", "--direction", "up", "--depth", "1", "-f", "json"]);
    expect(evidence.get("a")?.provider).toBe("opencli:horae.relation");
    expect(evidence.get("a")?.observedAt).toBe("2026-08-27T00:00:00.000Z");
  });

  it("reads, writes, and refreshes the Horae relation cache without changing prefetch orchestration", async () => {
    const cacheRoot = mkdtempSync(join(tmpdir(), "schedule-evidence-cache-"));
    let calls = 0;
    const run = async (args: readonly string[]) => {
      calls += 1;
      return [{ task_id: args[2], task_name: `name-${args[2]}` }];
    };

    const first = await prefetchHoraeRelations(["cached"], {
      cacheRoot,
      run,
      now: () => "2026-08-27T00:00:00.000Z",
    });
    const cachePath = scheduleEvidenceCachePath("cached", cacheRoot);
    expect(calls).toBe(1);
    expect(first.get("cached")).toMatchObject({
      cacheStatus: "MISS",
      cachePath,
      rows: [{ task_id: "cached", task_name: "name-cached" }],
    });

    const second = await prefetchHoraeRelations(["cached"], {
      cacheRoot,
      run,
      now: () => "2026-08-27T00:00:01.000Z",
    });
    expect(calls).toBe(1);
    expect(second.get("cached")).toMatchObject({
      cacheStatus: "HIT",
      cachePath,
      observedAt: "2026-08-27T00:00:00.000Z",
      rows: [{ task_id: "cached", task_name: "name-cached" }],
    });

    const stale = JSON.parse(readFileSync(cachePath, "utf8")) as {
      rows: unknown[];
    };
    stale.rows = [{ task_id: "changed" }];
    writeFileSync(cachePath, JSON.stringify(stale), "utf8");
    const third = await prefetchHoraeRelations(["cached"], {
      cacheRoot,
      run,
      now: () => "2026-08-27T00:00:02.000Z",
    });
    expect(calls).toBe(2);
    expect(third.get("cached")).toMatchObject({
      cacheStatus: "INVALID",
      cachePath,
      observedAt: "2026-08-27T00:00:02.000Z",
    });
    expect(JSON.parse(readFileSync(cachePath, "utf8"))).toMatchObject({
      task_id: "cached",
      schema_version: "1.0.0",
      content_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it("prefetches downstream relations into a separate resumable cache", async () => {
    const cacheRoot = mkdtempSync(join(tmpdir(), "schedule-evidence-down-cache-"));
    writeHoraeRelationCache(
      "owner",
      "2026-08-31T00:00:00.000Z",
      [{ task_id: "upstream", task_name: "upstream-task" }],
      cacheRoot,
    );
    const upstreamPath = scheduleEvidenceCachePath("owner", cacheRoot, "up");
    const upstreamBefore = readFileSync(upstreamPath, "utf8");
    const calls: string[][] = [];
    const run = async (args: readonly string[]) => {
      calls.push([...args]);
      return [{ task_id: "consumer", task_name: "consumer-task" }];
    };

    const first = await prefetchHoraeRelations(["owner"], {
      cacheRoot,
      direction: "down",
      run,
      now: () => "2026-09-01T00:00:00.000Z",
    });
    const cachePath = scheduleEvidenceCachePath("owner", cacheRoot, "down");

    expect(calls).toEqual([
      [
        "horae",
        "relation",
        "owner",
        "--direction",
        "down",
        "--depth",
        "1",
        "-f",
        "json",
      ],
    ]);
    expect(cachePath).toMatch(/horae-relation-down-depth-1\.json$/);
    expect(first.get("owner")).toMatchObject({
      cacheStatus: "MISS",
      cachePath,
      rows: [{ task_id: "consumer", task_name: "consumer-task" }],
    });
    expect(readHoraeRelationCache("owner", cacheRoot, "down")).toMatchObject({
      status: "HIT",
      rows: [{ task_id: "consumer", task_name: "consumer-task" }],
    });
    expect(JSON.parse(readFileSync(cachePath, "utf8"))).toMatchObject({
      task_id: "owner",
      direction: "down",
      depth: 1,
    });
    expect(readFileSync(upstreamPath, "utf8")).toBe(upstreamBefore);

    await prefetchHoraeRelations(["owner"], {
      cacheRoot,
      direction: "down",
      run,
    });
    expect(calls).toHaveLength(1);
  });

  it("stops prefetch assignment after failure and waits for active runners", async () => {
    let active = 0; let settled = false; let calls = 0;
    await expect(prefetchHoraeRelations(["a", "b", "c", "d", "e", "f"], {
      concurrency: 2,
      run: async (args) => { calls += 1; active += 1; if (args[2] === "a") { active -= 1; throw new Error("boom"); } await new Promise((resolve) => setTimeout(resolve, 5)); active -= 1; settled = true; return [{ task_id: args[2] }]; },
    })).rejects.toThrow("HORAE_RELATION_PREFETCH_RUNNER_FAILED:a");
    expect(active).toBe(0); expect(settled).toBe(true); expect(calls).toBeLessThanOrEqual(2);
  });

  it("fails on cumulative UTF-8 relation bytes after active runners settle", async () => {
    let active = 0;
    await expect(prefetchHoraeRelations(["a", "b"], {
      concurrency: 2,
      maxTotalBytes: 100,
      run: async (args) => {
        active += 1;
        await new Promise((resolve) => setTimeout(resolve, 2));
        active -= 1;
        return [{ task_id: args[2], payload: "x".repeat(70) }];
      },
    })).rejects.toThrow("HORAE_RELATION_PREFETCH_OUTPUT_LIMIT");
    expect(active).toBe(0);
  });

  it("rejects unknown Horae envelopes and invalid rows", async () => {
    await expect(prefetchHoraeRelations(["a"], { run: async () => ({ nope: true }) })).rejects.toThrow("INVALID_ENVELOPE");
    await expect(prefetchHoraeRelations(["a"], { run: async () => [{ task_id: "not valid" }] })).rejects.toThrow("INVALID_ROWS");
    await expect(prefetchHoraeRelations(["a"], { run: async () => ({ error: "forbidden", rows: [] }) })).rejects.toThrow("INVALID_ENVELOPE");
    await expect(prefetchHoraeRelations(["a"], { run: async () => ({ success: false, rows: [] }) })).rejects.toThrow("INVALID_ENVELOPE");
    await expect(prefetchHoraeRelations(["a"], { run: async () => ({ status: "fail", rows: [] }) })).rejects.toThrow("INVALID_ENVELOPE");
  });
  it("parses repeated and comma-separated task ids", () => {
    const parsed = parseLineageAllArgs([
      "--data-root", "E:/packs", "--task-ids", "181058,155015", "--task-id", "181058", "--with-fields",
    ]);
    expect(parsed.taskIds).toEqual(["181058", "155015"]);
    expect(parsed.withFields).toBe(true);
    expect(parsed.maxDepth).toBe(25);
    expect(parsed.maxTasks).toBe(1000);
    expect(parsed.maxEdges).toBe(10000);
  });

  it("reuses a writer catalog and passes trusted fingerprint downstream", async () => {
    const root = mkdtempSync(join(tmpdir(), "lineage-snapshot-"));
    mkdirSync(join(root, "tasks"), { recursive: true }); mkdirSync(join(root, "tables"), { recursive: true });
    let catalogs = 0; let oneTrusted = ""; let multiTrusted = ""; let sawCatalog = false;
    const result = await runLineageAll({ dataRoot: root, taskIds: ["snap"], dependencies: {
      schedulePrefetch: async (ids) => new Map(ids.map((id) => [id, { rows: [], provider: "opencli:horae.relation" as const, locator: "test", observedAt: "now" }])),
      autofill: () => ({ taskIds: ["snap"], discoveredTaskIds: ["snap"], collectedTaskIds: [], rounds: 1, status: "COMPLETE", issues: [], writerCatalogSnapshot: { catalogPath: "catalog.sqlite" } }),
      openWriterCatalog: () => { catalogs += 1; return { path: "catalog.sqlite" } as any; },
      machineFacts: () => ({ tasks: [] }) as any, oneHopBatch: (_ids, opts) => { oneTrusted = opts.trustedInputFingerprint ?? ""; sawCatalog = opts.writerCatalog !== undefined; return [fakeOneHop("snap")]; }, multiHop: (_id, opts) => { multiTrusted = opts.trustedInputFingerprint ?? ""; return fakeMultiHop("snap"); },
      visualizeMultiHop: ({ outputPath }) => { mkdirSync(join(outputPath!, ".."), { recursive: true }); writeFileSync(outputPath!, "<html/>\n"); return outputPath!; },
    } });
    expect(result.status).toBe("SUCCESS"); expect(catalogs).toBeGreaterThan(0); expect(sawCatalog).toBe(true); expect(oneTrusted).toHaveLength(64); expect(multiTrusted).toBe(oneTrusted);
  });

  it("publishes even when the live Input Pack has drifted from the loaded index fingerprint", async () => {
    const root = mkdtempSync(join(tmpdir(), "lineage-no-final-guard-"));
    mkdirSync(join(root, "tasks"), { recursive: true });
    mkdirSync(join(root, "tables"), { recursive: true });
    const artifactRoot = join(root, "artifacts");
    const result = await runLineageAll({ dataRoot: root, artifactRoot, taskIds: ["guard"], dependencies: {
      schedulePrefetch: async (ids) => new Map(ids.map((id) => [id, { rows: [], provider: "opencli:horae.relation" as const, locator: "test", observedAt: "now" }])),
      autofill: () => ({ taskIds: ["guard"], discoveredTaskIds: ["guard"], collectedTaskIds: [], rounds: 1, status: "COMPLETE", issues: [] }),
      openWriterCatalog: () => ({ path: "catalog.sqlite" } as any),
      machineFacts: () => ({ tasks: [] }) as any,
      oneHopBatch: () => [fakeOneHop("guard")],
      multiHop: () => fakeMultiHop("guard"),
      visualizeMultiHop: ({ outputPath }) => { mkdirSync(join(outputPath!, ".."), { recursive: true }); writeFileSync(outputPath!, "<html/>\n"); return outputPath!; },
    } });
    expect(result.tasks[0]?.status).toBe("SUCCESS");
    expect(existsSync(formalArtifactPaths(artifactRoot, "guard").oneHop)).toBe(true);
  });

  it("redraws the table view only after field-driven producer autofill stabilizes", async () => {
    const root = mkdtempSync(join(tmpdir(), "lineage-field-redraw-"));
    mkdirSync(join(root, "tasks", "hiveTask-2.0", "root"), { recursive: true });
    mkdirSync(join(root, "tables"), { recursive: true });
    writeFileSync(join(root, "tasks", "hiveTask-2.0", "root", "task.json"), JSON.stringify(createTaskDocument({ taskId: "root", taskCategory: "hiveTask-2.0", target: { platform: "hive", dataSource: "gfhive", qualifiedName: "mart.root" } })));
    let autofillCalls = 0; let fieldRound = 0; const collected: string[] = []; const rendered: string[] = [];
    const missingField = { bindingId: null, expressionId: null, taskId: "root", field: { platform: "hive", dataSource: "gfhive", stableTableId: "mart.missing", qualifiedName: "mart.missing", column: "value", identityStatus: "SCHEMA_BACKED" } };
    const result = await runLineageAll({ dataRoot: root, taskIds: ["root"], withFields: true, dependencies: {
      schedulePrefetch: async (ids) => new Map(ids.map((id) => [id, { rows: [], provider: "opencli:horae.relation" as const, locator: "test", observedAt: "now" }])),
      autofill: () => { autofillCalls += 1; return ({ taskIds: ["root"], discoveredTaskIds: [], collectedTaskIds: [], rounds: 1, status: "COMPLETE", issues: [] }); },
      openWriterCatalog: () => ({ path: "catalog.sqlite" } as any),
      machineFacts: () => ({ tasks: [] }) as any, oneHopBatch: (ids) => ids.map((id) => fakeOneHop(id)),
      multiHop: (id, opts) => ({ ...fakeMultiHop(id), producerBridges: [], taskNodes: [{ taskId: id, marker: (opts.oneHopSnapshots?.size ?? 0) > 1 ? "final" : "first" }] } as any),
      fieldLineage: () => fieldRound++ === 0 ? ({ nodes: [missingField] } as any) : ({ nodes: [] } as any),
      fieldProducerDiscovery: () => ["producer-new"], collectTaskPacks: (dataRoot, ids) => {
        collected.push(...ids);
        for (const id of ids) {
          const directory = join(dataRoot, "tasks", "hiveTask-2.0", id);
          mkdirSync(directory, { recursive: true });
          writeFileSync(join(directory, "task.json"), JSON.stringify(createTaskDocument({ taskId: id, taskCategory: "hiveTask-2.0", target: { platform: "hive", dataSource: "gfhive", qualifiedName: `mart.${id}` } })));
        }
      },
      visualizeMultiHop: ({ artifactPath, outputPath }) => { const marker = JSON.parse(readFileSync(artifactPath!, "utf8")).taskNodes[0].marker; rendered.push(marker); mkdirSync(join(outputPath!, ".."), { recursive: true }); writeFileSync(outputPath!, `<html>${marker}</html>\n`); return outputPath!; },
      visualizeFieldLineage: () => "",
    } });
    expect(result.status).toBe("SUCCESS"); expect(autofillCalls).toBe(1); expect(collected).toEqual(["producer-new"]); expect(rendered).toEqual(["first", "final"]);
    expect(readFileSync(formalArtifactPaths(join(root, "artifacts"), "root").tableHtml, "utf8")).toBe("<html>final</html>\n");
    const closure = JSON.parse(readFileSync(formalArtifactPaths(join(root, "artifacts"), "root").inputPackClosure, "utf8")) as Record<string, any>;
    expect(closure.initialTaskIds).toEqual(["root"]);
    expect(closure.taskIds).toEqual(["root", "producer-new"]);
    expect(closure.fieldDrivenProducerTables).toEqual(["mart.missing"]);
    expect(closure.fieldDrivenCollectedTaskIds).toEqual(["producer-new"]);
  });

  it("publishes the fixed task directory and removes stale optional files", () => {
    const root = mkdtempSync(join(tmpdir(), "lineage-publish-"));
    const staged = join(root, ".staging", "task");
    const final = formalArtifactPaths(root, "181058");
    mkdirSync(join(staged, "views"), { recursive: true });
    mkdirSync(final.views, { recursive: true });
    writeFileSync(join(final.directory, "field-lineage.json"), "stale\n");
    writeFileSync(join(staged, "one-hop.json"), "new\n");
    writeFileSync(join(staged, "multi-hop.json"), "new\n");
    writeFileSync(join(staged, "views", "table-lineage.html"), "new\n");
    publishStagedTask(staged, final.directory, root);
    expect(existsSync(final.oneHop)).toBe(true);
    expect(existsSync(final.multiHop)).toBe(true);
    expect(existsSync(final.tableHtml)).toBe(true);
    expect(existsSync(final.fieldLineage)).toBe(false);
  });

  it("publishes in place when Windows holds a formal artifact file open", () => {
    if (process.platform !== "win32") return;
    const root = mkdtempSync(join(tmpdir(), "lineage-publish-open-file-"));
    const staged = join(root, ".staging", "task");
    const final = formalArtifactPaths(root, "181058");
    mkdirSync(join(staged, "views"), { recursive: true });
    mkdirSync(final.views, { recursive: true });
    writeFileSync(final.fieldHtml, "old\n");
    writeFileSync(join(staged, "one-hop.json"), "new\n");
    writeFileSync(join(staged, "multi-hop.json"), "new\n");
    writeFileSync(join(staged, "field-lineage.json"), "new\n");
    writeFileSync(join(staged, "views", "table-lineage.html"), "new\n");
    writeFileSync(join(staged, "views", "field-lineage.html"), "new\n");
    const fd = openSync(final.fieldHtml, "r");
    try {
      publishStagedTask(staged, final.directory, root);
    } finally {
      closeSync(fd);
    }
    expect(readFileSync(final.fieldHtml, "utf8")).toBe("new\n");
    expect(readFileSync(final.fieldLineage, "utf8")).toBe("new\n");
  });

  it("keeps one task failure isolated while publishing successful siblings", async () => {
    const root = mkdtempSync(join(tmpdir(), "lineage-all-"));
    mkdirSync(join(root, "tasks"), { recursive: true });
    mkdirSync(join(root, "tables"), { recursive: true });
    const result = await runLineageAll({
      dataRoot: root,
      taskIds: ["ok", "bad"],
      dependencies: {
        schedulePrefetch: async (taskIds) => new Map(taskIds.map((taskId) => [taskId, { rows: [], provider: "opencli:horae.relation" as const, locator: "test", observedAt: "2026-08-27T00:00:00.000Z" }])),
        autofill: ({ taskId }) => {
          if (taskId === "bad") throw new Error("AUTOFILL_FAILED");
          return { taskIds: [taskId], discoveredTaskIds: [taskId], collectedTaskIds: [], rounds: 1, status: "COMPLETE", issues: [] };
        },
        machineFacts: () => ({ tasks: [] }) as any,
        oneHopBatch: (taskIds) => taskIds.map((taskId) => fakeOneHop(taskId)),
        multiHop: (taskId) => fakeMultiHop(taskId),
        visualizeMultiHop: ({ outputPath }) => {
          mkdirSync(join(outputPath!, ".."), { recursive: true });
          writeFileSync(outputPath!, "<html></html>\n");
          return outputPath!;
        },
      },
    });
    expect(result.status).toBe("PARTIAL_FAILURE");
    expect(result.tasks.find((task) => task.taskId === "ok")?.status).toBe("SUCCESS");
    expect(result.tasks.find((task) => task.taskId === "bad")?.status).toBe("FAILED");
    expect(existsSync(join(root, "artifacts", "tasks", "ok", "one-hop.json"))).toBe(true);
    expect(existsSync(join(root, "artifacts", "tasks", "bad"))).toBe(false);
  });

  it("executes the formal stages in the documented order", async () => {
    const root = mkdtempSync(join(tmpdir(), "lineage-order-"));
    mkdirSync(join(root, "tasks"), { recursive: true });
    mkdirSync(join(root, "tables"), { recursive: true });
    const taskPack = join(root, "tasks", "sparkIndex", "181058");
    mkdirSync(taskPack, { recursive: true });
    writeFileSync(join(taskPack, "task.json"), JSON.stringify(createTaskDocument({
      taskId: "181058",
      taskCategory: "sparkIndex",
      target: { platform: "hive", dataSource: "gfhive", qualifiedName: "demo.target" },
    })));
    const events: string[] = [];
    let closureConfig: any;
    let oneHopConfig: any;
    let multiHopConfig: any;
    const result = await runLineageAll({
      dataRoot: root,
      taskIds: ["181058"],
      withFields: true,
      dependencies: {
        schedulePrefetch: async (taskIds) => new Map(taskIds.map((taskId) => [taskId, { rows: [], provider: "opencli:horae.relation" as const, locator: "test", observedAt: "2026-08-27T00:00:00.000Z" }])),
        autofill: ({ taskId, maxTasks, maxDiscoveredTasks, terminalTableConfig }) => {
          closureConfig = terminalTableConfig;
          events.push(`input-pack-autofill:${maxTasks}:${maxDiscoveredTasks}`);
          return { taskIds: [taskId], discoveredTaskIds: [taskId], collectedTaskIds: [], rounds: 1, status: "COMPLETE", issues: [] };
        },
        machineFacts: () => {
          events.push("machine-facts");
          return { tasks: [] } as any;
        },
        openWriterCatalog: () => ({ path: "catalog.sqlite" } as any),
        oneHopBatch: (taskIds, options) => {
          oneHopConfig = options.terminalTableConfig;
          events.push(`one-hop:${taskIds.join(",")}`);
          return taskIds.map((taskId) => fakeOneHop(taskId));
        },
        multiHop: (taskId, options) => {
          multiHopConfig = options.terminalTableConfig;
          events.push(`multi-hop:${taskId}:${options.rootOneHop?.taskId ?? "missing"}:${options.maxTasks}:${options.maxEdges}`);
          return fakeMultiHop(taskId);
        },
        visualizeMultiHop: ({ outputPath }) => {
          events.push("table-html");
          mkdirSync(join(outputPath!, ".."), { recursive: true });
          writeFileSync(outputPath!, "<html></html>\n");
          return outputPath!;
        },
        fieldLineage: (options) => {
          events.push(`field-lineage:${options.maxStates}:${options.maxPaths}`);
          return {} as any;
        },
        visualizeFieldLineage: () => {
          events.push("field-html");
          return "";
        },
      },
    });
    expect(result.status).toBe("SUCCESS");
    for (const config of [closureConfig, oneHopConfig, multiHopConfig])
      expect(config).toMatchObject({
        stopRoles: ["REFERENCE_CONFIG"],
        roles: {
          REFERENCE_CONFIG: {
            qualifiedNameExact: expect.arrayContaining(["pdata_n.ref_cd_cvt_map"]),
          },
        },
      });
    expect(events).toEqual([
      "input-pack-autofill:1000:5000",
      "machine-facts",
      "one-hop:181058",
      "multi-hop:181058:181058:1000:10000",
      "table-html",
      "field-lineage:5000:10000",
      "field-html",
    ]);
  });

  it("removes checkdbflag scheduler parents from the formal lineage snapshot", async () => {
    const root = mkdtempSync(join(tmpdir(), "lineage-checkdbflag-"));
    mkdirSync(join(root, "tasks"), { recursive: true });
    mkdirSync(join(root, "tables"), { recursive: true });
    let filtered: any;
    const result = await runLineageAll({
      dataRoot: root,
      taskIds: ["181058"],
      dependencies: {
        schedulePrefetch: async (taskIds) => new Map(taskIds.map((taskId) => [taskId, { rows: [], provider: "opencli:horae.relation" as const, locator: "test", observedAt: "2026-08-27T00:00:00.000Z" }])),
        autofill: ({ taskId }) => ({
          taskIds: [taskId],
          discoveredTaskIds: [taskId],
          collectedTaskIds: [],
          rounds: 1,
          status: "COMPLETE",
          issues: [],
        }),
        machineFacts: () => ({ tasks: [] }) as any,
        oneHopBatch: () => [
          {
            ...fakeOneHop("181058"),
            schedule: {
              direction: "UPSTREAM",
              depth: 1,
              parents: [
                { taskId: "169692", taskName: "checker.demo", evidence: [] },
              ],
              evidence: [],
            },
            finalUpstreamTaskIds: {
              primary: [],
              additional: [],
              unknown: [],
              decision: "SCHEDULE_FALLBACK",
            },
            dataPath: { confirmedProducers: [], readOccurrenceDecisions: [] },
          } as any,
          {
            ...fakeOneHop("78585"),
            schedule: {
              direction: "UPSTREAM",
              depth: 1,
              parents: [
                { taskId: "169692", taskName: "checker.demo", evidence: [] },
              ],
              evidence: [],
            },
            finalUpstreamTaskIds: {
              primary: ["169692"],
              additional: [],
              unknown: [],
              decision: "SCHEDULE_FALLBACK",
            },
            dataPath: { confirmedProducers: [], readOccurrenceDecisions: [] },
          } as any,
        ],
        multiHop: (_taskId, options) => {
          filtered = options.oneHopSnapshots?.get("78585");
          return fakeMultiHop("181058");
        },
        visualizeMultiHop: ({ outputPath }) => {
          mkdirSync(join(outputPath!, ".."), { recursive: true });
          writeFileSync(outputPath!, "<html></html>\n");
          return outputPath!;
        },
      },
    });
    expect(result.status).toBe("SUCCESS");
    expect(filtered.finalUpstreamTaskIds.primary).toEqual([]);
    expect(filtered.schedule.parents).toEqual([]);
  });

  it("fails closed when Input Pack or Machine Facts is partial", async () => {
    const root = mkdtempSync(join(tmpdir(), "lineage-closed-") );
    mkdirSync(join(root, "tasks"), { recursive: true });
    mkdirSync(join(root, "tables"), { recursive: true });
    const partialInput = await runLineageAll({
      dataRoot: root,
      taskIds: ["input-partial"],
      dependencies: {
        schedulePrefetch: async (taskIds) => new Map(taskIds.map((taskId) => [taskId, { rows: [], provider: "opencli:horae.relation" as const, locator: "test", observedAt: "2026-08-27T00:00:00.000Z" }])),
        autofill: () => ({ taskIds: ["input-partial"], discoveredTaskIds: [], collectedTaskIds: [], rounds: 1, status: "PARTIAL", issues: ["COLLECTION_FAILED"] }),
        machineFacts: () => ({ tasks: [] }) as any,
      },
    });
    expect(partialInput.tasks[0]?.error).toContain("INPUT_PACK_CLOSURE_PARTIAL");

    const partialFacts = await runLineageAll({
      dataRoot: root,
      taskIds: ["facts-partial"],
      dependencies: {
        schedulePrefetch: async (taskIds) => new Map(taskIds.map((taskId) => [taskId, { rows: [], provider: "opencli:horae.relation" as const, locator: "test", observedAt: "2026-08-27T00:00:00.000Z" }])),
        autofill: () => ({ taskIds: ["facts-partial"], discoveredTaskIds: [], collectedTaskIds: [], rounds: 1, status: "COMPLETE", issues: [] }),
        machineFacts: () => ({ tasks: [{ task_id: "facts-partial", state: "FAILED", status: "FAILED" }] }) as any,
      },
    });
    expect(partialFacts.tasks[0]?.error).toContain("MACHINE_FACTS_FAILED");
  });
});
