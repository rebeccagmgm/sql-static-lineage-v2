import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const DERIVATION_ROOTS = [
  join(REPO_ROOT, "scripts/project-graph/field-evidence-v1/relation-tree.ts"),
  join(REPO_ROOT, "scripts/project-graph/field-evidence-v1/source-read-occurrence.ts"),
  join(REPO_ROOT, "scripts/project-graph/field-evidence-v1/subtype-classifier.ts"),
  join(REPO_ROOT, "scripts/project-graph/field-evidence-v1/field-evidence-emission.ts"),
  join(REPO_ROOT, "scripts/project-graph/field-evidence-v1/field-edge-index.ts"),
  join(REPO_ROOT, "scripts/project-graph/field-evidence-v1/resolve-read-field.ts"),
  join(REPO_ROOT, "scripts/project-graph/field-evidence-v1/control-scope.ts"),
  join(REPO_ROOT, "scripts/project-graph/field-evidence-v1/impact-query.ts"),
  join(REPO_ROOT, "scripts/project-graph/field-evidence-v1/impact-result-contract.ts"),
  join(REPO_ROOT, "scripts/project-graph/field-evidence-v1/schedule-preference.ts"),
  join(REPO_ROOT, "scripts/project-graph/field-evidence-v1/continuation"),
  join(REPO_ROOT, "scripts/project-graph/task-local/project-task-local.ts"),
];

const FORBIDDEN_LITERAL_PATTERNS = [
  /\b176827\b/,
  /\b181058\b/,
  /\b209119\b/,
  /\b155015\b/,
  /\botc_opt_/,
  /\bpdata_n\./,
  /\bdm_rsk_n\./,
];

function sourceFiles(root: string): string[] {
  if (root.endsWith(".ts")) return [root];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

describe("field-evidence derivation lint", () => {
  it("does not embed task ids or table/column literals in derivation code", () => {
    const offenders: string[] = [];
    for (const root of DERIVATION_ROOTS) {
      for (const file of sourceFiles(root)) {
        const content = readFileSync(file, "utf8");
        for (const pattern of FORBIDDEN_LITERAL_PATTERNS) {
          if (pattern.test(content)) {
            offenders.push(`${file} matched ${pattern}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
