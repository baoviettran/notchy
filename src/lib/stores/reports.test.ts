import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	db: { marker: 'resolved-db' },
	getDb: vi.fn(),
	getNetWorthSeries: vi.fn(),
	getCategoryTrend: vi.fn(),
	getStackedCategorySeries: vi.fn(),
	getYearOverYear: vi.fn()
}));

vi.mock('$lib/db', () => ({ getDb: mocks.getDb }));
vi.mock('$lib/db/repos/reports', () => ({
	getNetWorthSeries: mocks.getNetWorthSeries,
	getCategoryTrend: mocks.getCategoryTrend,
	getStackedCategorySeries: mocks.getStackedCategorySeries,
	getYearOverYear: mocks.getYearOverYear
}));
import { ReportsStore } from './reports.svelte';

describe('ReportsStore', () => {
	let store: ReportsStore;

	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getDb.mockResolvedValue(mocks.db);
		mocks.getNetWorthSeries.mockResolvedValue([]);
		mocks.getCategoryTrend.mockResolvedValue([]);
		mocks.getStackedCategorySeries.mockResolvedValue([]);
		mocks.getYearOverYear.mockResolvedValue([]);
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

		expect(mocks.getNetWorthSeries).toHaveBeenCalledWith(mocks.db, 12, false);
		expect(mocks.getCategoryTrend).toHaveBeenCalledWith(mocks.db, 'tag-1', 12, false);
		expect(mocks.getStackedCategorySeries).toHaveBeenCalledWith(mocks.db, 12, false);
		expect(mocks.getYearOverYear).toHaveBeenCalledWith(mocks.db, 2025, 2026, false);
	});
});
