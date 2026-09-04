import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import {
	backfillWriterCatalogFromFacts,
	catalogWritersFromDatasetIo,
	defaultWriterCatalogPath,
	isCatalogWritableWrite,
	openWriterCatalog,
	removeTaskWriters,
	upsertTaskWriters,
	writersForQualifiedName,
	writersForTable,
	catalogFingerprint,
	writersForTask,
} from "../scripts/query/writer-catalog.ts";

function fixtureRoot(): string {
	return mkdtempSync(join(tmpdir(), "writer-catalog-"));
}

function writeFactsBundle(input: {
	readonly factsRoot: string;
	readonly taskId: string;
	readonly taskCategory: string;
	readonly writes: readonly Record<string, unknown>[];
}): void {
	const taskRoot = join(input.factsRoot, "registry", "tasks", input.taskId);
	const bundleDir = join(taskRoot, "bundle");
	mkdirSync(bundleDir, { recursive: true });
	writeFileSync(
		join(taskRoot, "status.json"),
		JSON.stringify({ state: "SUCCESS", current_manifest_sha256: "manifest-hash" }),
	);
	writeFileSync(
		join(bundleDir, "manifest.json"),
		JSON.stringify({
			task_id: input.taskId,
			inputs: {
				input_pack: {
					task_content_hash: "task-content-hash",
				},
			},
		}),
	);
	const lines = input.writes.map((record) => JSON.stringify(record));
	writeFileSync(join(bundleDir, "dataset-io.jsonl"), `${lines.join("\n")}\n`);
}

describe("writer catalog", () => {
	it("upserts writers and answers writersForTable", () => {
		const root = fixtureRoot();
		const catalogPath = join(root, "writer-catalog.sqlite");
		const handle = openWriterCatalog(catalogPath);
		upsertTaskWriters(handle, {
			taskId: "100",
			taskCategory: "sparkIndex",
			taskContentHash: "task-hash",
			factsManifestSha256: "manifest-hash",
			factsStatus: "SUCCESS",
			writes: catalogWritersFromDatasetIo({
				taskId: "100",
				taskCategory: "sparkIndex",
				records: [
					{
						task_id: "100",
						direction: "WRITE",
						dataset_id: "ds",
						physical_dataset: "demo.target",
						provenance: "SQL_PARSE",
						resolution_status: "RESOLVED",
						write_observation_id: "write-observation:100:0",
						write_kind: "INSERT_OVERWRITE",
						field_producing: true,
					},
				],
			}),
		});

		const hits = writersForTable(handle, {
			platform: "hive",
			dataSource: "gfhive",
			qualifiedName: "demo.target",
		});
		expect(hits).toHaveLength(1);
		expect(hits[0]).toMatchObject({
			taskId: "100",
			writeObservationId: "write-observation:100:0",
		});
	});

	it("maps sparkIndex two-part db.table to hive/gfhive", () => {
		const rows = catalogWritersFromDatasetIo({
			taskId: "200",
			taskCategory: "sparkIndex",
			records: [
				{
					task_id: "200",
					direction: "WRITE",
					dataset_id: "ds",
					physical_dataset: "demo.target",
					provenance: "SQL_PARSE",
					resolution_status: "RESOLVED",
					write_observation_id: "write-observation:200:0",
					field_producing: true,
				},
			],
		});
		expect(rows[0]).toMatchObject({
			platform: "hive",
			dataSource: "gfhive",
			qualifiedName: "demo.target",
		});
	});

	it("removes writers when a task is deleted or failed", () => {
		const root = fixtureRoot();
		const handle = openWriterCatalog(join(root, "writer-catalog.sqlite"));
		upsertTaskWriters(handle, {
			taskId: "300",
			taskCategory: "hiveTask-2.0",
			taskContentHash: "task-hash",
			factsManifestSha256: "manifest-hash",
			factsStatus: "SUCCESS",
			writes: catalogWritersFromDatasetIo({
				taskId: "300",
				taskCategory: "hiveTask-2.0",
				records: [
					{
						task_id: "300",
						direction: "WRITE",
						dataset_id: "ds",
						physical_dataset: "demo.source",
						provenance: "SQL_PARSE",
						resolution_status: "RESOLVED",
						write_observation_id: "write-observation:300:0",
						field_producing: true,
					},
				],
			}),
		});
		removeTaskWriters(handle, "300");
		expect(
			writersForQualifiedName(handle, "demo.source"),
		).toEqual([]);
	});

	it("backfills from a tiny fake facts tree", () => {
		const root = fixtureRoot();
		const dataRoot = join(root, "data");
		const factsRoot = join(root, "facts");
		const catalogPath = defaultWriterCatalogPath(dataRoot);
		mkdirSync(join(dataRoot, "tasks", "sparkIndex", "400"), { recursive: true });
		writeFileSync(
			join(dataRoot, "tasks", "sparkIndex", "400", "task.json"),
			JSON.stringify({ taskCategory: "sparkIndex", contentHash: "task-content-hash" }),
		);
		writeFactsBundle({
			factsRoot,
			taskId: "400",
			taskCategory: "sparkIndex",
			writes: [
				{
					task_id: "400",
					direction: "WRITE",
					dataset_id: "ds",
					physical_dataset: "demo.backfill",
					provenance: "SQL_PARSE",
					resolution_status: "RESOLVED",
					write_observation_id: "write-observation:400:0",
					field_producing: true,
				},
			],
		});
		const result = backfillWriterCatalogFromFacts({
			dataRoot,
			factsRoot,
			catalogPath,
		});
		expect(result).toEqual({ tasks: 1, writers: 1 });
		const handle = openWriterCatalog(catalogPath);
		expect(writersForQualifiedName(handle, "demo.backfill")[0]?.taskId).toBe("400");
	});
});

