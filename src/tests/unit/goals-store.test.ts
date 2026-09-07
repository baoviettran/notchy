import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock paraglide messages — return distinct markers so we can prove
// the store calls m.*() instead of using hardcoded English strings.
vi.mock('$lib/paraglide/messages', () => ({
	goals_deleted_toast: () => 'DELETED_I18N',
	common_undo: () => 'UNDO_I18N',
	goals_restored_toast: () => 'RESTORED_I18N'
}));

// Mock getDb — the store calls getDb().goals.*
vi.mock('$lib/db', () => ({
	getDb: vi.fn()
}));

// Mock mapError
vi.mock('$lib/utils/errors', () => ({
	mapError: vi.fn(() => 'Something went wrong')
}));

import { getDb } from '$lib/db';
import { goals } from '$lib/stores/goals.svelte';
import { toast } from '$lib/stores/toast.svelte';

describe('GoalsStore.delete', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		toast.dismiss();
	});

	it('shows i18n toast with translated text on delete', async () => {
		const mockGoal = { id: 'goal1', name: 'Vacation', status: 'active' };
		const mockList = [mockGoal];

		const db = {
			goals: {
				get: vi.fn().mockResolvedValue(mockGoal),
				delete: vi.fn().mockResolvedValue(undefined),
				restore: vi.fn().mockResolvedValue(undefined),
				list: vi.fn().mockResolvedValue(mockList)
			}
		};
		(getDb as ReturnType<typeof vi.fn>).mockReturnValue(db);

		const showSpy = vi.spyOn(toast, 'show');

		await goals.delete('goal1');

		// The toast must use the paraglide mock values, not hardcoded English
		expect(showSpy).toHaveBeenCalledTimes(1);
		const firstCall = showSpy.mock.calls[0];
		expect(firstCall[0]).toBe('DELETED_I18N');
		expect(firstCall[1]!.action).toBe('UNDO_I18N');

		// Simulate the undo callback
		const onaction = firstCall[1]!.onaction as () => Promise<void>;
		await onaction();

		// Undo restores the exact goal id
		expect(db.goals.restore).toHaveBeenCalledWith('goal1');

		// Undo reloads the list
		expect(db.goals.list).toHaveBeenCalledTimes(2);

		// The restore toast must also use paraglide
		const secondCall = showSpy.mock.calls[1];
		expect(secondCall[0]).toBe('RESTORED_I18N');
	});
});
