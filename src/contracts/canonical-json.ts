import { sha256Hex } from "./sha256.js";

export type InputPackJsonPrimitive = null | boolean | number | string;
export type InputPackJsonArray = readonly InputPackJsonValue[];
export interface InputPackJsonObject {
  readonly [key: string]: InputPackJsonValue;
}
export type InputPackJsonValue =
  InputPackJsonPrimitive | InputPackJsonArray | InputPackJsonObject;

function failInputPack(message: string): never {
  throw new Error(`Input Pack validation failed: ${message}`);
}

function isInputPackJsonArray(
  value: InputPackJsonValue,
): value is InputPackJsonArray {
  return Array.isArray(value);
}

/**
 * Serialize an Input Pack JSON value with lexicographically sorted object keys.
 * The returned document never includes a trailing line feed.
 */
export function canonicalInputPackJson(value: InputPackJsonValue): string {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      failInputPack("canonical JSON cannot contain non-finite numbers");
    }
    return JSON.stringify(value);
  }
  if (isInputPackJsonArray(value)) {
    return `[${value.map(canonicalInputPackJson).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) => `${JSON.stringify(key)}:${canonicalInputPackJson(value[key]!)}`,
    )
    .join(",")}}`;
}

function isInputPackJsonObject(
  value: InputPackJsonValue,
): value is InputPackJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Hash an Input Pack object after excluding only the named top-level fields.
 */
export function canonicalInputPackHash(
  value: InputPackJsonValue,
  excludedTopLevelFields: readonly string[] = [],
): string {
  if (!isInputPackJsonObject(value)) {
    failInputPack("canonicalHash requires a JSON object");
  }

  const excluded = new Set(excludedTopLevelFields);
  const filtered: Record<string, InputPackJsonValue> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!excluded.has(key)) {
      filtered[key] = item;
    }
  }
  return sha256Hex(canonicalInputPackJson(filtered));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalMachineFactsValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalMachineFactsValue);
  }
  if (!isPlainObject(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalMachineFactsValue(item)]),
  );
}

/**
 * Serialize a Machine Facts value with its current canonical profile.
 * The returned document always ends in exactly one line feed.
 */
export function canonicalMachineFactsJson(value: unknown): string {
  return `${JSON.stringify(canonicalMachineFactsValue(value))}\n`;
}

/**
 * Serialize Machine Facts JSONL. Empty input is empty; non-empty input ends in
 * exactly one line feed.
 */
export function canonicalMachineFactsJsonl(
  records: readonly unknown[],
): string {
  return (
    records
      .map((record) => JSON.stringify(canonicalMachineFactsValue(record)))
      .join("\n") + (records.length ? "\n" : "")
  );
}
