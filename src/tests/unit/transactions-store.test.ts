import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock paraglide messages — return distinct markers so we can prove
// the store calls m.*() instead of using hardcoded English strings.
vi.mock('$lib/paraglide/messages', () => ({
	transactions_deleted_toast: () => 'DELETED_I18N',
	transactions_undo: () => 'UNDO_I18N',
	transactions_restored_toast: () => 'RESTORED_I18N'
}));

// Mock getDb — the store calls getDb().transactions.*
vi.mock('$lib/db', () => ({
	getDb: vi.fn()
}));

// Mock mapError
vi.mock('$lib/utils/errors', () => ({
	mapError: vi.fn(() => 'Something went wrong')
}));

// Import mocks and the store module
import { getDb } from '$lib/db';
import { transactions } from '$lib/stores/transactions.svelte';
import { toast } from '$lib/stores/toast.svelte';

describe('TransactionsStore.delete', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('shows i18n toast with translated text on delete', async () => {
		const mockTx = { id: 'tx1', kind: 'expense', amount: 5000, payee: 'Coffee' };
		const mockList = [{ id: 'tx1', kind: 'expense', amount: 5000, payee: 'Coffee' }];

		const db = {
			transactions: {
				get: vi.fn().mockResolvedValue(mockTx),
				delete: vi.fn().mockResolvedValue(undefined),
				restore: vi.fn().mockResolvedValue(undefined),
				list: vi.fn().mockResolvedValue(mockList)
			}
		};
		(getDb as ReturnType<typeof vi.fn>).mockReturnValue(db);

		const showSpy = vi.spyOn(toast, 'show');

		await transactions.delete('tx1');

		// The toast must use the paraglide mock values, not hardcoded English
		expect(showSpy).toHaveBeenCalledTimes(1);
		const firstCall = showSpy.mock.calls[0];
		expect(firstCall[0]).toBe('DELETED_I18N');
		expect(firstCall[1]!.action).toBe('UNDO_I18N');

		// Simulate the undo callback
		const onaction = firstCall[1]!.onaction as () => Promise<void>;
		await onaction();

		// The restore toast must also use paraglide
		const secondCall = showSpy.mock.calls[1];
		expect(secondCall[0]).toBe('RESTORED_I18N');
	});
});
