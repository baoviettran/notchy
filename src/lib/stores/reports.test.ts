import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	reportsOps: {
		getNetWorthSeries: vi.fn(),
		getCategoryTrend: vi.fn(),
		getStackedCategorySeries: vi.fn(),
		getYearOverYear: vi.fn()
	},
	getDb: vi.fn()
}));

vi.mock('$lib/db', () => ({ getDb: mocks.getDb }));
import { ReportsStore } from './reports.svelte';

describe('ReportsStore', () => {
	let store: ReportsStore;

	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getDb.mockReturnValue({ reports: mocks.reportsOps });
		mocks.reportsOps.getNetWorthSeries.mockResolvedValue([]);
		mocks.reportsOps.getCategoryTrend.mockResolvedValue([]);
		mocks.reportsOps.getStackedCategorySeries.mockResolvedValue([]);
		mocks.reportsOps.getYearOverYear.mockResolvedValue([]);
		store = new ReportsStore();
	});

	it('initializes with default values', () => {
		expect(store.window).toBe(12);
		expect(store.includeAdjustments).toBe(false);
		expect(store.netWorth).toEqual([]);
	});

	it('updates window state', () => {
		store.window = 6;
		expect(store.window).toBe(6);
	});

	it('updates includeAdjustments state', () => {
		store.includeAdjustments = true;
		expect(store.includeAdjustments).toBe(true);
	});
	it('resolves the database before loading every report', async () => {
		await store.loadNetWorth();
		await store.loadCategoryTrend('tag-1');
		await store.loadStackedComposition();
		await store.loadYearOverYear(2025, 2026);

		expect(mocks.reportsOps.getNetWorthSeries).toHaveBeenCalledWith(12, false);
		expect(mocks.reportsOps.getCategoryTrend).toHaveBeenCalledWith('tag-1', 12, false);
		expect(mocks.reportsOps.getStackedCategorySeries).toHaveBeenCalledWith(12, false);
		expect(mocks.reportsOps.getYearOverYear).toHaveBeenCalledWith(2025, 2026, false);
	});
});
