/**
 * Strips control characters from a string, preserving newlines (\n, \r) and
 * tabs (\t). Spec §4.5: "control characters are stripped on save (newlines
 * and tabs are preserved)".
 *
 * Removes Unicode general category Cc — C0 (0x00–0x1F), DEL (0x7F), and C1
 * (0x80–0x9F) — except \n (0x0A), \r (0x0D), and \t (0x09).
 * This matches Rust's `char::is_control()` in
 * `src-tauri/src/database/domains/transactions.rs`, so the same payee text
 * becomes the same string on web and desktop.
 *
 * Format characters (Cf, e.g. U+200B zero-width space) are deliberately not
 * stripped: `char::is_control()` is Cc only, and stripping them here would
 * re-create the same divergence in the opposite direction.
 */
export function stripControlChars(input: string): string {
	if (input == null) return input;
	// Union of what the two implementations used to strip separately: C0, DEL,
	// and C1 (0x80-0x9F). Rust's `char::is_control()` matches general category
	// Cc, which is all three; the browser stripped only C0 and DEL, so C1
	// characters survived on web and vanished on desktop. Newline, carriage
	// return, and tab stay.
	// eslint-disable-next-line no-control-regex
	return input.replace(/(?![\n\r\t])[\x00-\x1F\x7F-\x9F]/g, '');
}