describe("isCatalogWritableWrite", () => {
	it("keeps producing writes and pack-declared outputs", () => {
		expect(
			isCatalogWritableWrite({
				task_id: "1",
				direction: "WRITE",
				dataset_id: "ds",
				physical_dataset: "demo.t",
				provenance: "SQL_PARSE",
				resolution_status: "RESOLVED",
				field_producing: true,
			}),
		).toBe(true);
		expect(
			isCatalogWritableWrite({
				task_id: "1",
				direction: "WRITE",
				dataset_id: "ds",
				physical_dataset: "demo.t",
				provenance: "PLATFORM_TARGET",
				resolution_status: "RESOLVED",
				write_kind: "PACK_DECLARED_QUERY_OUTPUT",
			}),
		).toBe(true);
	});

	it("skips non-producing cleanup writes", () => {
		expect(
			isCatalogWritableWrite({
				task_id: "1",
				direction: "WRITE",
				dataset_id: "ds",
				physical_dataset: "demo.t",
				provenance: "SQL_PARSE",
				resolution_status: "RESOLVED",
				field_producing: false,
			}),
		).toBe(false);
	});

	it("fingerprints catalog rows and answers writersForTask", () => {
		const root = fixtureRoot();
		const handle = openWriterCatalog(join(root, "writer-catalog.sqlite"));
		const writes = catalogWritersFromDatasetIo({
			taskId: "400",
			taskCategory: "sparkIndex",
			records: [
				{
					task_id: "400",
					direction: "WRITE",
					dataset_id: "ds",
					physical_dataset: "demo.target",
					provenance: "SQL_PARSE",
					resolution_status: "RESOLVED",
					write_observation_id: "write-observation:400:0",
					write_kind: "INSERT_OVERWRITE",
					field_producing: true,
				},
			],
		});
		upsertTaskWriters(handle, {
			taskId: "400",
			taskCategory: "sparkIndex",
			taskContentHash: "task-hash",
			factsManifestSha256: "manifest-hash",
			factsStatus: "SUCCESS",
			writes,
		});
		const first = catalogFingerprint(handle);
		expect(first).toMatch(/^[a-f0-9]{64}$/u);
		expect(writersForTask(handle, "400")).toHaveLength(1);
		upsertTaskWriters(handle, {
			taskId: "401",
			taskCategory: "sparkIndex",
			taskContentHash: "other-hash",
			factsManifestSha256: "manifest-hash",
			factsStatus: "SUCCESS",
			writes: catalogWritersFromDatasetIo({
				taskId: "401",
				taskCategory: "sparkIndex",
				records: [
					{
						task_id: "401",
						direction: "WRITE",
						dataset_id: "ds",
						physical_dataset: "demo.other",
						provenance: "SQL_PARSE",
						resolution_status: "RESOLVED",
						write_observation_id: "write-observation:401:0",
						field_producing: true,
					},
				],
			}),
		});
		expect(catalogFingerprint(handle)).not.toBe(first);
	});
});
