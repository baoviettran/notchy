/**
 * Native meta adapter — inactive stub.
 *
 * Typed to match `src/lib/db/repos/meta.ts` and
 * `src/lib/db/repos/quick_account.ts` signatures.
 * Will be wired into production during the frontend port (Task 13).
 */

export async function getMeta(_key: string): Promise<string | null> {
	throw new Error('native meta adapter not wired');
}

export async function setMeta(_key: string, _value: string): Promise<void> {
	throw new Error('native meta adapter not wired');
}

export async function deleteMeta(_key: string): Promise<void> {
	throw new Error('native meta adapter not wired');
}

export async function isFirstRunComplete(): Promise<boolean> {
	throw new Error('native meta adapter not wired');
}

export async function getLocale(): Promise<string> {
	throw new Error('native meta adapter not wired');
}

export async function getCurrency(): Promise<string> {
	throw new Error('native meta adapter not wired');
}

export async function isTourComplete(): Promise<boolean> {
	throw new Error('native meta adapter not wired');
}

export async function setTourComplete(): Promise<void> {
	throw new Error('native meta adapter not wired');
}

// Quick account operations

export async function getDefaultQuickAccount(): Promise<string | null> {
	throw new Error('native meta adapter not wired');
}

export async function setDefaultQuickAccount(_accountId: string): Promise<void> {
	throw new Error('native meta adapter not wired');
}

export async function clearDefaultQuickAccount(): Promise<void> {
	throw new Error('native meta adapter not wired');
}
