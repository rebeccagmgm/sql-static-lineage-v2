const SQL_IDENTIFIER = String.raw`(?:[A-Za-z_][A-Za-z0-9_$]*|\x60[^\x60]+\x60|"[^"]+")`;
const SQL_QUALIFIED_IDENTIFIER = String.raw`${SQL_IDENTIFIER}(?:\s*\.\s*${SQL_IDENTIFIER})+`;

function maskSqlCommentsAndLiterals(sql: string): string {
  const characters = [...sql];
  let quote: "'" | null = null;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < characters.length; index += 1) {
    const current = characters[index];
    const next = characters[index + 1];
    if (lineComment) {
      if (current === "\n" || current === "\r") lineComment = false;
      else characters[index] = " ";
      continue;
    }
    if (blockComment) {
      if (current === "*" && next === "/") {
        characters[index] = " ";
        characters[index + 1] = " ";
        index += 1;
        blockComment = false;
      } else if (current !== "\n" && current !== "\r") characters[index] = " ";
      continue;
    }
    if (quote !== null) {
      if (current === quote && next === quote) {
        characters[index] = " ";
        characters[index + 1] = " ";
        index += 1;
      } else if (current === quote) {
        characters[index] = " ";
        quote = null;
      } else if (current !== "\n" && current !== "\r") characters[index] = " ";
      continue;
    }
    if (current === "-" && next === "-") {
      characters[index] = " ";
      characters[index + 1] = " ";
      index += 1;
      lineComment = true;
    } else if (current === "/" && next === "*") {
      characters[index] = " ";
      characters[index + 1] = " ";
      index += 1;
      blockComment = true;
    } else if (current === "'") {
      characters[index] = " ";
      quote = "'";
    }
  }
  return characters.join("");
}

function normalizeIdentifier(value: string): string {
  return value
    .replaceAll("`", "")
    .replaceAll('"', "")
    .replace(/\s+/g, "")
    .trim();
}

/**
 * Extract physical-looking relations from SQL read clauses. This is only an
 * Input Pack discovery pass: SQL semantics and field lineage remain owned by
 * Machine Facts. Comments and string literals are masked so a source label or
 * example SQL cannot become a table request.
 */
export function extractSqlReadTableNames(sql: string): readonly string[] {
  const masked = maskSqlCommentsAndLiterals(sql);
  const cteNames = new Set<string>();
  const ctePattern = new RegExp(
    String.raw`\b(${SQL_IDENTIFIER})\s+AS\s*\(`,
    "gi",
  );
  for (const match of masked.matchAll(ctePattern)) {
    if (match[1]) cteNames.add(normalizeIdentifier(match[1]).toLowerCase());
  }

  const readPattern = new RegExp(
    String.raw`\b(?:FROM|JOIN)\s+(${SQL_QUALIFIED_IDENTIFIER})`,
    "gi",
  );
  const names = new Set<string>();
  for (const match of masked.matchAll(readPattern)) {
    const name = normalizeIdentifier(match[1] ?? "");
    if (!name || cteNames.has(name.toLowerCase())) continue;
    names.add(name);
  }
  return [...names].sort((left, right) => left.localeCompare(right));
}
