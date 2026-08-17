/**
 * Native reports adapter — inactive stub.
 *
 * Typed to match `src/lib/db/repos/reports.ts` signatures.
 * Will be wired into production during the frontend port (Task 13).
 */

import type {
	OverviewReport as NativeOverviewReport,
	TrendPoint as NativeTrendPoint,
	CompareRow as NativeCompareRow,
	CategoryTrendPoint as NativeCategoryTrendPoint,
	StackedCategoryPoint as NativeStackedCategoryPoint,
	YearOverYearPoint as NativeYearOverYearPoint,
	NetWorthPoint as NativeNetWorthPoint,
} from '$lib/native/contracts.generated';

// Re-export the generated types under the names the rest of the app uses.
export type OverviewReport = NativeOverviewReport;
export type TrendPoint = NativeTrendPoint;
export type CompareRow = NativeCompareRow;
export type CategoryTrendPoint = NativeCategoryTrendPoint;
export type StackedCategoryPoint = NativeStackedCategoryPoint;
export type YearOverYearPoint = NativeYearOverYearPoint;
export type NetWorthPoint = NativeNetWorthPoint;

export async function getOverview(_month: string, _includeAdjustments?: boolean): Promise<OverviewReport> {
	throw new Error('native reports adapter not wired');
}

export async function getTrend(_months: number, _includeAdjustments?: boolean): Promise<TrendPoint[]> {
	throw new Error('native reports adapter not wired');
}

export async function getComparison(_monthA: string, _monthB: string, _includeAdjustments?: boolean): Promise<CompareRow[]> {
	throw new Error('native reports adapter not wired');
}

export async function getCategoryTrend(_months: number, _tagId: string, _includeAdjustments?: boolean): Promise<CategoryTrendPoint[]> {
	throw new Error('native reports adapter not wired');
}

export async function getStackedCategorySeries(_months: number, _includeAdjustments?: boolean): Promise<StackedCategoryPoint[]> {
	throw new Error('native reports adapter not wired');
}

export async function getYearOverYear(_year: number, _includeAdjustments?: boolean): Promise<YearOverYearPoint[]> {
	throw new Error('native reports adapter not wired');
}

export async function getNetWorthSeries(_months: number, _includeAdjustments?: boolean): Promise<NetWorthPoint[]> {
	throw new Error('native reports adapter not wired');
}
