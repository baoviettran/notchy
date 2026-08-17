import { getDb } from '$lib/db';
import { isAssetType, type AccountWithBalance, type NewAccount, type AccountType } from '$lib/db/client';
import { mapError } from '$lib/utils/errors';

class AccountsStore {
	items = $state<AccountWithBalance[]>([]);
	loading = $state(false);
	error = $state<string | null>(null);

	get assets() {
		return this.items.filter((a) => isAssetType(a.type) && !a.archived);
	}

	get liabilities() {
		return this.items.filter((a) => !isAssetType(a.type) && !a.archived);
	}

	get archived() {
		return this.items.filter((a) => a.archived);
	}

	async load(): Promise<void> {
		this.loading = true;
		this.error = null;
		try {
			const db = getDb();
			this.items = await db.accounts.list();
		} catch (e) {
			this.error = mapError(e);
		} finally {
			this.loading = false;
		}
	}

	async create(input: NewAccount): Promise<string> {
		const db = getDb();
		const id = await db.accounts.create(input);
		await this.load();
		return id;
	}

	async update(id: string, patch: { name?: string; type?: AccountType; counterparty?: string | null; archived?: number }): Promise<void> {
		const db = getDb();
		await db.accounts.update(id, patch);
		await this.load();
	}

	async delete(id: string): Promise<void> {
		const db = getDb();
		await db.accounts.delete(id);
		await this.load();
	}
}

export const accounts = new AccountsStore();
