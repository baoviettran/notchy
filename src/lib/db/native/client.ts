/**
 * NativeDatabaseClient — wraps Tauri invoke() calls.
 *
 * INACTIVE until Task 14. All methods throw "native client not wired".
 * Generates operation ULID once per user intent; retry paths reuse the same ULID.
 */
import { invoke } from '@tauri-apps/api/core';
import { ulid } from '$lib/utils/id';
import type {
	AppDatabase,
	AccountOps,
	TransactionOps,
	CategoryOps,
	BudgetOps,
	GoalOps,
	RuleOps,
	MetaOps,
	DebtOps,
	ReconciliationOps,
	ReportOps,
} from '../client';
import type { AccountType, AccountWithBalance, NewAccount } from '../client';
import type { TransactionKind, Transaction, NewTransaction, TransactionFilter } from '../client';
import type { Bucket, Tag, TagDeleteInfo } from '../client';
import type { BudgetSummary } from '../client';
import type { GoalWithProgress, NewGoal, GoalStatus } from '../client';
import type { CategorizeRule, NewCategorizeRule, CategorizeRuleUpdate } from '../client';
import type { DebtAccount } from '../client';
import type { Reconciliation, ReconcileResult } from '../client';
import type {
	OverviewReport,
	TrendPoint,
	CompareRow,
	CategoryTrendPoint,
	StackedCategoryPoint,
	YearOverYearPoint,
	NetWorthPoint,
} from '../client';

function die(): Promise<never> {
	return Promise.reject(new Error('native client not wired'));
}

class NativeAccountOps implements AccountOps {
	list(): Promise<AccountWithBalance[]> { return die(); }
	get(_id: string): Promise<AccountWithBalance | null> { return die(); }
	getBalance(_accountId: string): Promise<number> { return die(); }
	getBalanceAsOf(_accountId: string, _date: string): Promise<number> { return die(); }
	create(_input: NewAccount): Promise<string> { return die(); }
	update(_id: string, _patch: { name?: string; type?: AccountType; counterparty?: string | null; archived?: number }): Promise<void> { return die(); }
	delete(_id: string): Promise<void> { return die(); }
}

class NativeTransactionOps implements TransactionOps {
	list(_filter?: TransactionFilter): Promise<Transaction[]> { return die(); }
	get(_id: string): Promise<Transaction | null> { return die(); }
	create(_input: NewTransaction): Promise<string> { return die(); }
	createBatch(_inputs: NewTransaction[]): Promise<string[]> { return die(); }
	update(_id: string, _patch: Partial<NewTransaction>): Promise<void> { return die(); }
	delete(_id: string): Promise<void> { return die(); }
	restore(_id: string): Promise<void> { return die(); }
	duplicate(_id: string): Promise<string> { return die(); }
}

class NativeCategoryOps implements CategoryOps {
	listBuckets(): Promise<Bucket[]> { return die(); }
	createBucket(_name: string, _budgetable?: number): Promise<string> { return die(); }
	renameBucket(_id: string, _name: string): Promise<void> { return die(); }
	setRolloverEnabled(_id: string, _enabled: boolean): Promise<void> { return die(); }
	deleteBucket(_id: string): Promise<void> { return die(); }
	listTags(_bucketId?: string): Promise<Tag[]> { return die(); }
	createTag(_name: string, _bucketId: string): Promise<string> { return die(); }
	renameTag(_id: string, _name: string): Promise<void> { return die(); }
	moveTag(_tagId: string, _newBucketId: string): Promise<TagDeleteInfo> { return die(); }
	getTagTransactionInfo(_tagId: string): Promise<TagDeleteInfo> { return die(); }
	deleteTag(_id: string, _option: 'uncategorise' | { merge_into: string }): Promise<void> { return die(); }
}

class NativeBudgetOps implements BudgetOps {
	getForMonth(_month: string): Promise<BudgetSummary[]> { return die(); }
	getSpentForBucket(_typeId: string, _month: string): Promise<number> { return die(); }
	getRolledOver(_typeId: string, _month: string): Promise<number> { return die(); }
	setAllocation(_typeId: string, _month: string, _allocated: number): Promise<void> { return die(); }
	copyFromPreviousMonth(_targetMonth: string): Promise<void> { return die(); }
	hasAllocations(_month: string): Promise<boolean> { return die(); }
}

