import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { runInputPackMachineFacts } from "../scripts/machine-facts/input-pack-machine-facts.ts";
import { validateBundle } from "../scripts/machine-facts/machine-facts.ts";
import { readJsonlRecords, writeCanonicalJsonl } from "../scripts/machine-facts/jsonl-store.ts";
import { createSyntheticFieldLineageInputPack } from "./fixtures/field-lineage/cases.ts";

const TASK_IDS = ["132028", "155939", "176827"] as const;

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function realDataRoot(): string | null {
  const configured = process.env.WP6_REAL_DATA_ROOT;
  const candidates = [
    configured,
    resolve(process.cwd(), "..", "sql-static-lineage-data"),
  ].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  return (
    candidates.find((candidate) =>
      TASK_IDS.every((taskId) =>
        existsSync(join(candidate, "tasks", "sparkIndex", taskId, "task.json")),
      ),
    ) ?? null
  );
}

function jsonl(path: string): Record<string, unknown>[] {
  return readJsonlRecords(path);
}

function bundle(outputRoot: string, taskId: string): string {
  return join(outputRoot, "registry", "tasks", taskId, "bundle");
}

describe("WP-6 Pack-declared write observation", () => {
  const dataRoot = realDataRoot();
  const required = process.env.WP6_REAL_PACK_REQUIRED === "1";

  if (dataRoot === null) {
    (required ? it : it.skip)(
      "requires the mounted real Input Pack root",
      () => {
        throw new Error(
          "WP6_REAL_DATA_ROOT is unavailable and no sibling sql-static-lineage-data root was found",
        );
      },
    );
    return;
  }

  it("regenerates representative Packs deterministically and preserves source evidence", () => {
    const firstRoot = mkdtempSync(join(tmpdir(), "wp6-real-facts-first-"));
    const secondRoot = mkdtempSync(join(tmpdir(), "wp6-real-facts-second-"));
    const sourceHashes = new Map(
      TASK_IDS.map((taskId) => {
        const taskPath = join(
          dataRoot,
          "tasks",
          "sparkIndex",
          taskId,
          "task.json",
        );
        const task = JSON.parse(readFileSync(taskPath, "utf8")) as {
          sqlFiles: readonly { path: string; sha256: string }[];
        };
        return [
          taskId,
          new Map(task.sqlFiles.map((file) => [file.path, file.sha256])),
        ];
      }),
    );
    try {
      const first = runInputPackMachineFacts({
        dataRoot,
        taskIds: TASK_IDS,
        outputRoot: firstRoot,
      });
      const second = runInputPackMachineFacts({
        dataRoot,
        taskIds: TASK_IDS,
        outputRoot: secondRoot,
      });

      expect(first.tasks.map((task) => [task.task_id, task.state])).toEqual([
        ["132028", "SUCCESS"],
        ["155939", "FAILED"],
        ["176827", "SUCCESS"],
      ]);
      expect(second.tasks.map((task) => [task.task_id, task.state])).toEqual(
        first.tasks.map((task) => [task.task_id, task.state]),
      );
      expect(
        first.tasks.find((task) => task.task_id === "155939")?.failures?.[0]
          ?.message,
      ).toMatch(/TASK_TARGET_PHYSICAL_IDENTITY_UNRESOLVED/);

      for (const taskId of ["132028", "176827"] as const) {
        const firstBundle = bundle(firstRoot, taskId);
        const secondBundle = bundle(secondRoot, taskId);
        expect(validateBundle(firstBundle)).toEqual([]);
        const firstManifest = JSON.parse(
          readFileSync(join(firstBundle, "manifest.json"), "utf8"),
        ) as {
          inputs: { input_pack?: { sql_sha256?: string } };
          outputs: readonly {
            path: string;
            content_sha256: string;
            row_count: number;
          }[];
        };
        const secondManifest = JSON.parse(
          readFileSync(join(secondBundle, "manifest.json"), "utf8"),
        ) as typeof firstManifest;
        expect(secondManifest.outputs).toEqual(firstManifest.outputs);
        const sourceHash = firstManifest.inputs.input_pack?.sql_sha256;
        expect(sourceHash).toMatch(/^[a-f0-9]{64}$/);

        const writes = jsonl(join(firstBundle, "dataset-io.jsonl")).filter(
          (write) => write.direction === "WRITE" && write.write_observation_id,
        );
        const packWrites = writes.filter(
          (write) => write.write_kind === "PACK_DECLARED_QUERY_OUTPUT",
        );
        expect(packWrites).toHaveLength(1);
        expect(packWrites[0]).toMatchObject({
          provenance: "PLATFORM_TARGET",
          source_sql_sha256: sourceHash,
        });
        expect(
          writes.some(
            (write) => write.write_kind === "PLATFORM_TARGET_QUERY_OUTPUT",
          ),
        ).toBe(false);

        const bindings = jsonl(
          join(firstBundle, "output-field-bindings.jsonl"),
        );
        expect(bindings.length).toBeGreaterThan(0);
        expect(
          bindings.every(
            (binding) =>
              binding.evidence_kind === "PACK_DECLARED_QUERY_OUTPUT" &&
              binding.source_sql_sha256 === sourceHash,
          ),
        ).toBe(true);

        const taskPath = join(
          dataRoot,
          "tasks",
          "sparkIndex",
          taskId,
          "task.json",
        );
        const task = JSON.parse(readFileSync(taskPath, "utf8")) as {
          sqlFiles: readonly { path: string; sha256: string }[];
        };
        for (const sqlFile of task.sqlFiles) {
          expect(
            sha256File(
              join(dataRoot, "tasks", "sparkIndex", taskId, sqlFile.path),
            ),
          ).toBe(sourceHashes.get(taskId)?.get(sqlFile.path));
        }
      }
    } finally {
      rmSync(firstRoot, { recursive: true, force: true });
      rmSync(secondRoot, { recursive: true, force: true });
    }
  }, 120_000);

  it("rejects a Pack-declared write/binding whose source SQL hash is changed", () => {
    const dataRoot = mkdtempSync(join(tmpdir(), "wp6-hash-data-"));
    const outputRoot = mkdtempSync(join(tmpdir(), "wp6-hash-facts-"));
    try {
      createSyntheticFieldLineageInputPack(dataRoot);
      runInputPackMachineFacts({
        dataRoot,
        taskIds: ["300"],
        outputRoot,
      });
      const bundleRoot = bundle(outputRoot, "300");
      const writePath = join(bundleRoot, "dataset-io.jsonl");
      const bindingPath = join(bundleRoot, "output-field-bindings.jsonl");
      const tamperedHash = "0".repeat(64);
      const writes = jsonl(writePath).map((write) =>
        write.write_kind === "PACK_DECLARED_QUERY_OUTPUT"
          ? { ...write, source_sql_sha256: tamperedHash }
          : write,
      );
      const bindings = jsonl(bindingPath).map((binding) =>
        binding.evidence_kind === "PACK_DECLARED_QUERY_OUTPUT"
          ? { ...binding, source_sql_sha256: tamperedHash }
          : binding,
      );
      writeCanonicalJsonl(writePath, writes);
      writeCanonicalJsonl(bindingPath, bindings);
      const errors = validateBundle(bundleRoot);
      expect(errors).toEqual(
        expect.arrayContaining([
          expect.stringContaining(
            "pack-declared write source SQL hash does not match manifest",
          ),
          expect.stringContaining(
            "pack-declared binding source SQL hash mismatch",
          ),
        ]),
      );
    } finally {
      rmSync(dataRoot, { recursive: true, force: true });
      rmSync(outputRoot, { recursive: true, force: true });
    }
  });
});
