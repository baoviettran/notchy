import { getDb } from '$lib/db';
import * as repo from '$lib/db/repos/accounts';
import type { AccountWithBalance, NewAccount, AccountType } from '$lib/db/repos/accounts';
import { mapError } from '$lib/utils/errors';

class AccountsStore {
	items = $state<AccountWithBalance[]>([]);
	loading = $state(false);
	error = $state<string | null>(null);

	get assets() {
		return this.items.filter((a) => repo.isAssetType(a.type) && !a.archived);
	}

	get liabilities() {
		return this.items.filter((a) => !repo.isAssetType(a.type) && !a.archived);
	}

	get archived() {
		return this.items.filter((a) => a.archived);
	}

	async load(): Promise<void> {
		this.loading = true;
		this.error = null;
		try {
			const db = await getDb();
			this.items = await repo.listAccounts(db);
		} catch (e) {
			this.error = mapError(e);
		} finally {
			this.loading = false;
		}
	}

	async create(input: NewAccount): Promise<string> {
		const db = await getDb();
		const id = await repo.createAccount(db, input);
		await this.load();
		return id;
	}

	async update(id: string, patch: { name?: string; type?: AccountType; counterparty?: string | null; archived?: number }): Promise<void> {
		const db = await getDb();
		await repo.updateAccount(db, id, patch);
		await this.load();
	}

	async delete(id: string): Promise<void> {
		const db = await getDb();
		await repo.deleteAccount(db, id);
		await this.load();
	}
}

export const accounts = new AccountsStore();