class NativeGoalOps implements GoalOps {
	list(): Promise<GoalWithProgress[]> { return die(); }
	get(_id: string): Promise<GoalWithProgress | null> { return die(); }
	create(_input: NewGoal): Promise<string> { return die(); }
	update(_id: string, _patch: Partial<NewGoal> & { status?: GoalStatus }): Promise<void> { return die(); }
	delete(_id: string): Promise<void> { return die(); }
}

class NativeRuleOps implements RuleOps {
	list(): Promise<CategorizeRule[]> { return die(); }
	listAll(): Promise<CategorizeRule[]> { return die(); }
	create(_input: NewCategorizeRule): Promise<CategorizeRule> { return die(); }
	update(_id: string, _patch: CategorizeRuleUpdate): Promise<CategorizeRule> { return die(); }
	delete(_id: string): Promise<void> { return die(); }
	upsertLearned(_payeeTerm: string, _tagId: string): Promise<CategorizeRule> { return die(); }
}

class NativeMetaOps implements MetaOps {
	get(_key: string): Promise<string | null> { return die(); }
	set(_key: string, _value: string): Promise<void> { return die(); }
	delete(_key: string): Promise<void> { return die(); }
	isFirstRunComplete(): Promise<boolean> { return die(); }
	getLocale(): Promise<string> { return die(); }
	getCurrency(): Promise<string> { return die(); }
	isTourComplete(): Promise<boolean> { return die(); }
	setTourComplete(): Promise<void> { return die(); }
	getDefaultQuickAccount(): Promise<string | null> { return die(); }
	setDefaultQuickAccount(_accountId: string): Promise<void> { return die(); }
	clearDefaultQuickAccount(): Promise<void> { return die(); }
}

class NativeDebtOps implements DebtOps {
	list(): Promise<{ i_owe: DebtAccount[]; owed_to_me: DebtAccount[] }> { return die(); }
	writeOff(_accountId: string, _amount: number, _tagId?: string): Promise<string> { return die(); }
}

class NativeReconciliationOps implements ReconciliationOps {
	getHistory(_accountId: string): Promise<Reconciliation[]> { return die(); }
	reconcile(_accountId: string, _actualBalance: number, _createAdjustment: boolean, _notes?: string): Promise<ReconcileResult> { return die(); }
}

class NativeReportOps implements ReportOps {
	getOverview(_month: string, _includeAdjustments?: boolean): Promise<OverviewReport> { return die(); }
	getTrend(_months: number, _includeAdjustments?: boolean, _bucketId?: string): Promise<TrendPoint[]> { return die(); }
	getComparison(_monthA: string, _monthB: string, _includeAdjustments?: boolean): Promise<CompareRow[]> { return die(); }
	getCategoryTrend(_tagId: string, _months: number, _includeAdjustments?: boolean): Promise<CategoryTrendPoint[]> { return die(); }
	getStackedCategorySeries(_months: number, _includeAdjustments?: boolean): Promise<StackedCategoryPoint[]> { return die(); }
	getYearOverYear(_yearA: number, _yearB: number, _includeAdjustments?: boolean): Promise<YearOverYearPoint[]> { return die(); }
	getNetWorthSeries(_months: number, _includeAdjustments?: boolean): Promise<NetWorthPoint[]> { return die(); }
}

/**
 * NativeDatabaseClient — wraps Tauri invoke() calls.
 *
 * INACTIVE until Task 14. All methods throw "native client not wired".
 * Generates operation ULID once per user intent; retry paths reuse the same ULID.
 */
export class NativeDatabaseClient implements AppDatabase {
	readonly accounts: AccountOps = new NativeAccountOps();
	readonly transactions: TransactionOps = new NativeTransactionOps();
	readonly categories: CategoryOps = new NativeCategoryOps();
	readonly budgets: BudgetOps = new NativeBudgetOps();
	readonly goals: GoalOps = new NativeGoalOps();
	readonly rules: RuleOps = new NativeRuleOps();
	readonly meta: MetaOps = new NativeMetaOps();
	readonly debts: DebtOps = new NativeDebtOps();
	readonly reconciliations: ReconciliationOps = new NativeReconciliationOps();
	readonly reports: ReportOps = new NativeReportOps();

	/**
	 * Generate an operation ULID for a user intent.
	 * Retry paths should reuse the same ULID to ensure idempotency.
	 */
	generateOperationId(): string {
		return ulid();
	}
}
