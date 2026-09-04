import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  writeTableInput,
  writeTaskInput,
  type TaskEvidence,
} from "../scripts/input/shared/input-pack.ts";
import {
  extractSqlDirectReads,
  extractSqlWrites,
  reconcileOneHopBatch,
  producerIndexPathFromArgs,
  reconcileOneHop,
  summarizeOneHop,
  summaryPathFromOutput,
  type OpenCliRunner,
} from "../scripts/reconcile/consumer/one-hop/reconcile-one-hop.ts";
import {
  buildTableProducerIndex,
  type TableProducerIndex,
} from "../scripts/reconcile/producer/producer-index.ts";
import { scheduleEvidenceCachePath } from "../scripts/reconcile/consumer/one-hop/schedule-evidence-cache.ts";

const frozen86840It = existsSync(
  join(
    import.meta.dirname,
    "fixtures",
    "reconcile-one-hop",
    "86840-input-pack",
  ),
)
  ? it
  : it.skip;

function fixtureRoot(): string {
  return mkdtempSync(join(tmpdir(), "sql-lineage-one-hop-"));
}

function materializeFrozenInputPack(sourceRoot: string): string {
  const dataRoot = fixtureRoot();
  cpSync(sourceRoot, dataRoot, { recursive: true });
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      const normalizeEvidenceFile = (relativePath: string): void => {
        const evidencePath = join(directory, relativePath);
        const normalized = readFileSync(evidencePath, "utf8").replaceAll(
          "\r\n",
          "\n",
        );
        writeFileSync(
          evidencePath,
          normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized,
        );
      };
      if (entry.name === "task.json") {
        const task = JSON.parse(readFileSync(absolutePath, "utf8")) as {
          sqlFiles?: { path: string }[];
        };
        for (const sqlFile of task.sqlFiles ?? []) {
          normalizeEvidenceFile(sqlFile.path);
        }
      }
      if (entry.name === "table.json") {
        const table = JSON.parse(readFileSync(absolutePath, "utf8")) as {
          ddlFile?: { path: string };
        };
        if (table.ddlFile) normalizeEvidenceFile(table.ddlFile.path);
      }
    }
  };
  visit(dataRoot);
  return dataRoot;
}

function writeTable(
  dataRoot: string,
  qualifiedName: string,
  partitionFields?: readonly string[],
): string {
  const [schema, name] = qualifiedName.split(".");
  return writeTableInput(dataRoot, {
    platform: "hive",
    dataSource: "gfhive",
    qualifiedName,
    schema,
    name,
    objectType: "TABLE",
    ddl: `CREATE TABLE ${qualifiedName} (id bigint)${
      partitionFields && partitionFields.length > 0
        ? ` PARTITIONED BY (${partitionFields
            .map((field) => `${field} string`)
            .join(", ")})`
        : ""
    }`,
    evidenceProvider: "fixture:table",
    collectedAt: "2026-08-23T00:00:00.000Z",
    ...(partitionFields === undefined ? {} : { partitionFields }),
  }).directory;
}

function writeTask(
  dataRoot: string,
  taskId: string,
  evidence: Omit<TaskEvidence, "taskId" | "taskCategory" | "collectedAt">,
): void {
  writeTaskInput(dataRoot, {
    taskId,
    taskCategory: "hiveTask-2.0",
    collectedAt: "2026-08-23T00:00:00.000Z",
    ...evidence,
  });
}

function writeProducerIndexFixture(options?: { partial?: boolean }): {
  dataRoot: string;
  producerIndex: TableProducerIndex;
} {
  const dataRoot = fixtureRoot();
  for (const table of ["src.shared", "mart.current", "raw.seed"])
    writeTable(dataRoot, table);

  writeTask(dataRoot, "current-indexed", {
    sql: {
      query: {
        content:
          "INSERT OVERWRITE TABLE mart.current SELECT id FROM src.shared",
        evidenceProvider: "fixture:sql",
      },
    },
    target: {
      platform: "hive",
      dataSource: "gfhive",
      qualifiedName: "mart.current",
    },
    targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
    evidenceProvider: "fixture:task",
  });
  writeTask(dataRoot, "producer-direct", {
    sql: {
      query: {
        content:
          "INSERT OVERWRITE TABLE src.shared PARTITION (busi_date='2026-08-23') SELECT id FROM raw.seed",
        evidenceProvider: "fixture:sql",
      },
    },
    target: {
      platform: "hive",
      dataSource: "gfhive",
      qualifiedName: "src.shared",
    },
    targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
    partition: { busi_date: "${busi_date}" },
    evidenceProvider: "fixture:task",
  });
  writeTask(dataRoot, "producer-not-direct", {
    sql: {
      query: {
        content: "INSERT INTO src.shared SELECT id FROM raw.seed",
        evidenceProvider: "fixture:sql",
      },
    },
    target: {
      platform: "hive",
      dataSource: "gfhive",
      qualifiedName: "src.shared",
    },
    targetEvidenceKind: "SQL_EXACT_TABLE_TARGET",
    evidenceProvider:
      "fixture:task+sql-mcp:explicit-table-target+opencli:szdata.table-guid",
  });
  writeTask(dataRoot, "candidate-unknown", {
    target: {
      platform: "hive",
      dataSource: "gfhive",
      qualifiedName: "src.shared",
    },
    targetEvidenceKind: "TABLE_TASK_RELATION_DIRECTION_UNKNOWN",
    evidenceProvider: "fixture:table-task-relation",
  });

  if (options?.partial) {
    writeTask(dataRoot, "invalid-unrelated", {
      sql: {
        query: {
          content: "SELECT id FROM raw.seed",
          evidenceProvider: "fixture:sql",
        },
      },
      target: null,
      targetEvidenceKind: null,
      evidenceProvider: "fixture:task",
    });
    const invalidDirectory = join(
      dataRoot,
      "tasks",
      "hiveTask-2.0",
      "invalid-unrelated",
    );
    const invalidTask = JSON.parse(
      readFileSync(join(invalidDirectory, "task.json"), "utf8"),
    ) as { sqlFiles: { path: string }[] };
    const invalidPath = join(invalidDirectory, invalidTask.sqlFiles[0]!.path);
    writeFileSync(invalidPath, "SELECT changed_after_hash FROM raw.seed");
  }

  return {
    dataRoot,
    producerIndex: buildTableProducerIndex(dataRoot, {
      now: () => "2026-08-23T00:30:00.000Z",
    }),
  };
}

