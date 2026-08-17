/**
 * Native reports adapter — inactive stub.
 *
 * Typed to match `src/lib/db/repos/reports.ts` signatures.
 * Will be wired into production during the frontend port (Task 14).
 */

export interface OverviewReport {
	total_income: number;
	total_expense: number;
	net_cash_flow: number;
	spending_by_bucket: { type_id: string; name: string; total: number }[];
	top_categories: { tag_id: string; name: string; total: number }[];
	top_transactions: { id: string; payee: string | null; amount: number; date: string }[];
}

export interface TrendPoint {
	month: string;
	income: number;
	expense: number;
	net: number;
}

export interface CompareRow {
	tag_id: string | null;
	name: string;
	month_a: number;
	month_b: number;
	change: number;
	change_pct: number | null;
}

export interface CategoryTrendPoint {
	month: string;
	spent: number;
}

export interface StackedCategoryPoint {
	month: string;
	tags: { tagId: string | null; name: string; total: number }[];
}

export interface YearOverYearPoint {
	month: string;
	yearAIncome: number;
	yearAExpense: number;
	yearBIncome: number;
	yearBExpense: number;
}

export interface NetWorthPoint {
	month: string;
	netWorth: number;
}

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
