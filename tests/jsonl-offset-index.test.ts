import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertJsonlCatalogPath,
  buildJsonlOffsetIndex,
  lookupJsonlByKey,
} from "../scripts/input/shared/jsonl-offset-index.ts";

function writeJsonl(lines: readonly unknown[]): string {
  const dir = mkdtempSync(join(tmpdir(), "jsonl-offset-"));
  const path = join(dir, "catalog.jsonl");
  writeFileSync(
    path,
    `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`,
    "utf8",
  );
  return path;
}

function nameKey(record: Record<string, unknown>): string | undefined {
  const value = record.key;
  return typeof value === "string" ? value : undefined;
}

describe("jsonl offset index", () => {
  it("rejects csv and partial catalogs", () => {
    expect(() => assertJsonlCatalogPath("a.csv")).toThrow(/FORBIDDEN_CATALOG/);
    expect(() =>
      assertJsonlCatalogPath("_gf_rdbms_table_ddl_partial.jsonl"),
    ).toThrow(/FORBIDDEN_CATALOG/);
  });

  it("looks up a record by table key without needing guid", () => {
    const path = writeJsonl([
      { qualifiedname: "dm.t@gfhive:1", querytext: "CREATE TABLE dm.t (id int)" },
      { qualifiedname: "other.x@gfhive:2", querytext: "CREATE TABLE other.x (id int)" },
    ]);
    const index = buildJsonlOffsetIndex(path, (record) => {
      const qn = record.qualifiedname;
      if (typeof qn !== "string") return undefined;
      return qn.split("@")[0]?.toLowerCase();
    });
    const hit = lookupJsonlByKey(index, "dm.t");
    expect(hit.status).toBe("HIT");
    if (hit.status !== "HIT") return;
    expect(hit.record.guid).toBeUndefined();
    expect(hit.record.querytext).toBe("CREATE TABLE dm.t (id int)");
  });

  it("collapses duplicate keys when querytext is the same", () => {
    const ddl = "CREATE TABLE dm.t (id int)";
    const path = writeJsonl([
      { qualifiedname: "dm.t@gfhive:1", querytext: ddl, querytext_md5: "abc" },
      { qualifiedname: "dm.t@gfhive:2", querytext: ddl, querytext_md5: "abc" },
    ]);
    const index = buildJsonlOffsetIndex(path, () => "dm.t");
    expect(lookupJsonlByKey(index, "dm.t").status).toBe("HIT");
  });

  it("marks a key ambiguous only when content differs", () => {
    const path = writeJsonl([
      { key: "dm.t", querytext: "CREATE TABLE dm.t (id int)" },
      { key: "dm.t", querytext: "CREATE TABLE dm.t (id int, name string)" },
    ]);
    const index = buildJsonlOffsetIndex(path, nameKey);
    expect(lookupJsonlByKey(index, "dm.t").status).toBe("AMBIGUOUS");
  });

  it("returns miss for an unknown key", () => {
    const path = writeJsonl([{ key: "dm.t", querytext: "CREATE TABLE dm.t (id int)" }]);
    const index = buildJsonlOffsetIndex(path, nameKey);
    expect(lookupJsonlByKey(index, "missing").status).toBe("MISS");
  });
});
