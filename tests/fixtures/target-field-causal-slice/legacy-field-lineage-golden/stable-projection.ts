import { createHash } from "node:crypto";
import { isAbsolute, resolve, sep } from "node:path";

type JsonRecord = Record<string, unknown>;

export type StableProjectionOptions = {
  readonly tempRoots?: readonly string[];
  readonly stripContentHash?: boolean;
};

const TEMP_PATH_KEYS = new Set([
  "dataRoot",
  "factsRoot",
  "artifactPath",
  "outputPath",
]);

function isPathInside(value: string, root: string): boolean {
  if (!isAbsolute(value)) return false;
  const normalizedValue = resolve(value).toLowerCase();
  const normalizedRoot = resolve(root).toLowerCase();
  return (
    normalizedValue === normalizedRoot ||
    normalizedValue.startsWith(`${normalizedRoot}${sep}`)
  );
}

function replaceCaseInsensitive(
  value: string,
  search: string,
  replacement: string,
): string {
  let normalized = value;
  let start = normalized.toLowerCase().indexOf(search.toLowerCase());
  while (start >= 0) {
    normalized = `${normalized.slice(0, start)}${replacement}${normalized.slice(start + search.length)}`;
    start = normalized
      .toLowerCase()
      .indexOf(search.toLowerCase(), start + replacement.length);
  }
  return normalized;
}

function normalizeTempPathFragments(
  value: string,
  tempRoots: readonly string[],
): string {
  return [...tempRoots]
    .sort((left, right) => right.length - left.length)
    .reduce((normalized, tempRoot) => {
      const absoluteRoot = resolve(tempRoot);
      const jsonEscapedRoot = absoluteRoot.replaceAll("\\", "\\\\");
      return replaceCaseInsensitive(
        replaceCaseInsensitive(normalized, jsonEscapedRoot, "<temp-root>"),
        absoluteRoot,
        "<temp-root>",
      );
    }, value);
}

/** Keep the full legacy structure except explicitly volatile fields. */
export function stableProjection(
  value: unknown,
  options: StableProjectionOptions = {},
  key = "",
): unknown {
  if (key === "generatedAt") return undefined;
  if (key === "contentHash" && options.stripContentHash) return undefined;
  if (
    TEMP_PATH_KEYS.has(key) &&
    typeof value === "string" &&
    (options.tempRoots ?? []).some((tempRoot) => isPathInside(value, tempRoot))
  )
    return undefined;
  if (typeof value === "string")
    return normalizeTempPathFragments(value, options.tempRoots ?? []);
  if (Array.isArray(value))
    return value
      .map((item) => stableProjection(item, options))
      .filter((item): item is unknown => item !== undefined);
  if (typeof value !== "object" || value === null) return value;
  const result: JsonRecord = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    const stable = stableProjection(childValue, options, childKey);
    if (stable !== undefined) result[childKey] = stable;
  }
  return result;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as JsonRecord;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined)
    throw new Error("GOLDEN_PROJECTION_VALUE_NOT_SERIALIZABLE");
  return serialized;
}

/** Replaces a path-derived artifact hash with a hash of the stable projection. */
export function stableArtifactProjection(
  artifact: unknown,
  tempRoot: string,
): JsonRecord {
  const projection = stableProjection(artifact, {
    tempRoots: [tempRoot],
    stripContentHash: true,
  });
  if (
    typeof projection !== "object" ||
    projection === null ||
    Array.isArray(projection)
  )
    throw new Error("GOLDEN_ARTIFACT_PROJECTION_NOT_OBJECT");
  return {
    ...(projection as JsonRecord),
    contentHash: createHash("sha256")
      .update(canonicalJson(projection))
      .digest("hex"),
  };
}

export function stableRendererProjection(
  html: string,
  tempRoots: readonly string[],
): { readonly html: string } {
  return {
    html: normalizeTempPathFragments(
      html.replace(/"generatedAt":"[^"]*"/g, '"generatedAt":"<stripped>"'),
      tempRoots,
    ),
  };
}
