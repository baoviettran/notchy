// Forwarder — canonical implementation moved to browser/repos/budgets.ts
export {
	type Budget,
	type BudgetSummary,
	type ToBudgetBreakdown,
	getBudgetsForMonth,
	getSpentForBucket,
	getRolledOver,
	getToBudget,
	setAllocation,
	copyFromPreviousMonth,
	hasAllocations
} from '../browser/repos/budgets';
