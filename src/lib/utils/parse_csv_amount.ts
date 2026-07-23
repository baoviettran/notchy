export type AmountLocale = 'en' | 'vi';

/**
 * Parse a CSV amount cell into a float, locale-aware.
 *
 * Two conventions (per the import spec §"Sign convention"):
 * - 'en' (US): comma = thousands sep, dot = decimal. "1,234.56" → 1234.56
 * - 'vi' (EU): dot = thousands sep, comma = decimal. "1.234,56" → 1234.56
 *
 * Returns null for unparseable input (caller marks the row invalid).
 * Sign is preserved: "-1.234,56" → -1234.56.
 *
 * Caller scales the result to the smallest currency unit (VND x1, USD x100)
 * and rounds to an integer — mirroring parseAmount's scaling step.
 */
export function parseCsvAmount(raw: string, locale: AmountLocale): number | null {
  if (!raw) return null;

  let cleaned = raw.trim();
  if (cleaned === '') return null;

  // Capture sign before stripping
  let negative = false;
  if (cleaned.startsWith('-')) {
    negative = true;
    cleaned = cleaned.slice(1);
  } else if (cleaned.startsWith('+')) {
    cleaned = cleaned.slice(1);
  }

  // Strip currency symbols and spaces (e.g. "₫", "$", "VND", non-breaking spaces)
  cleaned = cleaned.replace(/[₫$VND\s ]/gi, '');

  if (cleaned === '') return null;

  if (locale === 'vi') {
    // EU: dot is thousands sep (remove), comma is decimal (→ dot)
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    // US: comma is thousands sep (remove), dot is decimal (keep)
    cleaned = cleaned.replace(/,/g, '');
  }

  const parsed = parseFloat(cleaned);
  if (isNaN(parsed) || !isFinite(parsed)) return null;

  return negative ? -parsed : parsed;
}
