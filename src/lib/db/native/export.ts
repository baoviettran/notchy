/**
 * Native export adapter — inactive stub.
 *
 * Typed to match the CSV export signatures.
 * Will be wired into production during the frontend port (Task 13).
 */

export async function exportTransactionsCsv(_dateFrom?: string, _dateTo?: string): Promise<string> {
	throw new Error('native export adapter not wired');
}

export function sanitizeCsvCell(value: string): string {
	if (
		value.startsWith('=') ||
		value.startsWith('+') ||
		value.startsWith('-') ||
		value.startsWith('@') ||
		value.startsWith('\t') ||
		value.startsWith('\r')
	) {
		return `'${value}`;
	}
	return value;
}
