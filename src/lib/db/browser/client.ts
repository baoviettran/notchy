/**
 * BrowserDatabaseClient — owns sql.js, preserves existing DatabaseService behavior.
 *
 * Used by Vitest and Playwright E2E tests. Implements the AppDatabase domain
 * port by delegating to browser/repos/* which take a DatabaseService parameter.
 */
import type { DatabaseService } from './service';
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
import type { AccountType, AccountWithBalance, NewAccount } from './repos/accounts';
import type { TransactionKind, Transaction, NewTransaction, TransactionFilter } from './repos/transactions';
import type { Bucket, Tag, TagDeleteInfo } from './repos/categories';
import type { BudgetSummary } from './repos/budgets';
import type { GoalWithProgress, NewGoal, GoalStatus } from './repos/goals';
import type { CategorizeRule, NewCategorizeRule, CategorizeRuleUpdate } from './repos/rules';
import type { DebtAccount } from './repos/debts';
import type { Reconciliation, ReconcileResult } from './repos/reconciliations';
import type {
	OverviewReport,
	TrendPoint,
	CompareRow,
	CategoryTrendPoint,
	StackedCategoryPoint,
	YearOverYearPoint,
	NetWorthPoint,
} from './repos/reports';
import * as accountsRepo from './repos/accounts';
import * as transactionsRepo from './repos/transactions';
import * as categoriesRepo from './repos/categories';
import * as budgetsRepo from './repos/budgets';
import * as goalsRepo from './repos/goals';
import * as rulesRepo from './repos/rules';
import * as metaRepo from './repos/meta';
import * as debtsRepo from './repos/debts';
import * as reconciliationsRepo from './repos/reconciliations';
import * as reportsRepo from './repos/reports';
import { getDefaultQuickAccount, setDefaultQuickAccount, clearDefaultQuickAccount } from './repos/quick_account';

class BrowserAccountOps implements AccountOps {
	constructor(private db: DatabaseService) {}

	list(): Promise<AccountWithBalance[]> {
		return accountsRepo.listAccounts(this.db);
	}

	get(id: string): Promise<AccountWithBalance | null> {
		return accountsRepo.getAccount(this.db, id);
	}

	getBalance(accountId: string): Promise<number> {
		return accountsRepo.getBalance(this.db, accountId);
	}

	getBalanceAsOf(accountId: string, date: string): Promise<number> {
		return accountsRepo.getBalanceAsOf(this.db, accountId, date);
	}

	create(input: NewAccount): Promise<string> {
		return accountsRepo.createAccount(this.db, input);
	}

	update(id: string, patch: { name?: string; type?: AccountType; counterparty?: string | null; archived?: number }): Promise<void> {
		return accountsRepo.updateAccount(this.db, id, patch);
	}

	delete(id: string): Promise<void> {
		return accountsRepo.deleteAccount(this.db, id);
	}

	restore(id: string): Promise<void> {
		return accountsRepo.restoreAccount(this.db, id);
	}
}

class BrowserTransactionOps implements TransactionOps {
	constructor(private db: DatabaseService) {}

	list(filter?: TransactionFilter): Promise<Transaction[]> {
		return transactionsRepo.listTransactions(this.db, filter);
	}

	get(id: string): Promise<Transaction | null> {
		return transactionsRepo.getTransaction(this.db, id);
	}

	create(input: NewTransaction): Promise<string> {
		return transactionsRepo.createTransaction(this.db, input);
	}

	createBatch(inputs: NewTransaction[]): Promise<string[]> {
		return transactionsRepo.createTransactions(this.db, inputs);
	}

	update(id: string, patch: Partial<NewTransaction>): Promise<void> {
		return transactionsRepo.updateTransaction(this.db, id, patch);
	}

	delete(id: string): Promise<void> {
		return transactionsRepo.deleteTransaction(this.db, id);
	}

	restore(id: string): Promise<void> {
		return transactionsRepo.restoreTransaction(this.db, id);
	}

	duplicate(id: string): Promise<string> {
		return transactionsRepo.duplicateTransaction(this.db, id);
	}

	async getFrequent(sinceDate: string): Promise<import('../client').FrequentTx[]> {
		return this.db.query<import('../client').FrequentTx>(
			`SELECT payee, tag_id, account_id, amount, kind, COUNT(*) as count
			 FROM transactions
			 WHERE deleted_at IS NULL AND date >= ? AND payee IS NOT NULL AND kind IN ('expense', 'income')
			 GROUP BY payee, tag_id, account_id
			 ORDER BY count DESC, date DESC
			 LIMIT 5`,
			[sinceDate]
		);
	}
}

