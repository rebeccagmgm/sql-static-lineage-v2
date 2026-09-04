import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  canonicalInputPackJson,
  canonicalMachineFactsJson,
} from "../../src/contracts/canonical-json.js";
import {
  causalTargetWriteId,
  machineFactsDatasetId,
  machineFactsFieldId,
  physicalFieldKey,
  platformTargetWriteObservationId,
  sqlParsedWriteObservationId,
  taskLocalPhysicalDatasetNodeId,
  taskLocalPhysicalFieldNodeId,
  taskLocalReadOccurrenceNodeId,
  taskLocalTargetWriteNodeId,
  taskNodeId,
} from "../../src/contracts/identity.js";
import { sha256Hex } from "../../src/contracts/sha256.js";
import {
  writeTableInput,
  writeTaskInput,
} from "../../scripts/input/shared/input-pack.ts";
import { runInputPackMachineFacts } from "../../scripts/machine-facts/input-pack-machine-facts.ts";
import { readJsonlRecords } from "../../scripts/machine-facts/jsonl-store.ts";
import { loadCurrentTaskBundle } from "../../scripts/query/current-task-bundle.ts";
import type { PhysicalFieldIdentity } from "../../scripts/reconcile/consumer/field-lineage/field-lineage-contract.ts";
import { resolveTargetWrite } from "../../scripts/reconcile/consumer/target-table-upstream-causal-closure/target-write-contract.ts";

const FIXED_TIME = "2026-09-05T00:00:00.000Z";
const EXPLICIT_TASK_ID = "410";
const PLATFORM_TASK_ID = "420";
const EXPLICIT_TARGET = "demo.explicit_target";
const PLATFORM_TARGET = "demo.platform_target";
const SOURCE_TABLE = "demo.source";
const EXPLICIT_WRITE_OBSERVATION_ID = "write-observation:410:0";
const PLATFORM_WRITE_OBSERVATION_ID = "write-observation:420:platform-target:0";

const INPUT_PACK_CANONICAL_WIRE =
  '{"a":1,"dataSource":"GFHIVE","datasetId":"数据集-A","nested":{"a":null,"z":true},"sql":"SQL: 血缘😀","tags":["b","a"]}';
const MACHINE_FACTS_CANONICAL_WIRE =
  '{"a":1,"datasetId":"数据集-A","dataSource":"GFHIVE","nested":{"a":null,"z":true},"sql":"SQL: 血缘😀","tags":["b","a"]}\n';

let fixtureRoot = "";
let dataRoot = "";
let factsRoot = "";

function writeTable(qualifiedName: string): void {
  const [schema, name] = qualifiedName.split(".");
  writeTableInput(dataRoot, {
    platform: "hive",
    dataSource: "gfhive",
    qualifiedName,
    schema,
    name,
    objectType: "TABLE",
    ddl: `CREATE TABLE ${qualifiedName} (id BIGINT)`,
    evidenceProvider: "fixture:identity-contract:table",
    collectedAt: FIXED_TIME,
  });
}

function bundleRecords(
  taskId: string,
  fileName: string,
): Record<string, unknown>[] {
  return readJsonlRecords(
    join(factsRoot, "registry", "tasks", taskId, "bundle", fileName),
  );
}

beforeAll(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "lineage-identity-contract-"));
  dataRoot = join(fixtureRoot, "input-pack");
  factsRoot = join(fixtureRoot, "machine-facts");

  for (const table of [SOURCE_TABLE, EXPLICIT_TARGET, PLATFORM_TARGET]) {
    writeTable(table);
  }

  writeTaskInput(dataRoot, {
    taskId: EXPLICIT_TASK_ID,
    taskCategory: "hiveTask-2.0",
    target: {
      platform: "hive",
      dataSource: "gfhive",
      qualifiedName: EXPLICIT_TARGET,
    },
    targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
    writeMode: "OVERWRITE",
    sql: {
      query: {
        content: `INSERT OVERWRITE TABLE ${EXPLICIT_TARGET} SELECT id FROM ${SOURCE_TABLE}`,
        evidenceProvider: "fixture:identity-contract:sql",
      },
    },
    evidenceProvider: "fixture:identity-contract:task",
    collectedAt: FIXED_TIME,
  });

  writeTaskInput(dataRoot, {
    taskId: PLATFORM_TASK_ID,
    taskCategory: "hiveTask-2.0",
    target: {
      platform: "hive",
      dataSource: "gfhive",
      qualifiedName: PLATFORM_TARGET,
    },
    targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
    writeMode: "OVERWRITE",
    sql: {
      query: {
        content: `SELECT id FROM ${SOURCE_TABLE}`,
        evidenceProvider: "fixture:identity-contract:sql",
      },
    },
    evidenceProvider: "fixture:identity-contract:task",
    collectedAt: FIXED_TIME,
  });

  runInputPackMachineFacts({
    dataRoot,
    taskIds: [EXPLICIT_TASK_ID, PLATFORM_TASK_ID],
    outputRoot: factsRoot,
    noWriterCatalog: true,
  });
});

