// Forwarder — canonical implementation moved to browser/repos/budgets.ts
export {
	type Budget,
	type BudgetSummary,
	getBudgetsForMonth,
	getSpentForBucket,
	getRolledOver,
	setAllocation,
	copyFromPreviousMonth,
	hasAllocations
} from '../browser/repos/budgets';
