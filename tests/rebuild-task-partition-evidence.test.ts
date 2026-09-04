import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  canonicalHash,
  type JsonValue,
  type TaskDocument,
} from "../scripts/input/shared/input-pack.ts";
import { rewriteStoredTaskPartition } from "../scripts/input/partition/rebuild-task-partition-evidence.ts";

function storedTask(): Record<string, unknown> {
  return {
    schemaVersion: "1.0.0",
    taskId: "201847",
    taskCategory: "hive2starrocks",
    taskName: "keep-me",
    target: "features.client_label_latest",
    partition: {
      status: "UNKNOWN",
      targets: [],
      reasonCodes: ["OLD_INTERNAL_EVIDENCE"],
    },
    sqlFiles: [],
    collectedAt: "2026-08-24T00:00:00.000Z",
    evidenceProvider: "fixture",
    contentHash: "old-hash",
  };
}

describe("stored task partition rebuild", () => {
  it("dry-runs, removes stale evidence, preserves all other fields, and is idempotent", () => {
    const root = mkdtempSync(join(tmpdir(), "partition-rebuild-"));
    const path = join(root, "task.json");
    const original = storedTask();
    writeFileSync(path, `${JSON.stringify(original, null, 2)}\n`, "utf8");

    expect(
      rewriteStoredTaskPartition(
        path,
        original as unknown as TaskDocument,
        undefined,
        false,
      ),
    ).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(original);

    expect(
      rewriteStoredTaskPartition(
        path,
        original as unknown as TaskDocument,
        undefined,
      ),
    ).toBe(true);
    const repaired = JSON.parse(readFileSync(path, "utf8")) as Record<
      string,
      unknown
    >;
    expect(repaired).not.toHaveProperty("partition");
    const {
      partition: _oldPartition,
      contentHash: _oldHash,
      ...oldStable
    } = original;
    const { contentHash, ...newStable } = repaired;
    expect(newStable).toEqual(oldStable);
    expect(contentHash).toBe(
      canonicalHash(repaired as JsonValue, ["collectedAt", "contentHash"]),
    );
    expect(
      rewriteStoredTaskPartition(
        path,
        repaired as unknown as TaskDocument,
        undefined,
      ),
    ).toBe(false);
  });

  it("cleans the staged file and preserves the target when rename fails", () => {
    const root = mkdtempSync(join(tmpdir(), "partition-rebuild-failure-"));
    const targetDirectory = join(root, "task.json");
    mkdirSync(targetDirectory);
    const document = storedTask();
    expect(() =>
      rewriteStoredTaskPartition(
        targetDirectory,
        document as unknown as TaskDocument,
        null,
      ),
    ).toThrow();
    expect(existsSync(targetDirectory)).toBe(true);
    expect(
      existsSync(`${targetDirectory}.partition-rebuild-${process.pid}.tmp`),
    ).toBe(false);
  });
});
