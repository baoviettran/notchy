<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '$lib/components/primitives/Button.svelte';
	import Modal from '$lib/components/primitives/Modal.svelte';
	import AccountForm from '$lib/components/forms/AccountForm.svelte';
	import ConfirmDialog from '$lib/components/primitives/ConfirmDialog.svelte';
	import { accounts } from '$lib/stores/accounts.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { getDb } from '$lib/db';
	import { formatCurrency } from '$lib/utils/currency';
	import type { AccountWithBalance } from '$lib/db/repos/accounts';
	import { accountTypeLabel } from '$lib/utils/account-type';
	import * as m from '$lib/paraglide/messages';
	import { mapError } from '$lib/utils/errors';
	import EmptyState from '$lib/components/primitives/EmptyState.svelte';
	import ErrorState from '$lib/components/primitives/ErrorState.svelte';
	import ContextMenu from '$lib/components/primitives/ContextMenu.svelte';

	let showForm = $state(false);
	let editing = $state<AccountWithBalance | null>(null);
	let confirmDelete = $state<AccountWithBalance | null>(null);
	// Transaction count for the account pending deletion, so the confirm dialog
	// can state the impact. Fetched when the menu's Delete is opened, not on
	// every render. 0 means "no transactions" → the short body message is used.
	let deleteTxCount = $state(0);

	// Deleting is a rare, high-impact action: count the account's transactions
	// before showing the confirm so the user knows what they're about to remove
	// from their net worth (the transactions themselves stay in history).
	async function openDeleteConfirm(a: AccountWithBalance) {
		const db = getDb();
		const txs = await db.transactions.list({ account_id: a.id, limit: 100000 });
		deleteTxCount = txs.length;
		confirmDelete = a;
	}

	onMount(() => accounts.load());

	function openCreate() { editing = null; showForm = true; }
	function openEdit(a: AccountWithBalance) { editing = a; showForm = true; }

	async function archiveAccount(a: AccountWithBalance) {
		const wasArchived = !!a.archived;
		await accounts.update(a.id, { archived: wasArchived ? 0 : 1 });
		if (wasArchived) {
			toast.show(m.accounts_unarchived_toast());
		} else {
			toast.show(m.accounts_archived_toast(), {
				action: m.accounts_archived_undo(),
				onaction: () => { void accounts.update(a.id, { archived: 0 }); }
			});
		}
	}

	async function doDelete() {
		if (!confirmDelete) return;
		try {
			// The store owns the deleted + undo toasts (same language as
			// transaction delete and frequent-repeat undo).
			await accounts.delete(confirmDelete.id);
		} catch (e) {
			toast.show(mapError(e));
		}
		confirmDelete = null;
		deleteTxCount = 0;
	}
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="figures text-xl text-ledger tracking-wide">{m.accounts_title()}</h1>
		<Button size="sm" onclick={openCreate}>{m.accounts_add()}</Button>
	</div>

	{#if accounts.loading}
		<p class="text-dim text-sm py-8 text-center">{m.common_loading()}</p>
	{:else if accounts.error}
		<ErrorState description={accounts.error} onRetry={() => accounts.load()} />
	{:else}
	<section>
		<h2 class="plate mb-2">{m.accounts_assets()}</h2>
		{#if accounts.assets.length === 0}
			<div class="bg-tape rounded-lg border border-line">
				<EmptyState message={m.accounts_empty_assets()} icon="▮▯▯▯" />
			</div>
		{:else}
			<div class="bg-tape rounded-lg border border-line divide-y divide-line">
				{#each accounts.assets as acc}
					<div class="flex items-center justify-between p-4 group">
						<a href="/accounts/{acc.id}" class="flex-1">
							<div class="text-sm font-medium text-ledger">{acc.name}</div>
							<div class="text-xs text-dim">{accountTypeLabel(acc.type)}{acc.counterparty ? ` · ${acc.counterparty}` : ''}</div>
						</a>
						<span class="figures text-sm text-ledger mr-3">{formatCurrency(acc.balance, settings.currency, settings.locale)}</span>
						<ContextMenu label={m.common_edit()}>
							<button onclick={() => openEdit(acc)} role="menuitem" class="w-full text-left px-3 py-2 text-sm text-ledger hover:bg-line/40">{m.common_edit()}</button>
							<button onclick={() => archiveAccount(acc)} role="menuitem" class="w-full text-left px-3 py-2 text-sm text-ledger hover:bg-line/40">{acc.archived ? m.accounts_unarchive() : m.accounts_archive()}</button>
							<button onclick={() => openDeleteConfirm(acc)} role="menuitem" class="w-full text-left px-3 py-2 text-sm text-debit hover:bg-line/40">{m.common_delete()}</button>
						</ContextMenu>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<section>
		<h2 class="plate mb-2">{m.accounts_liabilities()}</h2>
		{#if accounts.liabilities.length === 0}
			<div class="bg-tape rounded-lg border border-line">
				<EmptyState message={m.accounts_empty_liabilities()} icon="▮▯▯▯" />
			</div>
		{:else}
			<div class="bg-tape rounded-lg border border-line divide-y divide-line">
				{#each accounts.liabilities as acc}
					<div class="flex items-center justify-between p-4 group">
						<a href="/accounts/{acc.id}" class="flex-1">
							<div class="text-sm font-medium text-ledger">{acc.name}</div>
							<div class="text-xs text-dim">{accountTypeLabel(acc.type)}{acc.counterparty ? ` · ${acc.counterparty}` : ''}</div>
						</a>
						<span class="figures text-sm text-debit mr-3">{formatCurrency(Math.abs(acc.balance), settings.currency, settings.locale)}</span>
						<ContextMenu label={m.common_edit()}>
							<button onclick={() => openEdit(acc)} role="menuitem" class="w-full text-left px-3 py-2 text-sm text-ledger hover:bg-line/40">{m.common_edit()}</button>
							<button onclick={() => openDeleteConfirm(acc)} role="menuitem" class="w-full text-left px-3 py-2 text-sm text-debit hover:bg-line/40">{m.common_delete()}</button>
						</ContextMenu>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	{#if accounts.archived.length > 0}
		<section>
			<h2 class="plate mb-2">{m.accounts_archived()}</h2>
			<div class="bg-tape rounded-lg border border-line divide-y divide-line">
				{#each accounts.archived as acc}
					<div class="flex items-center justify-between p-4">
						<div class="flex-1">
							<div class="text-sm text-dim">{acc.name}</div>
						</div>
						<button onclick={() => archiveAccount(acc)} class="text-xs text-phosphor hover:underline">{m.accounts_unarchive()}</button>
					</div>
				{/each}
			</div>
		</section>
	{/if}
	{/if}
</div>

<Modal bind:open={showForm} title={editing ? m.accounts_edit_modal() : m.accounts_add_modal()}>
	<AccountForm account={editing} onclose={() => showForm = false} />
</Modal>

<ConfirmDialog
	open={confirmDelete !== null}
	title={m.accounts_delete_confirm_title()}
	message={deleteTxCount === 1 ? m.accounts_delete_confirm_body_one() : deleteTxCount > 1 ? m.accounts_delete_confirm_body_many({ count: deleteTxCount }) : m.accounts_delete_confirm_body()}
	confirmLabel={m.common_delete()}
	onconfirm={doDelete}
/>
