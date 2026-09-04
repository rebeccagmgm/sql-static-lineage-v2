import { createHash } from "node:crypto";

export type Sha256Input = string | Uint8Array;

/**
 * Hash UTF-8 text or the exact bytes supplied by the caller.
 */
export function sha256Hex(value: Sha256Input): string {
  const hash = createHash("sha256");
  if (typeof value === "string") {
    hash.update(value, "utf8");
  } else {
    hash.update(value);
  }
  return hash.digest("hex");
}
