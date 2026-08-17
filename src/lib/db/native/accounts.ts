/**
 * Native accounts adapter — inactive stub.
 *
 * Typed to match `src/lib/db/repos/accounts.ts` signatures.
 * Will be wired into production during the frontend port (Task 13).
 */

import type {
	AccountType as NativeAccountType,
	Account as NativeAccount,
	AccountWithBalance as NativeAccountWithBalance,
	NewAccount as NativeNewAccount,
	AccountPatch as NativeAccountPatch,
} from '$lib/native/contracts.generated';

// Re-export the generated types under the names the rest of the app uses.
export type AccountType = NativeAccountType;
export type Account = NativeAccount;
export type AccountWithBalance = NativeAccountWithBalance;
export type NewAccount = NativeNewAccount;
export type AccountPatch = NativeAccountPatch;

export async function listAccounts(): Promise<AccountWithBalance[]> {
	throw new Error('native accounts adapter not wired');
}

export async function getAccount(_id: string): Promise<AccountWithBalance | null> {
	throw new Error('native accounts adapter not wired');
}

export async function createAccount(_input: NewAccount): Promise<string> {
	throw new Error('native accounts adapter not wired');
}

export async function updateAccount(_id: string, _patch: AccountPatch): Promise<void> {
	throw new Error('native accounts adapter not wired');
}

export async function deleteAccount(_id: string): Promise<void> {
	throw new Error('native accounts adapter not wired');
}
