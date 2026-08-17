/**
 * Native transactions adapter — inactive stub.
 *
 * Typed to match `src/lib/db/repos/transactions.ts` signatures.
 * Will be wired into production during the frontend port (Task 13).
 */

import type {
	TransactionKind as NativeTransactionKind,
	Transaction as NativeTransaction,
	NewTransaction as NativeNewTransaction,
	TransactionFilter as NativeTransactionFilter,
	TransactionPatch as NativeTransactionPatch,
} from '$lib/native/contracts.generated';

export type TransactionKind = NativeTransactionKind;
export type Transaction = NativeTransaction;
export type NewTransaction = NativeNewTransaction;
export type TransactionFilter = NativeTransactionFilter;
export type TransactionPatch = NativeTransactionPatch;

export async function listTransactions(_filter: TransactionFilter = {}): Promise<Transaction[]> {
	throw new Error('native transactions adapter not wired');
}

export async function getTransaction(_id: string): Promise<Transaction | null> {
	throw new Error('native transactions adapter not wired');
}

export async function createTransaction(_input: NewTransaction): Promise<string> {
	throw new Error('native transactions adapter not wired');
}

export async function createTransactions(_inputs: NewTransaction[]): Promise<string[]> {
	throw new Error('native transactions adapter not wired');
}

export async function updateTransaction(_id: string, _patch: Partial<TransactionPatch>): Promise<void> {
	throw new Error('native transactions adapter not wired');
}

export async function deleteTransaction(_id: string): Promise<void> {
	throw new Error('native transactions adapter not wired');
}

export async function restoreTransaction(_id: string): Promise<void> {
	throw new Error('native transactions adapter not wired');
}

export async function duplicateTransaction(_id: string): Promise<string> {
	throw new Error('native transactions adapter not wired');
}
