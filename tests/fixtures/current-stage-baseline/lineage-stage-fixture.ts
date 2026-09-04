import { join } from "node:path";

import {
  writeTableInput,
  writeTaskInput,
  type TaskEvidence,
} from "../../../scripts/input/shared/input-pack.ts";

export const ROOT_TASK_ID = "100";
export const PRODUCER_TASK_ID = "200";
export const ROOT_TABLE = "demo.target";
export const PRODUCER_TABLE = "demo.mid";
export const SOURCE_TABLE = "raw.seed";
export const FIXED_TIME = "2026-09-05T00:00:00.000Z";

function writeTable(dataRoot: string, qualifiedName: string): void {
  const [schema, name] = qualifiedName.split(".");
  writeTableInput(dataRoot, {
    platform: "hive",
    dataSource: "gfhive",
    qualifiedName,
    schema,
    name,
    objectType: "TABLE",
    ddl: `CREATE TABLE ${qualifiedName} (id BIGINT, amount DECIMAL(18, 2))`,
    evidenceProvider: "fixture:current-stage:table",
    collectedAt: FIXED_TIME,
  });
}

function writeTask(
  dataRoot: string,
  taskId: string,
  evidence: Omit<TaskEvidence, "taskId" | "taskCategory" | "collectedAt">,
): void {
  writeTaskInput(dataRoot, {
    taskId,
    taskCategory: "hiveTask-2.0",
    collectedAt: FIXED_TIME,
    ...evidence,
  });
}

export interface CurrentStageFixture {
  readonly dataRoot: string;
  readonly factsRoot: string;
}

export function materializeCurrentStageFixture(
  root: string,
): CurrentStageFixture {
  const dataRoot = join(root, "input-pack");
  const factsRoot = join(root, "machine-facts");

  for (const table of [ROOT_TABLE, PRODUCER_TABLE, SOURCE_TABLE]) {
    writeTable(dataRoot, table);
  }

  writeTask(dataRoot, PRODUCER_TASK_ID, {
    target: {
      platform: "hive",
      dataSource: "gfhive",
      qualifiedName: PRODUCER_TABLE,
    },
    targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
    writeMode: "OVERWRITE",
    sql: {
      query: {
        content: `INSERT OVERWRITE TABLE ${PRODUCER_TABLE} SELECT id, amount FROM ${SOURCE_TABLE}`,
        evidenceProvider: "fixture:current-stage:sql",
      },
    },
    evidenceProvider: "fixture:current-stage:task",
  });

  writeTask(dataRoot, ROOT_TASK_ID, {
    target: {
      platform: "hive",
      dataSource: "gfhive",
      qualifiedName: ROOT_TABLE,
    },
    targetEvidenceKind: "DIRECT_PLATFORM_TARGET",
    writeMode: "OVERWRITE",
    sql: {
      query: {
        content: `INSERT OVERWRITE TABLE ${ROOT_TABLE} SELECT id, amount FROM ${PRODUCER_TABLE} WHERE amount > 0`,
        evidenceProvider: "fixture:current-stage:sql",
      },
    },
    evidenceProvider: "fixture:current-stage:task",
  });

  return { dataRoot, factsRoot };
}