afterAll(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

describe("identity contract", () => {
  it("freezes Input Pack and Machine Facts canonical wire bytes and hashes", () => {
    const value = {
      tags: ["b", "a"],
      dataSource: "GFHIVE",
      datasetId: "数据集-A",
      nested: { z: true, a: null },
      sql: "SQL: 血缘😀",
      a: 1,
    };

    const inputPackWire = canonicalInputPackJson(value);
    expect(inputPackWire).toBe(INPUT_PACK_CANONICAL_WIRE);
    expect(Buffer.from(inputPackWire, "utf8")).toEqual(
      Buffer.from(INPUT_PACK_CANONICAL_WIRE, "utf8"),
    );
    expect(Buffer.byteLength(inputPackWire, "utf8")).toBe(125);
    expect(sha256Hex(inputPackWire)).toBe(
      "b68f48efba311cf2736acc867743513daa8eddc54c50fd9c71c2d92e5ea5b2c0",
    );

    const machineFactsWire = canonicalMachineFactsJson(value);
    expect(machineFactsWire).toBe(MACHINE_FACTS_CANONICAL_WIRE);
    expect(Buffer.from(machineFactsWire, "utf8")).toEqual(
      Buffer.from(MACHINE_FACTS_CANONICAL_WIRE, "utf8"),
    );
    expect(Buffer.byteLength(machineFactsWire, "utf8")).toBe(126);
    expect(sha256Hex(machineFactsWire)).toBe(
      "d7d4dd24b9139a19120220d3caec036c37c465f6db65589ba9df60aa384c5b8b",
    );
  });

  it("freezes Machine Facts and task-local identity vectors", () => {
    const datasetNode = taskLocalPhysicalDatasetNodeId({
      platform: " HIVE ",
      dataSource: " GFHIVE ",
      qualifiedName: " DM_RSK_N.OTC_OPT_POSITION ",
    });
    const field: PhysicalFieldIdentity = {
      platform: " HIVE ",
      dataSource: " GFHIVE ",
      stableTableId: " DM_RSK_N.OTC_OPT_POSITION__GFHIVE ",
      qualifiedName: " DM_RSK_N.OTC_OPT_POSITION ",
      column: " DELTA ",
      identityStatus: "SCHEMA_BACKED",
    };

    expect(taskNodeId("105387")).toBe("task:105387");
    expect(
      machineFactsDatasetId("hive-gfhive", "`DM_RSK_N`.`OTC_OPT_POSITION`"),
    ).toBe("dataset:hive-gfhive:dm_rsk_n.otc_opt_position");
    expect(
      machineFactsFieldId(
        "hive-gfhive",
        "[DM_RSK_N].[OTC_OPT_POSITION]",
        "`DELTA`",
      ),
    ).toBe("field:hive-gfhive:dm_rsk_n.otc_opt_position.delta");
    expect(physicalFieldKey(field)).toBe(
      "hive|gfhive|dm_rsk_n.otc_opt_position__gfhive|dm_rsk_n.otc_opt_position|delta",
    );

    expect(datasetNode).toBe(
      "dataset:0296d9a2024b093b37c53863e078b34f3caff17365c97432e3e0bf06745e2ec0",
    );
    expect(taskLocalPhysicalFieldNodeId(field)).toBe(
      "physical-field:4e0db6da92fbda295a2ca2d0b0f9df92f76cc95e593af7121f93e86e9edb5a2e",
    );
    expect(
      taskLocalTargetWriteNodeId({
        taskId: "105387",
        datasetNodeId: datasetNode,
        writeObservationId: sqlParsedWriteObservationId("105387", 3),
      }),
    ).toBe(
      "target-write:614f3ca331de36f4ef7465f1584edc0986912bd6b93498fd3f24f8718afd139e",
    );
    expect(
      taskLocalReadOccurrenceNodeId({
        consumerTaskId: "176827",
        occurrenceId: "task:176827:statement:2:relation:read:0",
        readRelationId: "task:176827:statement:2:relation:read",
      }),
    ).toBe(
      "read-occurrence:191f53b3b1354a34034638234136372794196b31d10ad58fbf8af9d548f95957",
    );
  });

  it("freezes explicit and platform-target write observations from Machine Facts", () => {
    expect(sqlParsedWriteObservationId(EXPLICIT_TASK_ID, 0)).toBe(
      EXPLICIT_WRITE_OBSERVATION_ID,
    );
    expect(platformTargetWriteObservationId(PLATFORM_TASK_ID, 0)).toBe(
      PLATFORM_WRITE_OBSERVATION_ID,
    );

    const explicitWrites = bundleRecords(EXPLICIT_TASK_ID, "dataset-io.jsonl")
      .filter(
        (record) =>
          record.direction === "WRITE" &&
          typeof record.write_observation_id === "string",
      )
      .map((record) => ({
        writeObservationId: record.write_observation_id,
        statementId: record.statement_id,
        writeKind: record.write_kind,
        provenance: record.provenance,
      }));
    expect(explicitWrites).toEqual([
      {
        writeObservationId: EXPLICIT_WRITE_OBSERVATION_ID,
        statementId: "task:410:slot:query:statement:0",
        writeKind: "INSERT_OVERWRITE",
        provenance: "SQL_PARSE",
      },
    ]);

    const platformWrites = bundleRecords(PLATFORM_TASK_ID, "dataset-io.jsonl")
      .filter(
        (record) =>
          record.direction === "WRITE" &&
          typeof record.write_observation_id === "string",
      )
      .map((record) => ({
        writeObservationId: record.write_observation_id,
        statementId: record.statement_id,
        writeKind: record.write_kind,
        provenance: record.provenance,
      }));
    expect(platformWrites).toEqual([
      {
        writeObservationId: PLATFORM_WRITE_OBSERVATION_ID,
        statementId: "task:420:slot:query:statement:0",
        writeKind: "PACK_DECLARED_QUERY_OUTPUT",
        provenance: "PLATFORM_TARGET",
      },
    ]);

    const explicitBindingWriteIds = new Set(
      bundleRecords(EXPLICIT_TASK_ID, "output-field-bindings.jsonl").map(
        (record) => record.write_observation_id,
      ),
    );
    expect([...explicitBindingWriteIds]).toEqual([
      EXPLICIT_WRITE_OBSERVATION_ID,
    ]);
  });

  it("freezes the rich target-causal target-write identity", () => {
    const expectedCausalTargetWriteId = causalTargetWriteId({
      taskId: EXPLICIT_TASK_ID,
      targetTableKey: EXPLICIT_TARGET,
      sqlSourceId: "task:410:slot:query",
      statementOrdinal: 0,
      taskWriteOrdinal: 0,
      rootRelationId: "task:410:statement:0:relation:root.project",
      writeObservationId: EXPLICIT_WRITE_OBSERVATION_ID,
    });
    expect(expectedCausalTargetWriteId).toBe(
      "target-write:78d1b67771b31386af9051d6c7a6ff479fcf75b3531a7055dac217ff2b3b71ee",
    );

    const resolution = resolveTargetWrite({
      taskId: EXPLICIT_TASK_ID,
      targetTable: EXPLICIT_TARGET,
      writeObservationIds: [EXPLICIT_WRITE_OBSERVATION_ID],
      load: loadCurrentTaskBundle(factsRoot, EXPLICIT_TASK_ID),
      snapshot: {
        inputPackFingerprint: "fixture:input-pack",
        machineFactsHash: "fixture:machine-facts",
        producerIndexHash: "fixture:producer-index",
        tableMultiHopHash: "fixture:multi-hop",
        semanticRuleVersion: "fixture:semantic-rules",
      },
    });

    expect(resolution.gaps).toEqual([]);
    expect(resolution.ref).not.toBeNull();
    const { evidenceRefs, ...identity } = resolution.ref!.identity;
    expect(identity).toEqual({
      targetWriteId: expectedCausalTargetWriteId,
      taskId: EXPLICIT_TASK_ID,
      targetTableKey: EXPLICIT_TARGET,
      sqlSourceId: "task:410:slot:query",
      statementOrdinal: 0,
      taskWriteOrdinal: 0,
      rootRelationId: "task:410:statement:0:relation:root.project",
      writeObservationId: EXPLICIT_WRITE_OBSERVATION_ID,
    });
    expect(evidenceRefs).toEqual(
      expect.arrayContaining([
        "machine-facts:410:dataset-io.jsonl",
        "machine-facts:410:output-field-bindings.jsonl",
        "machine-facts:410:statements.jsonl",
      ]),
    );
    expect(identity.targetWriteId).not.toBe(
      taskLocalTargetWriteNodeId({
        taskId: EXPLICIT_TASK_ID,
        datasetNodeId: taskLocalPhysicalDatasetNodeId({
          platform: "hive",
          dataSource: "gfhive",
          qualifiedName: EXPLICIT_TARGET,
        }),
        writeObservationId: EXPLICIT_WRITE_OBSERVATION_ID,
      }),
    );
  });
});