class BrowserCategoryOps implements CategoryOps {
	constructor(private db: DatabaseService) {}

	listBuckets(): Promise<Bucket[]> {
		return categoriesRepo.listBuckets(this.db);
	}

	createBucket(name: string, budgetable?: number): Promise<string> {
		return categoriesRepo.createBucket(this.db, name, budgetable);
	}

	renameBucket(id: string, name: string): Promise<void> {
		return categoriesRepo.renameBucket(this.db, id, name);
	}

	setRolloverEnabled(id: string, enabled: boolean): Promise<void> {
		return categoriesRepo.setRolloverEnabled(this.db, id, enabled);
	}

	deleteBucket(id: string): Promise<void> {
		return categoriesRepo.deleteBucket(this.db, id);
	}

	listTags(bucketId?: string): Promise<Tag[]> {
		return categoriesRepo.listTags(this.db, bucketId);
	}

	createTag(name: string, bucketId: string): Promise<string> {
		return categoriesRepo.createTag(this.db, name, bucketId);
	}

	renameTag(id: string, name: string): Promise<void> {
		return categoriesRepo.renameTag(this.db, id, name);
	}

	moveTag(tagId: string, newBucketId: string): Promise<TagDeleteInfo> {
		return categoriesRepo.moveTag(this.db, tagId, newBucketId);
	}

	getTagTransactionInfo(tagId: string): Promise<TagDeleteInfo> {
		return categoriesRepo.getTagTransactionInfo(this.db, tagId);
	}

	deleteTag(id: string, option: 'uncategorise' | { merge_into: string }): Promise<void> {
		return categoriesRepo.deleteTag(this.db, id, option);
	}
}

class BrowserBudgetOps implements BudgetOps {
	constructor(private db: DatabaseService) {}

	getForMonth(month: string): Promise<BudgetSummary[]> {
		return budgetsRepo.getBudgetsForMonth(this.db, month);
	}

	getSpentForBucket(typeId: string, month: string): Promise<number> {
		return budgetsRepo.getSpentForBucket(this.db, typeId, month);
	}

	getRolledOver(typeId: string, month: string): Promise<number> {
		return budgetsRepo.getRolledOver(this.db, typeId, month);
	}

	setAllocation(typeId: string, month: string, allocated: number): Promise<void> {
		return budgetsRepo.setAllocation(this.db, typeId, month, allocated);
	}

	copyFromPreviousMonth(targetMonth: string): Promise<void> {
		return budgetsRepo.copyFromPreviousMonth(this.db, targetMonth);
	}

	hasAllocations(month: string): Promise<boolean> {
		return budgetsRepo.hasAllocations(this.db, month);
	}
}

class BrowserGoalOps implements GoalOps {
	constructor(private db: DatabaseService) {}

	list(): Promise<GoalWithProgress[]> {
		return goalsRepo.listGoals(this.db);
	}

	get(id: string): Promise<GoalWithProgress | null> {
		return goalsRepo.getGoal(this.db, id);
	}

	create(input: NewGoal): Promise<string> {
		return goalsRepo.createGoal(this.db, input);
	}

	update(id: string, patch: Partial<NewGoal> & { status?: GoalStatus }): Promise<void> {
		return goalsRepo.updateGoal(this.db, id, patch);
	}

	delete(id: string): Promise<void> {
		return goalsRepo.deleteGoal(this.db, id);
	}
}

class BrowserRuleOps implements RuleOps {
	constructor(private db: DatabaseService) {}

	list(): Promise<CategorizeRule[]> {
		return rulesRepo.listRules(this.db);
	}

	listAll(): Promise<CategorizeRule[]> {
		return rulesRepo.listAllRules(this.db);
	}

	create(input: NewCategorizeRule): Promise<CategorizeRule> {
		return rulesRepo.createRule(this.db, input);
	}

	update(id: string, patch: CategorizeRuleUpdate): Promise<CategorizeRule> {
		return rulesRepo.updateRule(this.db, id, patch);
	}

	delete(id: string): Promise<void> {
		return rulesRepo.deleteRule(this.db, id);
	}

	upsertLearned(payeeTerm: string, tagId: string): Promise<CategorizeRule> {
		return rulesRepo.upsertLearned(this.db, payeeTerm, tagId);
	}
}

class BrowserMetaOps implements MetaOps {
	constructor(private db: DatabaseService) {}

	get(key: string): Promise<string | null> {
		return metaRepo.getMeta(this.db, key);
	}

	set(key: string, value: string): Promise<void> {
		return metaRepo.setMeta(this.db, key, value);
	}

