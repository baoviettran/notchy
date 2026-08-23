/**
 * AppDatabase — domain port interface.
 *
 * Exposes domain services only: no `execute`, no `transaction`, no raw SQL.
 * Two adapters implement this interface:
 * - `BrowserDatabaseClient` — owns sql.js; used by Vitest and Playwright E2E.
 * - `NativeDatabaseClient` — wraps Tauri invoke(); inactive until Task 14.
 */
import type { DatabaseService } from './browser/service';
import type {
	AccountType,
	AccountWithBalance,
	NewAccount,
} from './browser/repos/accounts';
import type {
	TransactionKind,
	Transaction,
	NewTransaction,
	TransactionFilter,
} from './browser/repos/transactions';
import type {
	Bucket,
	Tag,
	TagDeleteInfo,
} from './browser/repos/categories';
import type { BudgetSummary } from './browser/repos/budgets';
import type {
	GoalWithProgress,
	NewGoal,
	GoalStatus,
} from './browser/repos/goals';
import type {
	CategorizeRule,
	NewCategorizeRule,
	CategorizeRuleUpdate,
} from './browser/repos/rules';
import type { DebtAccount } from './browser/repos/debts';
import type {
	Reconciliation,
	ReconcileResult,
} from './browser/repos/reconciliations';
import type {
	OverviewReport,
	TrendPoint,
	CompareRow,
	CategoryTrendPoint,
	StackedCategoryPoint,
	YearOverYearPoint,
	NetWorthPoint,
} from './browser/repos/reports';

// ---------------------------------------------------------------------------
// Re-export domain types so consumers can import from '$lib/db/client'.
// ---------------------------------------------------------------------------
export type { AccountType, AccountWithBalance, NewAccount };
export { isAssetType, isLiabilityType, isLoanType } from './browser/repos/accounts';
export type { TransactionKind, Transaction, NewTransaction, TransactionFilter };
export type { Bucket, Tag, TagDeleteInfo };
export type { BudgetSummary } from './browser/repos/budgets';
export type { GoalWithProgress, NewGoal, GoalStatus };
export type { CategorizeRule, NewCategorizeRule, CategorizeRuleUpdate };
export type { DebtAccount };
export type { Reconciliation, ReconcileResult };
export type {
	OverviewReport,
	TrendPoint,
	CompareRow,
	CategoryTrendPoint,
	StackedCategoryPoint,
	YearOverYearPoint,
	NetWorthPoint,
};

// ---------------------------------------------------------------------------
// Operation interfaces — one per domain.
// ---------------------------------------------------------------------------

export interface AccountOps {
	list(): Promise<AccountWithBalance[]>;
	get(id: string): Promise<AccountWithBalance | null>;
	getBalance(accountId: string): Promise<number>;
	getBalanceAsOf(accountId: string, date: string): Promise<number>;
	create(input: NewAccount): Promise<string>;
	update(id: string, patch: { name?: string; type?: AccountType; counterparty?: string | null; archived?: number }): Promise<void>;
	delete(id: string): Promise<void>;
	restore(id: string): Promise<void>;
}

export interface TransactionOps {
	list(filter?: TransactionFilter): Promise<Transaction[]>;
	get(id: string): Promise<Transaction | null>;
	create(input: NewTransaction): Promise<string>;
	createBatch(inputs: NewTransaction[]): Promise<string[]>;
	update(id: string, patch: Partial<NewTransaction>): Promise<void>;
	delete(id: string): Promise<void>;
	restore(id: string): Promise<void>;
	duplicate(id: string): Promise<string>;
	deleteMany(ids: string[]): Promise<void>;
	setTagMany(ids: string[], tagId: string | null): Promise<void>;
	setAccountMany(ids: string[], accountId: string): Promise<void>;
	getFrequent(sinceDate: string): Promise<FrequentTx[]>;
}

export interface FrequentTx {
	payee: string;
	tag_id: string | null;
	account_id: string;
	amount: number;
	kind: string;
	count: number;
}

