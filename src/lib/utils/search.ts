export function transactionsSearchUrl(query: string): string {
	const q = query.trim();
	return q ? `/transactions?q=${encodeURIComponent(q)}` : '/transactions';
}
