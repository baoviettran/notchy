export interface BudgetableBucket { id: string; budgetable: number }

// Envelope-review chaining: Enter lands in the next bucket's field so the
// monthly ritual is one continuous pass, not one restart per bucket.
export function nextBudgetableId(buckets: BudgetableBucket[], currentId: string | null): string | null {
	const idx = buckets.findIndex((b) => b.id === currentId);
	if (idx === -1) return null;
	const next = buckets.slice(idx + 1).find((b) => b.budgetable);
	return next ? next.id : null;
}

export function monthStepFromKey(key: string): -1 | 0 | 1 {
	if (key === 'ArrowLeft') return -1;
	if (key === 'ArrowRight') return 1;
	return 0;
}