	delete(key: string): Promise<void> {
		return metaRepo.deleteMeta(this.db, key);
	}

	isFirstRunComplete(): Promise<boolean> {
		return metaRepo.isFirstRunComplete(this.db);
	}

	setFirstRunComplete(): Promise<void> {
		return metaRepo.setFirstRunComplete(this.db);
	}

	getLocale(): Promise<string> {
		return metaRepo.getLocale(this.db);
	}

	getCurrency(): Promise<string> {
		return metaRepo.getCurrency(this.db);
	}

	isTourComplete(): Promise<boolean> {
		return metaRepo.isTourComplete(this.db);
	}

	setTourComplete(): Promise<void> {
		return metaRepo.setTourComplete(this.db);
	}

	getDefaultQuickAccount(): Promise<string | null> {
		return getDefaultQuickAccount(this.db);
	}

	setDefaultQuickAccount(accountId: string): Promise<void> {
		return setDefaultQuickAccount(this.db, accountId);
	}

	clearDefaultQuickAccount(): Promise<void> {
		return clearDefaultQuickAccount(this.db);
	}
}

class BrowserDebtOps implements DebtOps {
	constructor(private db: DatabaseService) {}

	list(): Promise<{ i_owe: DebtAccount[]; owed_to_me: DebtAccount[] }> {
		return debtsRepo.listDebts(this.db);
	}

	writeOff(accountId: string, amount: number, tagId?: string): Promise<string> {
		return debtsRepo.writeOff(this.db, accountId, amount, tagId);
	}
}

class BrowserReconciliationOps implements ReconciliationOps {
	constructor(private db: DatabaseService) {}

	getHistory(accountId: string): Promise<Reconciliation[]> {
		return reconciliationsRepo.getReconciliationHistory(this.db, accountId);
	}

	reconcile(accountId: string, actualBalance: number, createAdjustment: boolean, notes?: string): Promise<ReconcileResult> {
		return reconciliationsRepo.reconcile(this.db, accountId, actualBalance, createAdjustment, notes);
	}
}

class BrowserReportOps implements ReportOps {
	constructor(private db: DatabaseService) {}

	getOverview(month: string, includeAdjustments?: boolean): Promise<OverviewReport> {
		return reportsRepo.getOverview(this.db, month, includeAdjustments);
	}

	getTrend(months: number, includeAdjustments?: boolean, bucketId?: string): Promise<TrendPoint[]> {
		return reportsRepo.getTrend(this.db, months, includeAdjustments, bucketId);
	}

	getComparison(monthA: string, monthB: string, includeAdjustments?: boolean): Promise<CompareRow[]> {
		return reportsRepo.getComparison(this.db, monthA, monthB, includeAdjustments);
	}

	getCategoryTrend(tagId: string, months: number, includeAdjustments?: boolean): Promise<CategoryTrendPoint[]> {
		return reportsRepo.getCategoryTrend(this.db, tagId, months, includeAdjustments);
	}

	getStackedCategorySeries(months: number, includeAdjustments?: boolean): Promise<StackedCategoryPoint[]> {
		return reportsRepo.getStackedCategorySeries(this.db, months, includeAdjustments);
	}

	getYearOverYear(yearA: number, yearB: number, includeAdjustments?: boolean): Promise<YearOverYearPoint[]> {
		return reportsRepo.getYearOverYear(this.db, yearA, yearB, includeAdjustments);
	}

	getNetWorthSeries(months: number, includeAdjustments?: boolean): Promise<NetWorthPoint[]> {
		return reportsRepo.getNetWorthSeries(this.db, months, includeAdjustments);
	}
}

/**
 * BrowserDatabaseClient — owns a sql.js DatabaseService instance and
 * implements the AppDatabase domain port by delegating to browser repos.
 *
 * Used by Vitest and Playwright E2E tests.
 */
export class BrowserDatabaseClient implements AppDatabase {
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

	constructor(private db: DatabaseService) {
		this.accounts = new BrowserAccountOps(db);
		this.transactions = new BrowserTransactionOps(db);
		this.categories = new BrowserCategoryOps(db);
		this.budgets = new BrowserBudgetOps(db);
		this.goals = new BrowserGoalOps(db);
		this.rules = new BrowserRuleOps(db);
		this.meta = new BrowserMetaOps(db);
		this.debts = new BrowserDebtOps(db);
		this.reconciliations = new BrowserReconciliationOps(db);
		this.reports = new BrowserReportOps(db);
	}

	/**
	 * Direct access to the underlying DatabaseService for migration/pragma
	 * operations that bypass the domain port.
	 */
	get raw(): DatabaseService {
		return this.db;
	}
}
