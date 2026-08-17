import { getDb } from '$lib/db';
import type {
	NetWorthPoint,
	CategoryTrendPoint,
	StackedCategoryPoint,
	YearOverYearPoint
} from '$lib/db/client';

export class ReportsStore {
	window = $state<6 | 12 | 24>(12);
	includeAdjustments = $state(false);

	netWorth = $state<NetWorthPoint[]>([]);
	categoryTrend = $state<CategoryTrendPoint[]>([]);
	stackedComposition = $state<StackedCategoryPoint[]>([]);
	yearOverYear = $state<YearOverYearPoint[]>([]);

	async loadNetWorth(): Promise<void> {
		const db = getDb();
		this.netWorth = await db.reports.getNetWorthSeries(this.window, this.includeAdjustments);
	}

	async loadCategoryTrend(tagId: string): Promise<void> {
		const db = getDb();
		this.categoryTrend = await db.reports.getCategoryTrend(tagId, this.window, this.includeAdjustments);
	}

	async loadStackedComposition(): Promise<void> {
		const db = getDb();
		this.stackedComposition = await db.reports.getStackedCategorySeries(this.window, this.includeAdjustments);
	}

	async loadYearOverYear(yearA: number, yearB: number): Promise<void> {
		const db = getDb();
		this.yearOverYear = await db.reports.getYearOverYear(yearA, yearB, this.includeAdjustments);
	}
}

export const reportsStore = new ReportsStore();
