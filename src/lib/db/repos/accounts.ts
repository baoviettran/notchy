// Forwarder — canonical implementation moved to browser/repos/accounts.ts
export {
	type AccountType,
	type Account,
	type AccountWithBalance,
	type NewAccount,
	isAssetType,
	isLiabilityType,
	isLoanType,
	listAccounts,
	getAccount,
	getBalance,
	getBalanceAsOf,
	createAccount,
	updateAccount,
	deleteAccount
} from '../browser/repos/accounts';
