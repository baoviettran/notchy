import { getDb } from '$lib/db';
import {
	getNetWorthSeries,
	getCategoryTrend,
	getStackedCategorySeries,
	getYearOverYear,
	type NetWorthPoint,
	type CategoryTrendPoint,
	type StackedCategoryPoint,
	type YearOverYearPoint
} from '$lib/db/repos/reports';

export class ReportsStore {
	window = $state<6 | 12 | 24>(12);
	includeAdjustments = $state(false);

	netWorth = $state<NetWorthPoint[]>([]);
	categoryTrend = $state<CategoryTrendPoint[]>([]);
	stackedComposition = $state<StackedCategoryPoint[]>([]);
	yearOverYear = $state<YearOverYearPoint[]>([]);

	async loadNetWorth(): Promise<void> {
		const db = await getDb();
		this.netWorth = await getNetWorthSeries(db, this.window, this.includeAdjustments);
	}

	async loadCategoryTrend(tagId: string): Promise<void> {
		const db = await getDb();
		this.categoryTrend = await getCategoryTrend(db, tagId, this.window, this.includeAdjustments);
	}

	async loadStackedComposition(): Promise<void> {
		const db = await getDb();
		this.stackedComposition = await getStackedCategorySeries(db, this.window, this.includeAdjustments);
	}

	async loadYearOverYear(yearA: number, yearB: number): Promise<void> {
		const db = await getDb();
		this.yearOverYear = await getYearOverYear(db, yearA, yearB, this.includeAdjustments);
	}
}

export const reportsStore = new ReportsStore();
