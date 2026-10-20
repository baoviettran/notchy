import { dataEpoch } from '$lib/profiles/epoch';
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
		const epoch = dataEpoch();
		this.error = null;
		this.loading = true;
		try {
			const db = getDb();
			const rows = await db.reports.getNetWorthSeries(this.window, this.includeAdjustments);
			if (epoch === dataEpoch()) this.netWorth = rows;
		} catch (e) {
			if (epoch === dataEpoch()) this.error = mapError(e);
		} finally {
			if (epoch === dataEpoch()) this.loading = false;
		}
	}

	async loadTrend(): Promise<void> {
		const epoch = dataEpoch();
		this.error = null;
		this.loading = true;
		try {
			const db = getDb();
			const rows = await db.reports.getTrend(this.window, this.includeAdjustments);
			if (epoch === dataEpoch()) this.trend = rows;
		} catch (e) {
			if (epoch === dataEpoch()) this.error = mapError(e);
		} finally {
			if (epoch === dataEpoch()) this.loading = false;
		}
	}

	async loadCategoryTrend(tagId: string): Promise<void> {
		const epoch = dataEpoch();
		this.error = null;
		this.loading = true;
		try {
			const db = getDb();
			const rows = await db.reports.getCategoryTrend(tagId, this.window, this.includeAdjustments);
			if (epoch === dataEpoch()) this.categoryTrend = rows;
		} catch (e) {
			if (epoch === dataEpoch()) this.error = mapError(e);
		} finally {
			if (epoch === dataEpoch()) this.loading = false;
		}
	}

	async loadStackedComposition(): Promise<void> {
		const epoch = dataEpoch();
		this.error = null;
		this.loading = true;
		try {
			const db = getDb();
			const rows = await db.reports.getStackedCategorySeries(this.window, this.includeAdjustments);
			if (epoch === dataEpoch()) this.stackedComposition = rows;
		} catch (e) {
			if (epoch === dataEpoch()) this.error = mapError(e);
		} finally {
			if (epoch === dataEpoch()) this.loading = false;
		}
	}

	async loadYearOverYear(yearA: number, yearB: number): Promise<void> {
		const epoch = dataEpoch();
		this.error = null;
		this.loading = true;
		try {
			const db = getDb();
			const rows = await db.reports.getYearOverYear(yearA, yearB, this.includeAdjustments);
			if (epoch === dataEpoch()) this.yearOverYear = rows;
		} catch (e) {
			if (epoch === dataEpoch()) this.error = mapError(e);
		} finally {
			if (epoch === dataEpoch()) this.loading = false;
		}
	}
}

export const reportsStore = new ReportsStore();
