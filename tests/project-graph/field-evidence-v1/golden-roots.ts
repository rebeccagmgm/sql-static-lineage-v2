import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { jsonlStoreExists } from "../../../scripts/machine-facts/jsonl-store.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export const FIELD_EVIDENCE_ANCHOR_TASK_IDS = [
  "155015",
  "176827",
  "181058",
  "209119",
] as const;

export function fieldEvidenceGoldenRoots(): { dataRoot: string; factsRoot: string } | null {
  const dataRoot = resolve(
    process.env.TASK_LOCAL_GOLDEN_DATA_ROOT?.trim() || join(REPO_ROOT, "../sql-static-lineage-data"),
  );
  const factsRoot = resolve(
    process.env.TASK_LOCAL_GOLDEN_FACTS_ROOT?.trim() || join(dataRoot, "field-facts"),
  );
  const required = join(
    factsRoot,
    "registry",
    "tasks",
    "181058",
    "bundle",
    "dataset-io.jsonl",
  );
  if (!jsonlStoreExists(required)) return null;
  return { dataRoot, factsRoot };
}

export const FIELD_EVIDENCE_BASELINE_PATH = join(
  REPO_ROOT,
  "artifacts/field-evidence-v1/phase1-baseline.json",
);
