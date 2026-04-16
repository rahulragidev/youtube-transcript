/**
 * Parse VTT subtitle content into clean plain text.
 * Handles deduplication of repeated lines common in auto-generated captions.
 */
export function parseVtt(vtt: string): string {
	const lines = vtt.split("\n");
	const textLines: string[] = [];
	let previousLine = "";

	for (const line of lines) {
		const trimmed = line.trim();

		// Skip VTT header, timestamps, and empty lines
		if (
			trimmed === "" ||
			trimmed === "WEBVTT" ||
			trimmed.startsWith("Kind:") ||
			trimmed.startsWith("Language:") ||
			trimmed.startsWith("NOTE") ||
			trimmed.includes("-->") ||
			/^\d+$/.test(trimmed)
		) {
			continue;
		}

		// Strip HTML tags (e.g. <c>, </c>, <i>, etc.)
		const cleaned = trimmed.replace(/<[^>]+>/g, "").trim();

		if (!cleaned) continue;

		// Deduplicate consecutive identical lines (common in auto-subs)
		if (cleaned !== previousLine) {
			textLines.push(cleaned);
			previousLine = cleaned;
		}
	}

	return textLines.join(" ");
}
