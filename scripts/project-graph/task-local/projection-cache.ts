import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { indexTaskInputPacks } from "../../machine-facts/input-pack-machine-facts.ts";
import { canonicalJson, sha256 } from "../../machine-facts/machine-facts-contract.ts";
import {
  loadCurrentTaskBundle,
  type CurrentBundleLoad,
} from "../../query/current-task-bundle.ts";
import {
  TASK_LOCAL_PROJECTION_SCHEMA_VERSION,
  canonicalizeTaskLocalProjection,
  type TaskLocalProjectionSchemaVersion,
  type TaskLocalProjection,
} from "./contract.ts";

export interface TaskLocalCacheKeyParts {
  readonly taskId: string;
  readonly packContentHash: string;
  readonly factsManifestSha256: string;
  readonly schemaVersion: TaskLocalProjectionSchemaVersion;
}

export interface TaskLocalCacheEnvelope {
  readonly cacheKey: string;
  readonly cacheKeyParts: TaskLocalCacheKeyParts;
  readonly projectionContentHash: string;
  readonly projection: TaskLocalProjection;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function taskLocalCacheKey(parts: TaskLocalCacheKeyParts): string {
  return sha256(canonicalJson({
    taskId: parts.taskId,
    packContentHash: parts.packContentHash,
    factsManifestSha256: parts.factsManifestSha256,
    schemaVersion: parts.schemaVersion,
  }));
}

export function packContentHashForTask(dataRoot: string, taskId: string): string {
  const paths = indexTaskInputPacks(dataRoot).get(taskId) ?? [];
  if (paths.length !== 1) return "NO_PACK";
  try {
    const document = JSON.parse(readFileSync(paths[0]!, "utf8")) as Record<string, unknown>;
    return text(document.contentHash) ?? sha256(readFileSync(paths[0]!));
  } catch {
    return "NO_PACK";
  }
}

export function factsManifestFingerprint(load: CurrentBundleLoad): string {
  return text(load.manifestSha256)
    ?? text(load.indexRow?.manifest_sha256)
    ?? "NO_FACTS";
}

export function resolveTaskLocalCacheKeyParts(input: {
  readonly taskId: string;
  readonly dataRoot: string;
  readonly factsRoot: string;
}): TaskLocalCacheKeyParts {
  const load = loadCurrentTaskBundle(input.factsRoot, input.taskId);
  return {
    taskId: input.taskId,
    packContentHash: packContentHashForTask(input.dataRoot, input.taskId),
    factsManifestSha256: factsManifestFingerprint(load),
    schemaVersion: TASK_LOCAL_PROJECTION_SCHEMA_VERSION,
  };
}

export function taskLocalProjectionPath(outputRoot: string, taskId: string): string {
  return join(resolve(outputRoot), "tasks", taskId, "task-local-projection.json");
}

export function readTaskLocalCacheEnvelope(
  outputRoot: string,
  taskId: string,
): TaskLocalCacheEnvelope | null {
  const path = taskLocalProjectionPath(outputRoot, taskId);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<TaskLocalCacheEnvelope>;
    if (!parsed.cacheKey || !parsed.cacheKeyParts || !parsed.projection || !parsed.projectionContentHash) {
      return null;
    }
    canonicalizeTaskLocalProjection(parsed.projection);
    return parsed as TaskLocalCacheEnvelope;
  } catch {
    return null;
  }
}

export function writeTaskLocalCacheEnvelope(
  outputRoot: string,
  envelope: TaskLocalCacheEnvelope,
): string {
  const path = taskLocalProjectionPath(outputRoot, envelope.cacheKeyParts.taskId);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${canonicalJson(envelope)}\n`, "utf8");
  return path;
}

export function projectionBytesEqualIgnoringGeneratedAt(
  left: TaskLocalProjection,
  right: TaskLocalProjection,
): boolean {
  const normalize = (projection: TaskLocalProjection) => {
    const { generatedAt: _generatedAt, ...rest } = projection;
    return canonicalJson(rest);
  };
  return normalize(left) === normalize(right);
}

export function tryReadCachedTaskLocalProjection(input: {
  readonly outputRoot: string;
  readonly taskId: string;
  readonly dataRoot: string;
  readonly factsRoot: string;
}): {
  readonly hit: boolean;
  readonly cacheKey: string;
  readonly cacheKeyParts: TaskLocalCacheKeyParts;
  readonly envelope: TaskLocalCacheEnvelope | null;
} {
  const cacheKeyParts = resolveTaskLocalCacheKeyParts({
    taskId: input.taskId,
    dataRoot: input.dataRoot,
    factsRoot: input.factsRoot,
  });
  const cacheKey = taskLocalCacheKey(cacheKeyParts);
  const envelope = readTaskLocalCacheEnvelope(input.outputRoot, input.taskId);
  if (!envelope || envelope.cacheKey !== cacheKey) {
    return { hit: false, cacheKey, cacheKeyParts, envelope: null };
  }
  if (envelope.projectionContentHash !== envelope.projection.contentHash) {
    return { hit: false, cacheKey, cacheKeyParts, envelope: null };
  }
  return { hit: true, cacheKey, cacheKeyParts, envelope };
}

export function storeTaskLocalProjectionCache(input: {
  readonly outputRoot: string;
  readonly cacheKeyParts: TaskLocalCacheKeyParts;
  readonly projection: TaskLocalProjection;
}): TaskLocalCacheEnvelope {
  const envelope: TaskLocalCacheEnvelope = {
    cacheKey: taskLocalCacheKey(input.cacheKeyParts),
    cacheKeyParts: input.cacheKeyParts,
    projectionContentHash: input.projection.contentHash,
    projection: input.projection,
  };
  writeTaskLocalCacheEnvelope(input.outputRoot, envelope);
  return envelope;
}
