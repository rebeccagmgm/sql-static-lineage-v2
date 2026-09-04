import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  indexTaskInputPacks,
  loadPhysicalTableCatalog,
  prepareInputPackTask,
  runInputPackMachineFacts,
} from "../scripts/machine-facts/input-pack-machine-facts.ts";
import { readJsonlRecords } from "../scripts/machine-facts/jsonl-store.ts";
import {
  writeTableInput,
  writeTaskInput,
} from "../scripts/input/shared/input-pack.ts";
import { createSyntheticFieldLineageInputPack } from "./fixtures/field-lineage/cases.ts";

function fixture() {
  const parent = mkdtempSync(join(tmpdir(), "input-pack-machine-facts-"));
  const dataRoot = join(parent, "data");
  const factsRoot = join(parent, "facts");
  createSyntheticFieldLineageInputPack(dataRoot);
  return { parent, dataRoot, factsRoot };
}

function jsonl(path: string): Record<string, unknown>[] {
  return readJsonlRecords(path);
}

describe("Input Pack-driven Machine Facts", () => {
  it("keeps a repeated platform SQL response raw while parsing a derived deduplicated view", () => {
    const f = fixture();
    const repeated =
      "SELECT m.mid_a AS out_a, m.filter_key AS out_b FROM demo.mid m\n\n" +
      "SELECT m.mid_a AS out_a, m.filter_key AS out_b FROM demo.mid m";
    writeTaskInput(f.dataRoot, {
      taskId: "1100",
      taskCategory: "sparkIndex",
      taskName: "demo.repeated-response.task",
      target: {
        platform: "hive",
        dataSource: "warehouse",
        qualifiedName: "demo.root",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
      partition: null,
      sql: { query: { content: repeated, evidenceProvider: "synthetic:test" } },
      evidenceProvider: "synthetic:test",
      collectedAt: "2026-01-01T00:00:00.000Z",
    });

    const prepared = prepareInputPackTask({ dataRoot: f.dataRoot, taskId: "1100" });
    expect(prepared.sqlSources[0]?.content).toBe(repeated);
    expect(prepared.sql.content).not.toContain("\n\nSELECT");
    expect(prepared.sql.analysisContent).not.toContain("\n\nSELECT");

    const result = runInputPackMachineFacts({
      dataRoot: f.dataRoot,
      taskIds: ["1100"],
      outputRoot: f.factsRoot,
    });
    expect(result.tasks[0]?.state).toBe("SUCCESS");
    const bindings = jsonl(
      join(f.factsRoot, "registry", "tasks", "1100", "bundle", "output-field-bindings.jsonl"),
    );
    expect(bindings).toHaveLength(2);
    expect(
      jsonl(join(f.factsRoot, "registry", "tasks", "1100", "bundle", "unknowns.jsonl")),
    ).toHaveLength(0);
  });

  it("publishes a resolved Task-local bridge for an INSERT OVERWRITE followed by a later read", () => {
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

    const result = runInputPackMachineFacts({
      dataRoot: f.dataRoot,
      taskIds: ["1200"],
      outputRoot: f.factsRoot,
    });
    expect(result.tasks[0]?.state).toBe("SUCCESS");
    const bundle = join(
      f.factsRoot,
      "registry",
      "tasks",
      "1200",
      "bundle",
    );
    const bridges = jsonl(
      join(bundle, "task-local-materializations.jsonl"),
    );
    expect(bridges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          physical_dataset: "demo.local_stage",
          column: "stage_a",
          status: "RESOLVED",
          provenance: "SAME_TASK_SQL_WRITE_READ",
        }),
        expect.objectContaining({
          physical_dataset: "demo.local_stage",
          column: "stage_b",
          status: "RESOLVED",
          provenance: "SAME_TASK_SQL_WRITE_READ",
        }),
      ]),
    );
    expect(
      bridges.filter((bridge) => bridge.status === "RESOLVED"),
    ).toHaveLength(2);
  });

  it("selects query, preserves provenance, and binds platform query output", () => {
    const f = fixture();
    const prepared = prepareInputPackTask({
      dataRoot: f.dataRoot,
      taskId: "100",
    });
    expect(prepared.sql.slot).toBe("query");
    expect(prepared.sql.content).toContain("SELECT m.mid_a");
    const result = runInputPackMachineFacts({
      dataRoot: f.dataRoot,
      taskIds: ["100"],
      outputRoot: f.factsRoot,
    });
    expect(result.tasks[0]?.state).toBe("SUCCESS");
    const bundle = join(f.factsRoot, "registry", "tasks", "100", "bundle");
    const manifest = JSON.parse(
      readFileSync(join(bundle, "manifest.json"), "utf8"),
    );
    expect(manifest.inputs.input_pack).toMatchObject({
      sql_slot: "query",
      task_content_hash: prepared.task.contentHash,
    });
    const statements = jsonl(join(bundle, "statements.jsonl"));
    expect(String(statements[0]?.statement_id)).toContain(":slot:query:");
    const bindings = jsonl(join(bundle, "output-field-bindings.jsonl"));
    expect(bindings).toHaveLength(2);
    expect(
      bindings.every(
        (binding) =>
          binding.evidence_kind === "PACK_DECLARED_QUERY_OUTPUT" &&
          binding.source_sql_sha256 === manifest.inputs.input_pack.sql_sha256,
      ),
    ).toBe(true);
    const writes = jsonl(join(bundle, "dataset-io.jsonl")).filter(
      (write) => write.direction === "WRITE" && write.write_observation_id,
    );
    expect(writes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          write_kind: "PACK_DECLARED_QUERY_OUTPUT",
          provenance: "PLATFORM_TARGET",
          source_sql_sha256: manifest.inputs.input_pack.sql_sha256,
        }),
      ]),
    );
  });

  it("binds platform query output when the SELECT includes target partition columns", () => {
    const f = fixture();
    writeTaskInput(f.dataRoot, {
      taskId: "1150",
      taskCategory: "sparkIndex",
      taskName: "demo.partitioned.platform.query",
      target: {
        platform: "hive",
        dataSource: "warehouse",
        qualifiedName: "demo.partitioned",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
      partition: { p: "A" },
      sql: {
        query: {
          content: "SELECT e.src_a AS value_col, 'A' AS p FROM demo.extra e;",
          evidenceProvider: "synthetic:test",
        },
      },
      evidenceProvider: "synthetic:test",
      collectedAt: "2026-01-01T00:00:00.000Z",
    });

    const result = runInputPackMachineFacts({
      dataRoot: f.dataRoot,
      taskIds: ["1150"],
      outputRoot: f.factsRoot,
    });
    expect(result.tasks[0]?.state).toBe("SUCCESS");
    const bundle = join(f.factsRoot, "registry", "tasks", "1150", "bundle");
    const bindings = jsonl(join(bundle, "output-field-bindings.jsonl"));
    expect(bindings.map((binding) => binding.target_field)).toEqual([
      "value_col",
      "p",
    ]);
    expect(
      jsonl(join(bundle, "unknowns.jsonl")).some(
        (unknown) => unknown.reason_code === "OUTPUT_BINDING_NOT_PROVABLE",
      ),
    ).toBe(false);
  });

  it("deduplicates semantically equivalent query outputs before platform binding", () => {
    const f = fixture();
    writeTaskInput(f.dataRoot, {
      taskId: "1300",
      taskCategory: "sparkIndex",
      taskName: "demo.repeated.query.outputs",
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
            "SELECT m.mid_a AS out_a, m.filter_key AS out_b FROM demo.mid m; SELECT m.mid_a AS out_a, m.filter_key AS out_b FROM demo.mid m;",
          evidenceProvider: "synthetic:test",
        },
      },
      evidenceProvider: "synthetic:test",
      collectedAt: "2026-01-01T00:00:00.000Z",
    });
    const result = runInputPackMachineFacts({
      dataRoot: f.dataRoot,
      taskIds: ["1300"],
      outputRoot: f.factsRoot,
    });
    expect(result.tasks[0]?.state).toBe("SUCCESS");
    const bundle = join(
      f.factsRoot,
      "registry",
      "tasks",
      "1300",
      "bundle",
    );
    const bindings = jsonl(join(bundle, "output-field-bindings.jsonl"));
    expect(bindings).toHaveLength(2);
    expect(
      bindings.every(
        (binding) => binding.evidence_kind === "PACK_DECLARED_QUERY_OUTPUT",
      ),
    ).toBe(true);
    expect(
      jsonl(join(bundle, "unknowns.jsonl")).some(
        (unknown) =>
          unknown.reason_code === "PLATFORM_TARGET_QUERY_BOUNDARY_NOT_PROVABLE",
      ),
    ).toBe(false);
  });

  it("keeps explicit SQL writes distinct", () => {
    const f = fixture();
    runInputPackMachineFacts({
      dataRoot: f.dataRoot,
      taskIds: ["200"],
      outputRoot: f.factsRoot,
    });
    const bindings = jsonl(
      join(
        f.factsRoot,
        "registry",
        "tasks",
        "200",
        "bundle",
        "output-field-bindings.jsonl",
      ),
    );
    expect(bindings).toHaveLength(2);
    expect(
      bindings.every(
        (binding) => binding.evidence_kind === "SQL_EXPLICIT_WRITE",
      ),
    ).toBe(true);
    const writes = jsonl(
      join(
        f.factsRoot,
        "registry",
        "tasks",
        "200",
        "bundle",
        "dataset-io.jsonl",
      ),
    );
    expect(
      writes.find(
        (write) =>
          write.direction === "WRITE" &&
          write.write_kind === "INSERT_OVERWRITE",
      ),
    ).toMatchObject({
      provenance: "SQL_PARSE",
      source_as_boundary: { proven: false },
    });
  });

  it("fails closed when an Input Pack file changes during preparation", () => {
    const f = fixture();
    const taskPath = join(
      f.dataRoot,
      "tasks",
      "sparkIndex",
      "100",
      "task.json",
    );
    expect(() =>
      prepareInputPackTask({
        dataRoot: f.dataRoot,
        taskId: "100",
        beforeFinalVerification: () =>
          writeFileSync(taskPath, `${readFileSync(taskPath, "utf8")} `, "utf8"),
      }),
    ).toThrow(/INPUT_CHANGED_DURING_PREPARATION/);
  });

  it("rejects ambiguous fallback slots and missing Task Packs", () => {
    const f = fixture();
    expect(() =>
      prepareInputPackTask({ dataRoot: f.dataRoot, taskId: "600" }),
    ).toThrow(/SQL_SLOT_SELECTION_AMBIGUOUS/);
    expect(() =>
      prepareInputPackTask({ dataRoot: f.dataRoot, taskId: "999" }),
    ).toThrow(/TASK_INPUT_PACK_MISSING/);
  });

  it("keeps a failed Task from skipping other Tasks in the same batch", () => {
    const f = fixture();
    const result = runInputPackMachineFacts({
      dataRoot: f.dataRoot,
      taskIds: ["100", "600"],
      outputRoot: f.factsRoot,
    });
    expect(result.tasks.find((task) => task.task_id === "100")).toMatchObject({
      state: "SUCCESS",
    });
    expect(result.tasks.find((task) => task.task_id === "600")).toMatchObject({
      state: "FAILED",
      failures: [expect.objectContaining({ reason_code: "INPUT_PACK_PREPARATION_FAILED" })],
    });
    expect(existsSync(join(f.factsRoot, "registry", "tasks", "100", "bundle", "manifest.json"))).toBe(true);
  });

  it("updates only touched Tasks after the initial full facts index build", () => {
    const f = fixture();
    const taskPathIndex = indexTaskInputPacks(f.dataRoot);
    const first = runInputPackMachineFacts({
      dataRoot: f.dataRoot,
      taskIds: ["100"],
      outputRoot: f.factsRoot,
      taskPathIndex,
      indexMode: "full",
    });
    expect(first.index.count).toBe(1);
    const second = runInputPackMachineFacts({
      dataRoot: f.dataRoot,
      taskIds: ["600"],
      outputRoot: f.factsRoot,
      taskPathIndex,
      indexMode: "incremental",
    });
    expect(second.tasks[0]?.state).toBe("FAILED");
    expect(second.index.count).toBe(1);
    const indexedTaskIds = readFileSync(
      join(f.factsRoot, "indexes", "task-fact-index.jsonl"),
      "utf8",
    )
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line).task_id);
    expect(indexedTaskIds).toEqual(["100"]);
  });

  it("replays deterministically from the same Input Pack snapshot", () => {
    const f = fixture();
    const first = runInputPackMachineFacts({
      dataRoot: f.dataRoot,
      taskIds: ["100"],
      outputRoot: f.factsRoot,
    });
    const second = runInputPackMachineFacts({
      dataRoot: f.dataRoot,
      taskIds: ["100"],
      outputRoot: f.factsRoot,
    });
    expect(first.tasks[0]?.manifest_sha256).toBe(
      second.tasks[0]?.manifest_sha256,
    );
    expect(second.tasks[0]?.status).toBe("REUSED");
  });

  it("builds a task-scoped schema bundle from physical SQL references", () => {
    const f = fixture();
    const result = runInputPackMachineFacts({
      dataRoot: f.dataRoot,
      taskIds: ["100"],
      outputRoot: f.factsRoot,
    });
    expect(result.tasks[0]?.state).toBe("SUCCESS");
    const refs = jsonl(
      join(f.factsRoot, "registry", "tasks", "100", "bundle", "schema-refs.jsonl"),
    );
    expect(refs.map((ref) => ref.qualified_name).sort()).toEqual([
      "demo.mid",
      "demo.root",
    ]);
  });

  it("defers unrelated DDL verification in a lazy catalog", () => {
    const f = fixture();
    writeTableInput(f.dataRoot, {
      platform: "hive",
      dataSource: "warehouse",
      qualifiedName: "demo.unrelated_bad_ddl",
      objectType: "hive_table",
      partitionFields: [],
      ddl: "CREATE TABLE demo.unrelated_bad_ddl (",
      evidenceProvider: "synthetic:test",
      collectedAt: "2026-01-01T00:00:00.000Z",
    });
    const catalog = loadPhysicalTableCatalog(f.dataRoot, { lazyDdl: true });
    expect(catalog.byQualifiedName.get("demo.unrelated_bad_ddl")).toHaveLength(1);
    expect(catalog.issues).toHaveLength(0);
    const result = runInputPackMachineFacts({
      dataRoot: f.dataRoot,
      taskIds: ["100"],
      outputRoot: f.factsRoot,
      tableCatalog: catalog,
    });
    expect(result.tasks[0]?.state).toBe("SUCCESS");
    expect(catalog.issues).toHaveLength(0);
    expect(catalog.byQualifiedName.get("demo.unrelated_bad_ddl")?.[0]?.columns).toEqual([]);
    expect(catalog.issues).toHaveLength(1);
  });

  it("binds UNION output through a dynamic partition only when Input Pack proves it", () => {
    const f = fixture();
    runInputPackMachineFacts({
      dataRoot: f.dataRoot,
      taskIds: ["800"],
      outputRoot: f.factsRoot,
    });
    const bindings = jsonl(
      join(
        f.factsRoot,
        "registry",
        "tasks",
        "800",
        "bundle",
        "output-field-bindings.jsonl",
      ),
    );
    expect(bindings).toHaveLength(2);
    expect(
      bindings.find((binding) => binding.target_field === "value_col"),
    ).toMatchObject({ evidence_kind: "SQL_EXPLICIT_WRITE" });
    expect(
      bindings.find((binding) => binding.target_field === "p")
        ?.static_partition_columns,
    ).toEqual(["p"]);
  });

  it("uses each explicit SQL write target's schema and partition evidence", () => {
    const f = fixture();
    writeTaskInput(f.dataRoot, {
      taskId: "cross-target-writes",
      taskCategory: "hiveTask",
      taskName: "cross.target.writes",
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
            "INSERT OVERWRITE TABLE demo.root SELECT src_a, src_a FROM demo.extra; INSERT OVERWRITE TABLE demo.partitioned PARTITION(p) SELECT src_a, 'A' AS p FROM demo.extra;",
          evidenceProvider: "synthetic:test",
        },
      },
      evidenceProvider: "synthetic:test",
      collectedAt: "2026-01-01T00:00:00.000Z",
    });

    const result = runInputPackMachineFacts({
      dataRoot: f.dataRoot,
      taskIds: ["cross-target-writes"],
      outputRoot: f.factsRoot,
    });
    expect(result.tasks[0]?.state).toBe("SUCCESS");
    const bundle = join(
      f.factsRoot,
      "registry",
      "tasks",
      "cross-target-writes",
      "bundle",
    );
    const bindings = jsonl(join(bundle, "output-field-bindings.jsonl"));
    expect(bindings).toHaveLength(4);
    expect(
      bindings.filter((binding) => binding.target_dataset === "demo.root"),
    ).toHaveLength(2);
    const partitionBindings = bindings.filter(
      (binding) => binding.target_dataset === "demo.partitioned",
    );
    expect(partitionBindings).toHaveLength(2);
    expect(
      partitionBindings.every(
        (binding) => {
          const columns = Array.isArray(binding.static_partition_columns)
            ? binding.static_partition_columns
            : [];
          return columns.length === 1 && columns[0] === "p";
        },
      ),
    ).toBe(true);
    expect(
      jsonl(join(bundle, "unknowns.jsonl")).some(
        (unknown) => unknown.reason_code === "DYNAMIC_PARTITION_BINDING_NOT_PROVABLE",
      ),
    ).toBe(false);
  });

  it("matches partition evidence by source span after non-write statements", () => {
    const f = fixture();
    writeTaskInput(f.dataRoot, {
      taskId: "partition-write-span",
      taskCategory: "hiveTask",
      taskName: "partition.write.span",
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
            "SELECT src_a AS out_a, src_a AS out_b FROM demo.extra; " +
            "INSERT OVERWRITE TABLE demo.partitioned PARTITION(p) SELECT src_a, 'A' AS p FROM demo.extra; " +
            "INSERT OVERWRITE TABLE demo.partitioned PARTITION(p) SELECT src_a, 'B' AS p FROM demo.extra;",
          evidenceProvider: "synthetic:test",
        },
      },
      evidenceProvider: "synthetic:test",
      collectedAt: "2026-01-01T00:00:00.000Z",
    });

    const result = runInputPackMachineFacts({
      dataRoot: f.dataRoot,
      taskIds: ["partition-write-span"],
      outputRoot: f.factsRoot,
    });
    expect(result.tasks[0]?.state).toBe("SUCCESS");
    const bundle = join(
      f.factsRoot,
      "registry",
      "tasks",
      "partition-write-span",
      "bundle",
    );
    const bindings = jsonl(join(bundle, "output-field-bindings.jsonl"));
    expect(
      bindings.filter((binding) => binding.target_dataset === "demo.partitioned"),
    ).toHaveLength(4);
    expect(
      jsonl(join(bundle, "unknowns.jsonl")).some(
        (unknown) => unknown.reason_code === "DYNAMIC_PARTITION_BINDING_NOT_PROVABLE",
      ),
    ).toBe(false);
  });

  it("matches canonical partition evidence to a bare SQL write target", () => {
    const f = fixture();
    writeTableInput(f.dataRoot, {
      platform: "hive",
      dataSource: "warehouse",
      qualifiedName: "pdata_n.bare_target",
      objectType: "hive_table",
      partitionFields: ["p"],
      ddl: "CREATE TABLE pdata_n.bare_target (value_col STRING) PARTITIONED BY (p STRING);",
      evidenceProvider: "synthetic:test",
      collectedAt: "2026-01-01T00:00:00.000Z",
    });
    writeTaskInput(f.dataRoot, {
      taskId: "bare-target-evidence",
      taskCategory: "hiveTask",
      taskName: "bare.target.evidence",
      target: {
        platform: "hive",
        dataSource: "warehouse",
        qualifiedName: "pdata_n.bare_target",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
      partition: null,
      sql: {
        query: {
          content:
            "INSERT OVERWRITE TABLE BARE_TARGET PARTITION(p) SELECT src_a, 'A' AS p FROM demo.extra;",
          evidenceProvider: "synthetic:test",
        },
      },
      evidenceProvider: "synthetic:test",
      collectedAt: "2026-01-01T00:00:00.000Z",
    });

    const result = runInputPackMachineFacts({
      dataRoot: f.dataRoot,
      taskIds: ["bare-target-evidence"],
      outputRoot: f.factsRoot,
    });
    expect(result.tasks[0]?.state).toBe("SUCCESS");
    const bundle = join(
      f.factsRoot,
      "registry",
      "tasks",
      "bare-target-evidence",
      "bundle",
    );
    const bindings = jsonl(join(bundle, "output-field-bindings.jsonl"));
    expect(bindings).toHaveLength(2);
    expect(bindings.every((binding) => binding.target_dataset === "pdata_n.bare_target")).toBe(true);
    expect(
      jsonl(join(bundle, "unknowns.jsonl")).some(
        (unknown) => unknown.reason_code === "DYNAMIC_PARTITION_BINDING_NOT_PROVABLE",
      ),
    ).toBe(false);
  });

  it("freezes every canonical SQL slot while analyzing Task-local CTAS in one derived snapshot", () => {
    const f = fixture();
    const prepared = prepareInputPackTask({
      dataRoot: f.dataRoot,
      taskId: "1000",
    });
    expect(prepared.sql.slot).toBe("multi");
    expect(prepared.sqlSources.map((source) => source.slot)).toEqual([
      "create",
      "query",
    ]);
    runInputPackMachineFacts({
      dataRoot: f.dataRoot,
      taskIds: ["1000"],
      outputRoot: f.factsRoot,
    });
    for (const source of prepared.sqlSources)
      expect(
        existsSync(
          join(
            f.factsRoot,
            "input-pack-sources",
            "1000",
            `${source.slot}-${source.sha256}.sql`,
          ),
        ),
      ).toBe(true);
    const bundle = join(f.factsRoot, "registry", "tasks", "1000", "bundle");
    const manifest = JSON.parse(
      readFileSync(join(bundle, "manifest.json"), "utf8"),
    );
    expect(manifest.inputs.input_pack.sql_sources).toHaveLength(2);
    const statements = jsonl(join(bundle, "statements.jsonl"));
    expect(
      statements.some((statement) =>
        String(statement.statement_id).includes(":slot:create:"),
      ),
    ).toBe(true);
    expect(
      statements.some((statement) =>
        String(statement.statement_id).includes(":slot:query:"),
      ),
    ).toBe(true);
    const targets = new Set(
      jsonl(join(bundle, "output-field-bindings.jsonl")).map(
        (binding) => binding.target_dataset,
      ),
    );
    expect(targets).toEqual(
      new Set(["demo.root", "temp.local_stage", "temp.mid_stage"]),
    );
  });

  it("terminates derived SQL slots without changing canonical SQL or slot statement IDs", () => {
    const f = fixture();
    const querySql =
      "SELECT src_a FROM demo.extra; SELECT src_a FROM (SELECT src_a FROM demo.extra) castTable";
    const finishSql =
      "CREATE TABLE demo.boundary AS SELECT src_a FROM demo.extra";
    writeTaskInput(f.dataRoot, {
      taskId: "boundary",
      taskCategory: "sparkIndex",
      taskName: "multi.slot.boundary",
      target: {
        platform: "hive",
        dataSource: "warehouse",
        qualifiedName: "demo.root",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
      partition: null,
      sql: {
        query: { content: querySql, evidenceProvider: "synthetic:test" },
        finish: { content: finishSql, evidenceProvider: "synthetic:test" },
      },
      evidenceProvider: "synthetic:test",
      collectedAt: "2026-01-01T00:00:00.000Z",
    });

    const prepared = prepareInputPackTask({
      dataRoot: f.dataRoot,
      taskId: "boundary",
    });
    expect(prepared.sqlSources.map((source) => source.content)).toEqual([
      querySql,
      finishSql,
    ]);
    expect(prepared.sql.content).toBe(
      `${querySql}\n;\n${finishSql}\n`,
    );
    expect(prepared.sqlSegments).toEqual([
      { slot: "query", start: 0, end: querySql.length + 2 },
      {
        slot: "finish",
        start: querySql.length + 3,
        end: querySql.length + 3 + finishSql.length + 1,
      },
    ]);

    runInputPackMachineFacts({
      dataRoot: f.dataRoot,
      taskIds: ["boundary"],
      outputRoot: f.factsRoot,
    });
    const statements = jsonl(
      join(f.factsRoot, "registry", "tasks", "boundary", "bundle", "statements.jsonl"),
    );
    expect(statements.map((statement) => statement.statement_id)).toEqual([
      "task:boundary:slot:query:statement:0",
      "task:boundary:slot:query:statement:1",
      "task:boundary:slot:finish:statement:0",
    ]);
  });
});
