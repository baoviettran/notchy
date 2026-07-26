export function normalizePayee(s: string | null): string {
	if (s === null || s === undefined) return '';

	return (
		s
			.trim()
			.toLowerCase()
			// Normalize to NFC (composed) then NFD (decomposed) so equivalent sequences fold identically
			.normalize('NFC')
			.normalize('NFD')
			// Strip Unicode combining marks (U+0300–U+036F)
			.replace(/[̀-ͯ]/g, '')
			// Vietnamese đ is a distinct letter, not decomposable; replace explicitly
			.replace(/đ/g, 'd')
			.replace(/Đ/g, 'd')
			// Collapse internal whitespace
			.replace(/\s+/g, ' ')
	);
}
