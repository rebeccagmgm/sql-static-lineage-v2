import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { canonicalJsonl, sha256 } from "../../scripts/machine-facts/machine-facts-contract.ts";
import {
  hashJsonlStore,
  inspectJsonlStore,
  jsonlStoreExists,
  readJsonlRecords,
  readJsonlText,
  writeCanonicalJsonl,
} from "../../scripts/machine-facts/jsonl-store.ts";

const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);

describe("jsonl-store gzip envelope", () => {
  it("writes gzip next to the logical .jsonl path and hashes uncompressed canonical bytes", () => {
    const dir = mkdtempSync(join(tmpdir(), "jsonl-store-"));
    const logical = join(dir, "field-expression-nodes.jsonl");
    const records = [
      { expression_id: "a", task_id: "1" },
      { expression_id: "b", task_id: "1" },
    ];
    const expectedBytes = canonicalJsonl(records);
    const written = writeCanonicalJsonl(logical, records);

    expect(written.row_count).toBe(2);
    expect(written.content_sha256).toBe(sha256(expectedBytes));
    expect(inspectJsonlStore(logical)).toEqual({
      status: "GZIP",
      path: `${logical}.gz`,
    });
    expect(jsonlStoreExists(logical)).toBe(true);
    const gz = readFileSync(`${logical}.gz`);
    expect(gz.subarray(0, 2).equals(GZIP_MAGIC)).toBe(true);
    expect(gz.length).toBeLessThan(Buffer.byteLength(expectedBytes));
    expect(readJsonlText(logical)).toBe(expectedBytes);
    expect(readJsonlRecords(logical)).toEqual(records);
    expect(hashJsonlStore(logical)).toBe(written.content_sha256);
  });

  it("keeps gzip bytes deterministic across writes", () => {
    const dir = mkdtempSync(join(tmpdir(), "jsonl-store-det-"));
    const logical = join(dir, "relation-nodes.jsonl");
    const records = [{ relation_id: "r1", task_id: "t" }];
    writeCanonicalJsonl(logical, records);
    const first = readFileSync(`${logical}.gz`);
    writeCanonicalJsonl(logical, records);
    const second = readFileSync(`${logical}.gz`);
    expect(first.equals(second)).toBe(true);
  });

  it("still reads legacy uncompressed .jsonl and reports the same records", () => {
    const dir = mkdtempSync(join(tmpdir(), "jsonl-store-legacy-"));
    const logical = join(dir, "dataset-io.jsonl");
    const records = [{ task_id: "t", direction: "READ", dataset_id: "d" }];
    const bytes = canonicalJsonl(records);
    writeFileSync(logical, bytes, "utf8");
    expect(inspectJsonlStore(logical)).toEqual({ status: "PLAIN", path: logical });
    expect(readJsonlRecords(logical)).toEqual(records);
    expect(hashJsonlStore(logical)).toBe(sha256(bytes));
  });

  it("rejects a split-brain .jsonl plus .jsonl.gz pair", () => {
    const dir = mkdtempSync(join(tmpdir(), "jsonl-store-conflict-"));
    const logical = join(dir, "statements.jsonl");
    writeCanonicalJsonl(logical, [{ statement_id: "s0" }]);
    writeFileSync(logical, canonicalJsonl([{ statement_id: "s0" }]), "utf8");
    expect(inspectJsonlStore(logical).status).toBe("CONFLICT");
    expect(jsonlStoreExists(logical)).toBe(true);
    expect(() => readJsonlText(logical)).toThrow(/JSONL_STORE_CONFLICT/);
  });
});
