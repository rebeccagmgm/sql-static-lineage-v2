import { readFileSync } from "node:fs";

import { sha256Hex } from "../../contracts/sha256.js";

export function sha256File(path: string): string {
  return sha256Hex(readFileSync(path));
}
