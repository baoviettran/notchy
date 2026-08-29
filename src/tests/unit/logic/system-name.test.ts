import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/paraglide/messages', () => ({
	bucket_essentials: () => 'Essentials',
	bucket_learning: () => 'Learning & Entertainment',
	bucket_saving: () => 'Saving & Investment',
	bucket_adjustments: () => 'Adjustments',
	tag_initial_balance: () => 'Initial Balance',
	tag_loss: () => 'Loss',
	tag_gift: () => 'Gift',
	tag_reconciliation: () => 'Reconciliation',
}));

import { systemName } from '$lib/stores/categories.svelte';

describe('systemName', () => {
	it('returns localised name for each known system bucket', () => {
		expect(systemName('bucket_essentials')).toBe('Essentials');
		expect(systemName('bucket_learning')).toBe('Learning & Entertainment');
		expect(systemName('bucket_saving')).toBe('Saving & Investment');
		expect(systemName('bucket_adjustments')).toBe('Adjustments');
	});

	it('returns localised name for each known system tag', () => {
		expect(systemName('tag_initial_balance')).toBe('Initial Balance');
		expect(systemName('tag_loss')).toBe('Loss');
		expect(systemName('tag_gift')).toBe('Gift');
		expect(systemName('tag_reconciliation')).toBe('Reconciliation');
	});

	it('returns null for unknown IDs', () => {
		expect(systemName('bucket_custom')).toBeNull();
		expect(systemName('userCreatedBucket')).toBeNull();
	});

	it('returns null for empty string', () => {
		expect(systemName('')).toBeNull();
	});
});