describe("reconcileOneHop", () => {
  it("uses authoritative task-keyed schedule evidence and preserves metadata", () => {
    const fixture = writeProducerIndexFixture();
    let calls = 0;
    const evidence = new Map([
      ["current-indexed", { rows: [{ task_id: "parent-a" }], provider: "opencli:horae.relation", locator: "test:a", observedAt: "2026-08-27T00:00:01.000Z" }],
    ]);
    const result = reconcileOneHop("current-indexed", { dataRoot: fixture.dataRoot, producerIndex: fixture.producerIndex, scheduleEvidenceByTaskId: evidence, openCliRunner: () => { calls += 1; return []; } });
    expect(result.schedule.parents[0]?.taskId).toBe("parent-a");
    expect(result.schedule.evidence[0]?.provider).toBe("opencli:horae.relation");
    expect(result.schedule.evidence[0]?.locator).toBe("test:a");
    expect(result.schedule.evidence[0]?.observedAt).toBe("2026-08-27T00:00:01.000Z");
    expect(calls).toBe(0);
    evidence.delete("current-indexed");
    expect(() => reconcileOneHop("current-indexed", { dataRoot: fixture.dataRoot, producerIndex: fixture.producerIndex, scheduleEvidenceByTaskId: evidence, openCliRunner: () => { calls += 1; return []; } })).toThrow("SCHEDULE_EVIDENCE_MISSING");
    expect(calls).toBe(0);
  });

  it("reads through the fixed-shape Horae relation cache for direct one-hop runs", () => {
    const fixture = writeProducerIndexFixture();
    const cacheRoot = fixtureRoot();
    let calls = 0;
    const runner: OpenCliRunner = () => {
      calls += 1;
      return [{ task_id: "parent-a", task_name: "cached parent" }];
    };

    const first = reconcileOneHop("current-indexed", {
      dataRoot: fixture.dataRoot,
      producerIndex: fixture.producerIndex,
      openCliRunner: runner,
      scheduleEvidenceCacheRoot: cacheRoot,
      now: () => "2026-08-27T00:00:00.000Z",
    });
    expect(calls).toBe(1);
    expect(first.schedule.parents.map((parent) => parent.taskId)).toEqual([
      "parent-a",
    ]);
    const cachePath = scheduleEvidenceCachePath("current-indexed", cacheRoot);
    expect(
      scheduleEvidenceCachePath(
        "current-indexed",
        join(cacheRoot, "schedule-evidence"),
      ),
    ).toBe(cachePath);
    expect(existsSync(cachePath)).toBe(true);
    expect(first.schedule.evidence[0]?.detail).toMatchObject({
      cacheStatus: "MISS",
      cachePath,
    });

    const second = reconcileOneHop("current-indexed", {
      dataRoot: fixture.dataRoot,
      producerIndex: fixture.producerIndex,
      openCliRunner: runner,
      scheduleEvidenceCacheRoot: cacheRoot,
      now: () => "2026-08-27T00:00:01.000Z",
    });
    expect(calls).toBe(1);
    expect(second.schedule.parents.map((parent) => parent.taskId)).toEqual([
      "parent-a",
    ]);
    expect(second.schedule.evidence[0]?.detail).toMatchObject({
      cacheStatus: "HIT",
      cachePath,
    });

    writeFileSync(cachePath, JSON.stringify({ task_id: "wrong" }), "utf8");
    const third = reconcileOneHop("current-indexed", {
      dataRoot: fixture.dataRoot,
      producerIndex: fixture.producerIndex,
      openCliRunner: runner,
      scheduleEvidenceCacheRoot: cacheRoot,
      now: () => "2026-08-27T00:00:02.000Z",
    });
    expect(calls).toBe(2);
    expect(third.schedule.evidence[0]?.detail).toMatchObject({
      cacheStatus: "INVALID",
      cachePath,
    });
  });

  it("retains a configured terminal table as a direct read without producer expansion", () => {
    const dataRoot = fixtureRoot();
    writeTable(dataRoot, "pdata_n.ref_cd_cvt_map");
    writeTable(dataRoot, "mart.current");
    writeTask(dataRoot, "current", {
      sql: {
        query: {
          content: "INSERT OVERWRITE TABLE mart.current SELECT id FROM pdata_n.ref_cd_cvt_map",
          evidenceProvider: "fixture:sql",
        },
      },
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "mart.current",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
      evidenceProvider: "fixture:task",
    });
    writeTask(dataRoot, "map-producer", {
      sql: {
        query: {
          content: "INSERT OVERWRITE TABLE pdata_n.ref_cd_cvt_map SELECT id FROM raw.seed",
          evidenceProvider: "fixture:sql",
        },
      },
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "pdata_n.ref_cd_cvt_map",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
      evidenceProvider: "fixture:task",
    });
    writeTable(dataRoot, "raw.seed");
    const terminalTableConfig = {
      version: "test",
      stopRoles: ["REFERENCE_CONFIG"],
      roles: {
        REFERENCE_CONFIG: {
          qualifiedNameExact: ["pdata_n.ref_cd_cvt_map"],
          qualifiedNameTerms: ["never-match"],
        },
      },
    } as const;
    const producerIndex = buildTableProducerIndex(dataRoot, {
      now: () => "2026-08-23T00:30:00.000Z",
    });

    const result = reconcileOneHop("current", {
      dataRoot,
      producerIndex,
      scheduleRows: [],
      terminalTableConfig,
    });

    expect(result.currentTask.directReads.map((read) => read.table.qualifiedName)).toContain(
      "pdata_n.ref_cd_cvt_map",
    );
    expect(result.dataPath.confirmedProducers).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "map-producer",
          table: expect.objectContaining({
            qualifiedName: "pdata_n.ref_cd_cvt_map",
          }),
        }),
      ]),
    );
    expect(result.reconciliation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "SQL_ONLY",
          reason: "REFERENCE_CONFIG",
          table: expect.objectContaining({
            qualifiedName: "pdata_n.ref_cd_cvt_map",
          }),
        }),
      ]),
    );
    expect(result.nextDataTaskIds).not.toContain("map-producer");
  });
  it("builds a concise sidecar summary without embedding evidence", () => {
    const fixture = writeProducerIndexFixture();
    const result = reconcileOneHop("current-indexed", {
      dataRoot: fixture.dataRoot,
      producerIndex: fixture.producerIndex,
      openCliRunner: () => [],
      now: () => "2026-08-23T00:30:00.000Z",
    });

    const summary = summarizeOneHop(result);
    expect(summary).toMatchObject({
      artifactType: "ONE_HOP_RECONCILIATION_SUMMARY",
      taskId: "current-indexed",
      counts: result.counts,
      producerIndex: { status: "VALID_SUCCESS" },
      nextDataTaskIds: result.nextDataTaskIds,
    });
    expect(summary.directReadTables).toEqual(["src.shared"]);
    expect(summary.missingTaskInputPackTaskIds).toEqual([]);
    expect(summary.confirmedProducers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "producer-direct",
          table: "src.shared",
          scheduleRelation: "NOT_DIRECT_PARENT",
        }),
      ]),
    );
    expect(summary).not.toHaveProperty("parents");
    expect(summary).not.toHaveProperty("reconciliation");
    expect(summaryPathFromOutput("results/86840.json")).toBe(
      "results/86840.summary.json",
    );
  });

  it("reuses a prepared catalog for a batch root", () => {
    const fixture = writeProducerIndexFixture();
    const standalone = reconcileOneHop("current-indexed", {
      dataRoot: fixture.dataRoot,
      producerIndex: fixture.producerIndex,
      openCliRunner: () => [],
      now: () => "2026-08-23T00:30:00.000Z",
    });
    const [prepared] = reconcileOneHopBatch(["current-indexed"], {
      dataRoot: fixture.dataRoot,
      producerIndex: fixture.producerIndex,
      openCliRunner: () => [],
      now: () => "2026-08-23T00:30:00.000Z",
    });

    const omitVolatile = (value: typeof standalone) => {
      const { generatedAt: _generatedAt, ...stable } = value;
      return stable;
    };
    expect(omitVolatile(prepared!)).toEqual(omitVolatile(standalone));
  });

  it("qualifies a bare read with the proven Task Pack schema", () => {
    const dataRoot = fixtureRoot();
    writeTable(dataRoot, "pdata_news_n.t02_scr_base_info");
    writeTask(dataRoot, "103234", {
      taskName: "pdata_news_n.t02_tit_scr_base_info_TIT_ref_instrument_grp01",
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "pdata_news_n.t02_tit_scr_base_info",
      },
      targetEvidenceKind: "TABLE_TASK_RELATION_DIRECTION_UNKNOWN",
      sql: {
        query: {
          content: "SELECT b.id FROM t02_scr_base_info b",
          evidenceProvider: "fixture:sql",
        },
      },
      evidenceProvider: "fixture:table-task-relation",
    });

    const result = reconcileOneHop("103234", {
      dataRoot,
      openCliRunner: () => [],
      now: () => "2026-08-24T00:00:00.000Z",
    });

    expect(result.currentTask.directReads).toEqual([
      expect.objectContaining({
        table: {
          platform: "hive",
          dataSource: "gfhive",
          qualifiedName: "pdata_news_n.t02_scr_base_info",
          identityStatus: "RESOLVED",
        },
        sql: expect.objectContaining({
          qualifiedName: "pdata_news_n.t02_scr_base_info",
        }),
      }),
    ]);
  });

  it("extracts direct reads and partitioned writes with SQL provenance", () => {
    const sql = `
      INSERT OVERWRITE TABLE mart.output
      PARTITION (busi_date = '2026-08-23', grp_id = \${branch})
      SELECT a.id
      FROM src.a a
      JOIN src.b b ON a.id = b.id
    `;

    expect(
      extractSqlDirectReads(sql, "databricks").map(
        (item) => item.qualifiedName,
      ),
    ).toEqual(["src.a", "src.b"]);
    expect(extractSqlWrites(sql)).toEqual([
      expect.objectContaining({
        qualifiedName: "mart.output",
        writeKind: "INSERT_OVERWRITE",
        partition: [
          {
            field: "busi_date",
            expression: "'2026-08-23'",
            valueStatus: "OBSERVED_RENDERED_VALUE",
            observedValue: "2026-08-23",
          },
          {
            field: "grp_id",
            expression: "${branch}",
            valueStatus: "RUNTIME_EXPRESSION",
            observedValue: null,
          },
        ],
      }),
    ]);
  });

  it("extracts reads from a repeated platform response without duplicating the read", () => {
    const sql = "SELECT id FROM src.a\n\nSELECT id FROM src.a";
    expect(extractSqlDirectReads(sql, "databricks")).toEqual([
      expect.objectContaining({ qualifiedName: "src.a" }),
    ]);
  });

  it("uses adaptor predicates and table partition metadata for one-hop matching", () => {
    const dataRoot = fixtureRoot();
    writeTable(dataRoot, "src.partitioned", ["busi_date"]);
    writeTable(dataRoot, "raw.seed");
    writeTable(dataRoot, "mart.current");
    writeTask(dataRoot, "current-partitioned", {
      sql: {
        query: {
          content:
            "SELECT id FROM src.partitioned WHERE busi_date = '2026-08-23'; SELECT id FROM src.partitioned WHERE busi_date = '2026-08-24'",
          evidenceProvider: "fixture:sql",
        },
      },
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "mart.current",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
      evidenceProvider: "fixture:task",
    });
    writeTask(dataRoot, "producer-partitioned", {
      sql: {
        query: {
          content:
            "INSERT OVERWRITE TABLE src.partitioned PARTITION (busi_date = '2026-08-23') SELECT id FROM raw.seed",
          evidenceProvider: "fixture:sql",
        },
      },
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "src.partitioned",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
      partition: { busi_date: "2026-08-23" },
      evidenceProvider: "fixture:task",
    });
    writeTask(dataRoot, "producer-partitioned-2", {
      sql: {
        query: {
          content:
            "INSERT OVERWRITE TABLE src.partitioned PARTITION (busi_date = '2026-08-24') SELECT id FROM raw.seed",
          evidenceProvider: "fixture:sql",
        },
      },
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "src.partitioned",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
      partition: { busi_date: "2026-08-24" },
      evidenceProvider: "fixture:task",
    });
    writeTask(dataRoot, "producer-partitioned-3", {
      sql: {
        query: {
          content:
            "INSERT OVERWRITE TABLE src.partitioned PARTITION (busi_date = '2026-08-25') SELECT id FROM raw.seed",
          evidenceProvider: "fixture:sql",
        },
      },
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "src.partitioned",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
      partition: { busi_date: "2026-08-25" },
      evidenceProvider: "fixture:task",
    });

    const producerIndex = buildTableProducerIndex(dataRoot);
    const result = reconcileOneHop("current-partitioned", {
      dataRoot,
      producerIndex,
      openCliRunner: () => [],
    });
    expect(result.currentTask.directReads[0]?.readPartitionScopes).toHaveLength(
      2,
    );
    expect(
      result.currentTask.directReads[0]?.readPartitionScopes.map(
        (occurrence) => occurrence.scope.status,
      ),
    ).toEqual(["CONSTRAINED", "CONSTRAINED"]);
    expect(result.partitionAwareNextDataTaskIds).toEqual({
      candidates: ["producer-partitioned", "producer-partitioned-2"],
      proven: ["producer-partitioned", "producer-partitioned-2"],
      possible: [],
      unknown: [],
    });
    expect(result.nextDataTaskIds).toEqual([
      "producer-partitioned",
      "producer-partitioned-2",
      "producer-partitioned-3",
    ]);
    expect(
      result.dataPath.confirmedProducers.find(
        (producer) => producer.taskId === "producer-partitioned-3",
      )?.partitionMatch.status,
    ).toBe("PROVEN_DISJOINT");
    const summary = summarizeOneHop(result);
    expect(summary.confirmedProducers.map((producer) => producer.taskId)).toEqual([
      "producer-partitioned",
      "producer-partitioned-2",
    ]);
    expect(summary.confirmedProducers[0]?.partitionMatch.status).toBe(
      "PROVEN_OVERLAP",
    );
    expect(summary.confirmedProducers[0]?.partitionMatch.partitions).toEqual([
      [
        expect.objectContaining({
          field: "busi_date",
          observedValue: "2026-08-23",
        }),
      ],
    ]);
    expect(summary.excludedProducers).toEqual([
      expect.objectContaining({
        taskId: "producer-partitioned-3",
        partitionMatch: expect.objectContaining({
          status: "PROVEN_DISJOINT",
          reasonCodes: ["PARTITION_VALUE_DISJOINT"],
        }),
      }),
    ]);
    expect(summary.dataPath).toMatchObject({
      confirmedProducerCount: 2,
      excludedProducerCount: 1,
    });
    expect(result.coverage.partitionScopes.multiProducerTables).toBe(1);
  });

  it("prefers a scheduled producer when data-only producers write the same table", () => {
    const dataRoot = fixtureRoot();
    writeTable(dataRoot, "src.shared");
    writeTable(dataRoot, "mart.current");
    writeTable(dataRoot, "raw.seed");
    writeTask(dataRoot, "current-same-table", {
      sql: {
        query: {
          content: "SELECT id FROM src.shared",
          evidenceProvider: "fixture:sql",
        },
      },
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "mart.current",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
      evidenceProvider: "fixture:task",
    });
    for (const taskId of ["scheduled-producer", "alternate-producer"]) {
      writeTask(dataRoot, taskId, {
        sql: {
          query: {
            content:
              "INSERT OVERWRITE TABLE src.shared SELECT id FROM raw.seed",
            evidenceProvider: "fixture:sql",
          },
        },
        target: {
          platform: "hive",
          dataSource: "gfhive",
          qualifiedName: "src.shared",
        },
        targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
        evidenceProvider: "fixture:task",
      });
    }

    const result = reconcileOneHop("current-same-table", {
      dataRoot,
      producerIndex: buildTableProducerIndex(dataRoot),
      openCliRunner: (args) =>
        args[0] === "horae"
          ? [{ task_id: "scheduled-producer", direction: "上游" }]
          : [],
    });

    expect(result.nextDataTaskIds).toEqual([
      "alternate-producer",
      "scheduled-producer",
    ]);
    expect(result.finalUpstreamTaskIds).toEqual({
      primary: ["scheduled-producer"],
      additional: [],
      unknown: [],
      decision: "SCHEDULE_DATA_INTERSECTION",
    });
    expect(
      result.dataPath.confirmedProducers.find(
        (producer) => producer.taskId === "alternate-producer",
      )?.scheduleRelation,
    ).toBe("NOT_DIRECT_PARENT");
  });

  it("fails closed when unscheduled overwrite producers overlap the same table", () => {
    const dataRoot = fixtureRoot();
    for (const table of ["src.shared", "mart.current", "raw.seed"])
      writeTable(dataRoot, table);
    writeTask(dataRoot, "current-overlap", {
      sql: {
        query: {
          content: "SELECT id FROM src.shared",
          evidenceProvider: "fixture:sql",
        },
      },
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "mart.current",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
      evidenceProvider: "fixture:task",
    });
    for (const taskId of ["overwrite-a", "overwrite-b"])
      writeTask(dataRoot, taskId, {
        sql: {
          query: {
            content:
              "INSERT OVERWRITE TABLE src.shared SELECT id FROM raw.seed",
            evidenceProvider: "fixture:sql",
          },
        },
        target: {
          platform: "hive",
          dataSource: "gfhive",
          qualifiedName: "src.shared",
        },
        targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
        evidenceProvider: "fixture:task",
      });

    const result = reconcileOneHop("current-overlap", {
      dataRoot,
      producerIndex: buildTableProducerIndex(dataRoot),
      openCliRunner: () => [],
    });

    expect(result.finalUpstreamTaskIds).toEqual({
      primary: [],
      additional: [],
      unknown: ["overwrite-a", "overwrite-b"],
      decision: "MULTIPLE_OVERLAPPING_PRODUCERS",
    });
  });

  it("selects scheduled producers per read occurrence when one table is read through disjoint partitions", () => {
    const dataRoot = fixtureRoot();
    writeTable(dataRoot, "src.shared_history", ["src_tbl"]);
    writeTable(dataRoot, "mart.current");
    writeTable(dataRoot, "raw.seed");
    writeTask(dataRoot, "current-occurrences", {
      sql: {
        query: {
          content: `SELECT c.id AS trade_id, k.id AS book_id
FROM (SELECT id FROM src.shared_history WHERE src_tbl = 'TRADE') c
JOIN (SELECT id FROM src.shared_history WHERE src_tbl = 'BOOK') k
  ON c.id = k.id`,
          evidenceProvider: "fixture:sql",
        },
      },
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "mart.current",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
      evidenceProvider: "fixture:task",
    });
    for (const [taskId, srcTbl] of [
      ["book-direct", "BOOK"],
      ["trade-direct", "TRADE"],
      ["trade-alternate", "TRADE"],
    ] as const) {
      writeTask(dataRoot, taskId, {
        sql: {
          query: {
            content: `INSERT OVERWRITE TABLE src.shared_history PARTITION (src_tbl='${srcTbl}') SELECT id FROM raw.seed`,
            evidenceProvider: "fixture:sql",
          },
        },
        target: {
          platform: "hive",
          dataSource: "gfhive",
          qualifiedName: "src.shared_history",
        },
        targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
        partition: { src_tbl: srcTbl },
        evidenceProvider: "fixture:task",
      });
    }

    const result = reconcileOneHop("current-occurrences", {
      dataRoot,
      producerIndex: buildTableProducerIndex(dataRoot),
      openCliRunner: (args) =>
        args[0] === "horae"
          ? [
              { task_id: "book-direct", direction: "上游" },
              { task_id: "trade-direct", direction: "上游" },
            ]
          : [],
    });

    expect(result.currentTask.directReads[0]?.readPartitionScopes).toHaveLength(
      2,
    );
    expect(result.finalUpstreamTaskIds).toEqual({
      primary: ["book-direct", "trade-direct"],
      additional: [],
      unknown: [],
      decision: "SCHEDULE_DATA_INTERSECTION",
    });
  });

  it("binds a table-specific filter while retaining the cross-table JOIN as evidence", () => {
    const dataRoot = fixtureRoot();
    writeTable(dataRoot, "src.partitioned", ["busi_date"]);
    writeTable(dataRoot, "raw.seed");
    writeTable(dataRoot, "mart.current");
    writeTask(dataRoot, "current-ambiguous-filter", {
      sql: {
        query: {
          content:
            "SELECT p.id FROM src.partitioned p JOIN raw.seed s ON p.id = s.id WHERE p.busi_date = '2026-08-23'",
          evidenceProvider: "fixture:sql",
        },
      },
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "mart.current",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
      evidenceProvider: "fixture:task",
    });
    writeTask(dataRoot, "producer-ambiguous-filter", {
      sql: {
        query: {
          content:
            "INSERT OVERWRITE TABLE src.partitioned PARTITION (busi_date = '2026-08-23') SELECT id FROM raw.seed",
          evidenceProvider: "fixture:sql",
        },
      },
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "src.partitioned",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
      partition: { busi_date: "2026-08-23" },
      evidenceProvider: "fixture:task",
    });

    const result = reconcileOneHop("current-ambiguous-filter", {
      dataRoot,
      producerIndex: buildTableProducerIndex(dataRoot),
      openCliRunner: () => [],
    });
    const sourceRead = result.currentTask.directReads.find(
      (read) => read.table.qualifiedName === "src.partitioned",
    );
    expect(sourceRead?.readPartitionScopes[0]?.scope.status).toBe("CONSTRAINED");
    expect(sourceRead?.readPartitionScopes[0]?.scope.reasonCodes).toContain(
      "READ_OCCURRENCE_CROSS_TABLE_PREDICATE_NOT_PUSHDOWN",
    );
    expect(result.partitionAwareNextDataTaskIds).toEqual({
      candidates: ["producer-ambiguous-filter"],
      proven: ["producer-ambiguous-filter"],
      possible: [],
      unknown: [],
    });
  });

  it("ignores write-like comments and strings while retaining CTAS", () => {
    const sql = `
      -- INSERT OVERWRITE TABLE fake.comment SELECT 1;
      SELECT 'MERGE INTO fake.literal USING x ON 1=1';
      SELECT 'x\\' INSERT INTO fake.escaped_literal SELECT 1';
      /* INSERT INTO fake.block_comment SELECT 1; */
      CREATE TABLE mart.real_ctas AS SELECT 1 AS id;
    `;

    expect(
      extractSqlWrites(sql).map((item) => [item.writeKind, item.qualifiedName]),
    ).toEqual([["CTAS", "mart.real_ctas"]]);
  });

  it("rejects an explicit producer-index flag without a path", () => {
    expect(() => producerIndexPathFromArgs(["--producer-index"])).toThrow(
      "PRODUCER_INDEX_PATH_REQUIRED",
    );
    expect(() =>
      producerIndexPathFromArgs(["--producer-index", "--output", "out.json"]),
    ).toThrow("PRODUCER_INDEX_PATH_REQUIRED");
    expect(producerIndexPathFromArgs(["--task-id", "1"])).toBeUndefined();
  });

  it("keeps schedule and confirmed data traversal separate without promoting candidates", () => {
    const dataRoot = fixtureRoot();
    for (const table of ["src.a", "src.b", "src.c", "src.d"])
      writeTable(dataRoot, table);

    writeTask(dataRoot, "current1", {
      sql: {
        query: {
          content:
            "INSERT OVERWRITE TABLE mart.current SELECT a.id FROM src.a a JOIN src.b b ON a.id=b.id JOIN src.c c ON a.id=c.id",
          evidenceProvider: "fixture:sql",
        },
      },
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "mart.current",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
      evidenceProvider: "fixture:task",
    });
    writeTask(dataRoot, "parent1", {
      sql: {
        query: {
          content: "INSERT OVERWRITE TABLE src.a SELECT id FROM raw.a",
          evidenceProvider: "fixture:sql",
        },
      },
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "src.a",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
      partition: { busi_date: "${busi_date}", grp_id: "01" },
      evidenceProvider: "fixture:task",
    });
    writeTask(dataRoot, "parent2", {
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "src.d",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
      evidenceProvider: "fixture:task",
    });
    writeTask(dataRoot, "parent3", {
      sql: {
        query: {
          content: "SELECT id FROM raw.candidate_only",
          evidenceProvider: "fixture:sql",
        },
      },
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "src.b",
      },
      targetEvidenceKind: "TABLE_TASK_RELATION_DIRECTION_UNKNOWN",
      evidenceProvider: "fixture:table-task-relation",
    });

    const calls: string[][] = [];
    const runner: OpenCliRunner = (args) => {
      calls.push([...args]);
      if (args[0] === "horae")
        return [
          { task_id: "parent1", task_name: "parent one", direction: "上游" },
          { task_id: "parent2", task_name: "parent two", direction: "上游" },
          {
            task_id: "parent3",
            task_name: "candidate only",
            direction: "上游",
          },
          { task_id: "parent4", task_name: "live parent", direction: "上游" },
        ];
      if (args[0] === "szdata" && args.includes("parent4"))
        return {
          taskId: "parent4",
          target: "src.c",
          hivePartition: "-",
          loadMode: "OVERWRITE",
          evidenceLevel: "opencli_task_source",
          status: "SUCCEEDED",
        };
      throw new Error(`unexpected command: ${args.join(" ")}`);
    };

    const result = reconcileOneHop("current1", {
      dataRoot,
      openCliRunner: runner,
      now: () => "2026-08-23T01:02:03.000Z",
    });

    expect(result.counts).toEqual({
      sqlDirectReads: 3,
      scheduleParents: 4,
      matched: 2,
      sqlOnly: 1,
      scheduleOnly: 1,
      unresolved: 1,
    });
    expect(result.countSemantics).toEqual({
      reconciliationStatusUnit: "RECONCILIATION_ITEM",
      sqlDirectReadsUnit: "NORMALIZED_DIRECT_READ_REFERENCE",
      scheduleParentsUnit: "DISTINCT_TASK",
      statusesExclusivePerItem: true,
      statusesExclusivePerPhysicalTable: false,
    });
    expect(result.coverage).toMatchObject({
      semantics: "OBSERVED_EVIDENCE_ONLY",
      directReadTables: {
        total: 3,
        identityResolved: 3,
        identityUnresolved: 0,
      },
      scheduleParents: {
        total: 4,
        taskPackAvailable: 3,
        taskPackMissing: 1,
      },
      retrieval: {
        producerIndex: "NOT_REQUESTED",
        liveTaskSourceAttempts: 1,
        liveTaskSourceSuccesses: 1,
        liveTaskSourceFailures: 0,
      },
      overlaps: {
        sqlOnlyAndUnresolvedTables: 1,
      },
    });
    expect(result.nextScheduleTaskIds).toEqual([
      "parent1",
      "parent2",
      "parent3",
      "parent4",
    ]);
    expect(result.nextDataTaskIds).toEqual(["parent1", "parent4"]);
    expect(result.issueDetails).toEqual(
      expect.arrayContaining([
        {
          code: "TASK_INPUT_PACK_MISSING",
          scope: "SCHEDULE_PARENT",
          taskId: "parent4",
          taskName: "live parent",
        },
      ]),
    );
    expect(summarizeOneHop(result).missingTaskInputPackTaskIds).toEqual([
      "parent4",
    ]);
    expect(
      result.reconciliation.map((item) => [
        item.status,
        item.taskId,
        item.table.qualifiedName,
      ]),
    ).toEqual([
      ["MATCHED", "parent1", "src.a"],
      ["SCHEDULE_ONLY", "parent2", "src.d"],
      ["UNRESOLVED", "parent3", "src.b"],
      ["MATCHED", "parent4", "src.c"],
      ["SQL_ONLY", null, "src.b"],
    ]);
    expect(
      result.parents.find((item) => item.taskId === "parent3"),
    ).toMatchObject({
      resolutionStatus: "UNRESOLVED",
      confirmedWrites: [],
      unconfirmedTargets: [
        expect.objectContaining({
          qualifiedName: "src.b",
          reason: "TABLE_TASK_RELATION_DIRECTION_UNKNOWN",
        }),
      ],
    });
    const liveWrite = result.parents.find((item) => item.taskId === "parent4")
      ?.confirmedWrites[0];
    expect(liveWrite).toMatchObject({
      table: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "src.c",
        identityStatus: "RESOLVED",
      },
    });
    expect(
      liveWrite?.evidence.some((item) => item.source === "SZDATA_TASK_SOURCE"),
    ).toBe(true);
    expect(calls).toEqual([
      [
        "horae",
        "relation",
        "current1",
        "--direction",
        "up",
        "--depth",
        "1",
        "-f",
        "json",
      ],
      [
        "szdata",
        "task-source",
        "--task-id",
        "parent4",
        "-f",
        "json",
        "--timeout",
        "20",
      ],
    ]);
    expect(result.boundaries).toMatchObject({
      schedulerExecution: "NOT_EVALUATED",
      runtimeDelivery: "NOT_EVALUATED",
      businessCorrectness: "NOT_EVALUATED",
      producerCandidatesAreWrites: false,
    });
    expect(
      result.parents.find((item) => item.taskId === "parent1")
        ?.confirmedWrites[0]?.partition,
    ).toEqual([
      {
        field: "busi_date",
        expression: "${busi_date}",
        valueStatus: "RUNTIME_EXPRESSION",
        observedValue: null,
      },
      {
        field: "grp_id",
        expression: "01",
        valueStatus: "OBSERVED_RENDERED_VALUE",
        observedValue: "01",
      },
    ]);
  });

  it("consumes every confirmed producer for a read table without promoting non-confirmed candidates", () => {
    const { dataRoot, producerIndex } = writeProducerIndexFixture();
    expect(producerIndex.buildStatus).toBe("SUCCESS");
    const calls: string[][] = [];
    const runner: OpenCliRunner = (args) => {
      calls.push([...args]);
      if (args[0] === "horae")
        return [
          {
            task_id: "producer-direct",
            task_name: "direct producer",
            direction: "上游",
          },
        ];
      throw new Error(`task-source must not be called: ${args.join(" ")}`);
    };

    const result = reconcileOneHop("current-indexed", {
      dataRoot,
      producerIndex,
      openCliRunner: runner,
      now: () => "2026-08-23T01:02:03.000Z",
    });

    expect(result.producerIndex).toMatchObject({
      status: "VALID_SUCCESS",
      inputFingerprint: producerIndex.inputFingerprint,
      contentHash: producerIndex.contentHash,
    });
    expect(result.dataPath.confirmedProducers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: "producer-direct",
          scheduleRelation: "DIRECT_PARENT",
          table: expect.objectContaining({ qualifiedName: "src.shared" }),
        }),
        expect.objectContaining({
          taskId: "producer-not-direct",
          scheduleRelation: "NOT_DIRECT_PARENT",
          table: expect.objectContaining({ qualifiedName: "src.shared" }),
        }),
      ]),
    );
    expect(result.dataPath.confirmedProducers).toHaveLength(2);
    expect(result.nextDataTaskIds).toEqual([
      "producer-direct",
      "producer-not-direct",
    ]);
    expect(result.nextDataTaskIds).not.toContain("candidate-unknown");
    expect(calls).toEqual([
      [
        "horae",
        "relation",
        "current-indexed",
        "--direction",
        "up",
        "--depth",
        "1",
        "-f",
        "json",
      ],
    ]);

    // Reconciliation counts remain observation/item counts. Discovering another
    // producer for the same physical table must not rewrite the schedule result.
    expect(result.counts).toMatchObject({
      sqlDirectReads: 1,
      scheduleParents: 1,
      matched: 1,
      sqlOnly: 0,
      unresolved: 0,
    });
    expect(result.coverage).toMatchObject({
      semantics: "OBSERVED_EVIDENCE_ONLY",
      directReadTables: {
        total: 1,
        identityResolved: 1,
        identityUnresolved: 0,
        withConfirmedProducer: 1,
        withNonConfirmedOnly: 0,
        withNoProducerObservation: 0,
      },
      producerEvidenceObservations: {
        confirmedProducerEdges: 2,
        confirmedWriteObservations: 4,
        nonConfirmedRelationObservations: 1,
        directionConfirmed: 4,
        directionUnknown: 1,
        identityResolved: 5,
        identityUnresolved: 0,
      },
      retrieval: {
        producerIndex: "VALID_SUCCESS",
        liveTaskSourceAttempts: 0,
        liveTaskSourceSuccesses: 0,
        liveTaskSourceFailures: 0,
      },
      overlaps: {
        confirmedAndNonConfirmedTables: 1,
      },
    });
  });

  it("keeps mutation-only writes on the schedule path but out of data traversal", () => {
    const dataRoot = fixtureRoot();
    writeTable(dataRoot, "src.mutated");
    writeTable(dataRoot, "mart.current");
    writeTask(dataRoot, "current-mutation", {
      sql: {
        query: {
          content: "SELECT id FROM src.mutated",
          evidenceProvider: "fixture:sql",
        },
      },
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "mart.current",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
      evidenceProvider: "fixture:task",
    });
    writeTask(dataRoot, "mutation-parent", {
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "src.mutated",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
      writeMode: "truncate",
      sql: { truncate: "TRUNCATE TABLE src.mutated" },
      evidenceProvider: "fixture:task",
    });
    const producerIndex = buildTableProducerIndex(dataRoot);
    const result = reconcileOneHop("current-mutation", {
      dataRoot,
      producerIndex,
      openCliRunner: (args) =>
        args[0] === "horae"
          ? [{ task_id: "mutation-parent", direction: "上游" }]
          : null,
    });
    expect(result.nextScheduleTaskIds).toEqual(["mutation-parent"]);
    expect(result.nextDataTaskIds).toEqual([]);
    expect(result.dataPath.confirmedProducers).toEqual([]);
    expect(result.reconciliation).toEqual([
      expect.objectContaining({
        status: "MATCHED",
        taskId: "mutation-parent",
        table: expect.objectContaining({ qualifiedName: "src.mutated" }),
      }),
    ]);
  });

  it("fails closed before Horae or task-source when an explicit producer index is stale or invalid", () => {
    const staleFixture = writeProducerIndexFixture();
    writeTable(staleFixture.dataRoot, "src.added_after_index");
    const calls: string[][] = [];
    const runner: OpenCliRunner = (args) => {
      calls.push([...args]);
      return [];
    };

    expect(() =>
      reconcileOneHop("current-indexed", {
        dataRoot: staleFixture.dataRoot,
        producerIndex: staleFixture.producerIndex,
        verifyInputFingerprint: true,
        openCliRunner: runner,
      }),
    ).toThrow(/producer index.*fingerprint|fingerprint.*producer index/i);
    expect(calls).toEqual([]);

    const invalidFixture = writeProducerIndexFixture();
    const invalidIndex = {
      ...invalidFixture.producerIndex,
      contentHash: "0".repeat(64),
    } as TableProducerIndex;
    expect(() =>
      reconcileOneHop("current-indexed", {
        dataRoot: invalidFixture.dataRoot,
        producerIndex: invalidIndex,
        openCliRunner: runner,
      }),
    ).toThrow(/producer index.*contentHash|contentHash.*producer index/i);
    expect(calls).toEqual([]);
  });

  it("skips the full input fingerprint check unless explicitly requested", () => {
    const staleFixture = writeProducerIndexFixture();
    writeTable(staleFixture.dataRoot, "src.added_after_index");
    const result = reconcileOneHop("current-indexed", {
      dataRoot: staleFixture.dataRoot,
      producerIndex: staleFixture.producerIndex,
      openCliRunner: () => [],
    });
    expect(result.producerIndex.status).toBe("VALID_SUCCESS");
  });

  it("consumes confirmed edges from a valid PARTIAL index while preserving its observed-evidence boundary", () => {
    const { dataRoot, producerIndex } = writeProducerIndexFixture({
      partial: true,
    });
    expect(producerIndex.buildStatus).toBe("PARTIAL");
    const calls: string[][] = [];
    const runner: OpenCliRunner = (args) => {
      calls.push([...args]);
      if (args[0] === "horae")
        return [
          {
            task_id: "producer-direct",
            task_name: "direct producer",
            direction: "上游",
          },
        ];
      throw new Error(`task-source must not be called: ${args.join(" ")}`);
    };

    const result = reconcileOneHop("current-indexed", {
      dataRoot,
      producerIndex,
      openCliRunner: runner,
    });

    expect(result.producerIndex.status).toBe("VALID_PARTIAL");
    expect(result.coverage).toMatchObject({
      semantics: "OBSERVED_EVIDENCE_ONLY",
      retrieval: {
        producerIndex: "VALID_PARTIAL",
        liveTaskSourceAttempts: 0,
        liveTaskSourceSuccesses: 0,
        liveTaskSourceFailures: 0,
      },
    });
    expect(result.nextDataTaskIds).toEqual([
      "producer-direct",
      "producer-not-direct",
    ]);
    expect(result.nextDataTaskIds).not.toContain("candidate-unknown");
    expect(result.boundaries).toMatchObject({
      staticSqlOnly: true,
      schedulerExecution: "NOT_EVALUATED",
      runtimeDelivery: "NOT_EVALUATED",
      businessCorrectness: "NOT_EVALUATED",
      producerCandidatesAreWrites: false,
      partitionScope: "TASK_TO_TABLE_WRITE",
    });
    expect(calls.every((args) => args[0] !== "szdata")).toBe(true);
  });

  it("does not let a related invalid Table Pack enter MATCHED in index mode", () => {
    const dataRoot = fixtureRoot();
    const tableDirectory = writeTable(dataRoot, "src.invalid_ddl");
    writeTask(dataRoot, "current-invalid-ddl", {
      sql: {
        query: {
          content: "SELECT id FROM src.invalid_ddl",
          evidenceProvider: "fixture:sql",
        },
      },
      evidenceProvider: "fixture:task",
    });
    writeTask(dataRoot, "producer-invalid-ddl", {
      target: {
        platform: "hive",
        dataSource: "gfhive",
        qualifiedName: "src.invalid_ddl",
      },
      targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
      evidenceProvider: "fixture:task",
    });
    const ddlPath = join(tableDirectory, "ddl.sql");
    writeFileSync(ddlPath, `${readFileSync(ddlPath, "utf8")} -- tampered`);
    const producerIndex = buildTableProducerIndex(dataRoot);
    expect(producerIndex.buildStatus).toBe("PARTIAL");
    expect(producerIndex.confirmedProducerEdges).toEqual([]);

    const calls: string[][] = [];
    const result = reconcileOneHop("current-invalid-ddl", {
      dataRoot,
      producerIndex,
      openCliRunner: (args) => {
        calls.push([...args]);
        if (args[0] === "horae")
          return [{ task_id: "producer-invalid-ddl", direction: "上游" }];
        throw new Error(`task-source must not be called: ${args.join(" ")}`);
      },
    });

    expect(result.counts).toMatchObject({
      matched: 0,
      sqlOnly: 1,
      unresolved: 1,
    });
    expect(result.reconciliation.map((item) => item.status)).toEqual([
      "UNRESOLVED",
      "SQL_ONLY",
    ]);
    expect(result.dataPath.confirmedProducers).toEqual([]);
    expect(result.dataPath.nonConfirmedRelations).toEqual([
      expect.objectContaining({
        taskId: "producer-invalid-ddl",
        directionStatus: "WRITE_CONFIRMED",
      }),
    ]);
    expect(result.nextDataTaskIds).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  frozen86840It(
    "replays the frozen real 86840 Input Pack through 22 local and 4 supplemental parents",
    () => {
      const fixture = JSON.parse(
        readFileSync(
          join(
            process.cwd(),
            "tests",
            "fixtures",
            "reconcile-one-hop",
            "86840-evidence.json",
          ),
          "utf8",
        ),
      ) as {
        taskId: string;
        frozenFrom: {
          currentTaskContentHash: string;
          querySha256: string;
        };
        expected: {
          sqlDirectReads: number;
          scheduleParents: number;
          matched: number;
          sqlOnly: number;
          scheduleOnly: number;
          unresolved: number;
          sqlOnlyQualifiedName: string;
        };
        horaeRows: Record<string, unknown>[];
        supplementalResponses: Record<string, Record<string, unknown>>;
      };
      const frozenInputPackRoot = join(
        process.cwd(),
        "tests",
        "fixtures",
        "reconcile-one-hop",
        "86840-input-pack",
      );
      const dataRoot = materializeFrozenInputPack(frozenInputPackRoot);
      const currentTask = JSON.parse(
        readFileSync(
          join(dataRoot, "tasks", "hiveTask-2.0", "86840", "task.json"),
          "utf8",
        ),
      ) as {
        contentHash: string;
        sqlFiles: { slot: string; sha256: string }[];
      };
      expect(currentTask.contentHash).toBe(
        fixture.frozenFrom.currentTaskContentHash,
      );
      expect(
        currentTask.sqlFiles.find((file) => file.slot === "query")?.sha256,
      ).toBe(fixture.frozenFrom.querySha256);
      const runner: OpenCliRunner = (args) => {
        if (args[0] === "horae") return fixture.horaeRows;
        const parentTaskId = args[args.indexOf("--task-id") + 1]!;
        const response = fixture.supplementalResponses[parentTaskId];
        if (!response)
          throw new Error(`UNEXPECTED_TASK_SOURCE:${parentTaskId}`);
        return response;
      };

      const result = reconcileOneHop(fixture.taskId, {
        dataRoot,
        openCliRunner: runner,
        now: () => "2026-08-22T02:58:38.275Z",
      });

      const { sqlOnlyQualifiedName, ...expectedCounts } = fixture.expected;
      expect(result.counts).toEqual(expectedCounts);
      expect(
        result.reconciliation.filter((item) => item.status === "SQL_ONLY"),
      ).toEqual([
        expect.objectContaining({
          taskId: null,
          table: expect.objectContaining({
            qualifiedName: sqlOnlyQualifiedName,
          }),
        }),
      ]);
      expect(result.nextScheduleTaskIds).toHaveLength(
        fixture.expected.scheduleParents,
      );
      expect(result.nextDataTaskIds).toHaveLength(fixture.expected.matched);
      expect(result.currentTask.directReads[0]?.evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: "INPUT_PACK_SQL",
            provider: "sql-mcp",
          }),
        ]),
      );
      expect(
        result.parents.find((parent) => parent.taskId === "102845")
          ?.confirmedWrites[0]?.evidence,
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: "INPUT_PACK_TASK",
            provider: expect.stringContaining("opencli:szdata.task-source"),
          }),
        ]),
      );

      const producerIndex = buildTableProducerIndex(dataRoot, {
        now: () => "2026-08-22T02:58:38.275Z",
      });
      expect(producerIndex.buildStatus).toBe("SUCCESS");
      const indexedCalls: string[][] = [];
      const indexedResult = reconcileOneHop(fixture.taskId, {
        dataRoot,
        producerIndex,
        openCliRunner: (args) => {
          indexedCalls.push([...args]);
          if (args[0] === "horae") return fixture.horaeRows;
          throw new Error(`INDEX_MODE_MUST_NOT_CALL:${args.join(" ")}`);
        },
        now: () => "2026-08-22T02:58:38.275Z",
      });
      expect(indexedResult.counts).toEqual({
        sqlDirectReads: 27,
        scheduleParents: 26,
        matched: 22,
        sqlOnly: 5,
        scheduleOnly: 0,
        unresolved: 4,
      });
      expect(indexedResult.producerIndex.status).toBe("VALID_SUCCESS");
      expect(indexedResult.dataPath.confirmedProducers).toHaveLength(22);
      expect(indexedResult.nextDataTaskIds).toHaveLength(22);
      expect(indexedResult.coverage.retrieval).toEqual({
        producerIndex: "VALID_SUCCESS",
        liveTaskSourceAttempts: 0,
        liveTaskSourceSuccesses: 0,
        liveTaskSourceFailures: 0,
      });
      expect(indexedCalls).toHaveLength(1);
    },
  );
});