export interface CategoryOps {
	listBuckets(): Promise<Bucket[]>;
	createBucket(name: string, budgetable?: number): Promise<string>;
	renameBucket(id: string, name: string): Promise<void>;
	setRolloverEnabled(id: string, enabled: boolean): Promise<void>;
	deleteBucket(id: string): Promise<void>;
	listTags(bucketId?: string): Promise<Tag[]>;
	createTag(name: string, bucketId: string): Promise<string>;
	renameTag(id: string, name: string): Promise<void>;
	moveTag(tagId: string, newBucketId: string): Promise<TagDeleteInfo>;
	getTagTransactionInfo(tagId: string): Promise<TagDeleteInfo>;
	deleteTag(id: string, option: 'uncategorise' | { merge_into: string }): Promise<void>;
}

export interface BudgetOps {
	getForMonth(month: string): Promise<BudgetSummary[]>;
	getSpentForBucket(typeId: string, month: string): Promise<number>;
	getRolledOver(typeId: string, month: string): Promise<number>;
	setAllocation(typeId: string, month: string, allocated: number): Promise<void>;
	copyFromPreviousMonth(targetMonth: string): Promise<void>;
	hasAllocations(month: string): Promise<boolean>;
}

export interface GoalOps {
	list(): Promise<GoalWithProgress[]>;
	get(id: string): Promise<GoalWithProgress | null>;
	create(input: NewGoal): Promise<string>;
	update(id: string, patch: Partial<NewGoal> & { status?: GoalStatus }): Promise<void>;
	delete(id: string): Promise<void>;
}

export interface RuleOps {
	list(): Promise<CategorizeRule[]>;
	listAll(): Promise<CategorizeRule[]>;
	create(input: NewCategorizeRule): Promise<CategorizeRule>;
	update(id: string, patch: CategorizeRuleUpdate): Promise<CategorizeRule>;
	delete(id: string): Promise<void>;
	upsertLearned(payeeTerm: string, tagId: string): Promise<CategorizeRule>;
}

export interface MetaOps {
	get(key: string): Promise<string | null>;
	set(key: string, value: string): Promise<void>;
	delete(key: string): Promise<void>;
	isFirstRunComplete(): Promise<boolean>;
	setFirstRunComplete(): Promise<void>;
	getLocale(): Promise<string>;
	getCurrency(): Promise<string>;
	isTourComplete(): Promise<boolean>;
	setTourComplete(): Promise<void>;
	getDefaultQuickAccount(): Promise<string | null>;
	setDefaultQuickAccount(accountId: string): Promise<void>;
	clearDefaultQuickAccount(): Promise<void>;
}

export interface DebtOps {
	list(): Promise<{ i_owe: DebtAccount[]; owed_to_me: DebtAccount[] }>;
	writeOff(accountId: string, amount: number, tagId?: string): Promise<string>;
}

export interface ReconciliationOps {
	getHistory(accountId: string): Promise<Reconciliation[]>;
	reconcile(accountId: string, actualBalance: number, createAdjustment: boolean, notes?: string): Promise<ReconcileResult>;
}

export interface ReportOps {
	getOverview(month: string, includeAdjustments?: boolean): Promise<OverviewReport>;
	getTrend(months: number, includeAdjustments?: boolean, bucketId?: string): Promise<TrendPoint[]>;
	getComparison(monthA: string, monthB: string, includeAdjustments?: boolean): Promise<CompareRow[]>;
	getCategoryTrend(tagId: string, months: number, includeAdjustments?: boolean): Promise<CategoryTrendPoint[]>;
	getStackedCategorySeries(months: number, includeAdjustments?: boolean): Promise<StackedCategoryPoint[]>;
	getYearOverYear(yearA: number, yearB: number, includeAdjustments?: boolean): Promise<YearOverYearPoint[]>;
	getNetWorthSeries(months: number, includeAdjustments?: boolean): Promise<NetWorthPoint[]>;
}

// ---------------------------------------------------------------------------
// Domain port
// ---------------------------------------------------------------------------

export interface AppDatabase {
	readonly accounts: AccountOps;
	readonly transactions: TransactionOps;
	readonly categories: CategoryOps;
	readonly budgets: BudgetOps;
	readonly goals: GoalOps;
	readonly rules: RuleOps;
	readonly meta: MetaOps;
	readonly debts: DebtOps;
	readonly reconciliations: ReconciliationOps;
	readonly reports: ReportOps;
}
