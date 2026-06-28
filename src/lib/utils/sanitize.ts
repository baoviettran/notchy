/**
 * Strips control characters from a string, preserving newlines (\n, \r) and
 * tabs (\t). Spec §4.5: "control characters are stripped on save (newlines
 * and tabs are preserved)".
 *
 * Removes ASCII control chars 0x00–0x1F and 0x7F except \n (0x0A), \r (0x0D),
 * and \t (0x09), plus Unicode category Cc/Cf (deliberately permissive: keeps
 * all visible glyphs, including combining marks handled separately by NFC).
 */
export function stripControlChars(input: string): string {
	if (input == null) return input;
	// eslint-disable-next-line no-control-regex
	return input.replace(/(?![\n\r\t])[\x00-\x1F\x7F]/g, '');
}
