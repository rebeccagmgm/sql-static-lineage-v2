/**
 * Return a parser-only SQL view for a repeated response block.
 *
 * The Input Pack keeps the platform response byte-for-byte. This helper is
 * deliberately limited to a derived analysis view so source evidence and its
 * hash are never rewritten.
 */
export function normalizeRepeatedSqlForAnalysis(content: string): string {
	const normalized = content.replace(/\r\n?/g, "\n").trim();
	if (normalized === "") return "\n";
	const lines = normalized.split("\n");
	const canonical = (value: string): string =>
		value.replace(/\s+/g, " ").trim().toLowerCase();
	const midpoint = Math.floor(lines.length / 2);
	for (let offset = -2; offset <= 2; offset += 1) {
		const split = midpoint + offset;
		if (split <= 0 || split >= lines.length) continue;
		const left = lines.slice(0, split).join("\n").trim();
		const right = lines.slice(split).join("\n").trim();
		if (left !== "" && canonical(left) === canonical(right)) return `${left}\n`;
	}
	return `${normalized}\n`;
}
