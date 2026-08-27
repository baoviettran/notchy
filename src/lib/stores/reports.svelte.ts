import { getDb } from '$lib/db';
import { mapError } from '$lib/utils/errors';
import type {
	NetWorthPoint,
	TrendPoint,
	CategoryTrendPoint,
	StackedCategoryPoint,
	YearOverYearPoint
} from '$lib/db/client';

export class ReportsStore {
	window = $state<6 | 12 | 24>(12);
	includeAdjustments = $state(false);
	// A failed report load must surface as a retryable error, never an
	// endlessly spinning skeleton.
	error = $state<string | null>(null);
	loading = $state(false);

	netWorth = $state<NetWorthPoint[]>([]);
	trend = $state<TrendPoint[]>([]);
	categoryTrend = $state<CategoryTrendPoint[]>([]);
	stackedComposition = $state<StackedCategoryPoint[]>([]);
	yearOverYear = $state<YearOverYearPoint[]>([]);

	async loadNetWorth(): Promise<void> {
		this.error = null;
		this.loading = true;
		try {
			const db = getDb();
			this.netWorth = await db.reports.getNetWorthSeries(this.window, this.includeAdjustments);
		} catch (e) {
			this.error = mapError(e);
		} finally {
			this.loading = false;
		}
	}

	async loadTrend(): Promise<void> {
		this.error = null;
		this.loading = true;
		try {
			const db = getDb();
			this.trend = await db.reports.getTrend(this.window, this.includeAdjustments);
		} catch (e) {
			this.error = mapError(e);
		} finally {
			this.loading = false;
		}
	}

	async loadCategoryTrend(tagId: string): Promise<void> {
		this.error = null;
		this.loading = true;
		try {
			const db = getDb();
			this.categoryTrend = await db.reports.getCategoryTrend(tagId, this.window, this.includeAdjustments);
		} catch (e) {
			this.error = mapError(e);
		} finally {
			this.loading = false;
		}
	}

	async loadStackedComposition(): Promise<void> {
		this.error = null;
		this.loading = true;
		try {
			const db = getDb();
			this.stackedComposition = await db.reports.getStackedCategorySeries(this.window, this.includeAdjustments);
		} catch (e) {
			this.error = mapError(e);
		} finally {
			this.loading = false;
		}
	}

	async loadYearOverYear(yearA: number, yearB: number): Promise<void> {
		this.error = null;
		this.loading = true;
		try {
			const db = getDb();
			this.yearOverYear = await db.reports.getYearOverYear(yearA, yearB, this.includeAdjustments);
		} catch (e) {
			this.error = mapError(e);
		} finally {
			this.loading = false;
		}
	}
}

export const reportsStore = new ReportsStore();
