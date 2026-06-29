<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '$lib/components/primitives/Button.svelte';
	import Modal from '$lib/components/primitives/Modal.svelte';
	import AccountForm from '$lib/components/forms/AccountForm.svelte';
	import ConfirmDialog from '$lib/components/primitives/ConfirmDialog.svelte';
	import { accounts } from '$lib/stores/accounts.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { formatCurrency } from '$lib/utils/currency';
	import type { AccountWithBalance, AccountType } from '$lib/db/repos/accounts';
	import * as m from '$lib/paraglide/messages';
	import { mapError } from '$lib/utils/errors';

	let showForm = $state(false);
	let editing = $state<AccountWithBalance | null>(null);
	let confirmDelete = $state<AccountWithBalance | null>(null);

	onMount(() => accounts.load());

	function accountTypeLabel(type: AccountType): string {
		switch (type) {
			case 'checking': return m.forms_account_type_checking();
			case 'savings': return m.forms_account_type_savings();
			case 'cash': return m.forms_account_type_cash();
			case 'credit_card': return m.forms_account_type_credit_card();
			case 'loan_to_person': return m.forms_account_type_loan_to_person();
			case 'loan_from_person': return m.forms_account_type_loan_from_person();
			default: return type;
		}
	}

	function openCreate() { editing = null; showForm = true; }
	function openEdit(a: AccountWithBalance) { editing = a; showForm = true; }

	async function archiveAccount(a: AccountWithBalance) {
		await accounts.update(a.id, { archived: a.archived ? 0 : 1 });
		toast.show(a.archived ? m.accounts_unarchived_toast() : m.accounts_archived_toast());
	}

	async function doDelete() {
		if (!confirmDelete) return;
		try {
			await accounts.delete(confirmDelete.id);
			toast.show(m.accounts_deleted_toast());
		} catch (e) {
			toast.show(mapError(e));
		}
		confirmDelete = null;
	}
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="figures text-xl text-ledger tracking-wide">{m.accounts_title()}</h1>
		<Button size="sm" onclick={openCreate}>{m.accounts_add()}</Button>
	</div>

	<section>
		<h2 class="plate mb-2">{m.accounts_assets()}</h2>
		{#if accounts.assets.length === 0}
			<div class="bg-tape rounded-lg border border-line p-6 text-center text-dim">
				<p class="text-sm">{m.accounts_empty_assets()}</p>
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
						<div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
							<button onclick={() => openEdit(acc)} class="text-xs text-dim hover:text-phosphor px-2">{m.common_edit()}</button>
							<button onclick={() => archiveAccount(acc)} class="text-xs text-dim hover:text-phosphor px-2">{m.accounts_archive()}</button>
							<button onclick={() => confirmDelete = acc} class="text-xs text-dim hover:text-debit px-2">{m.common_delete()}</button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<section>
		<h2 class="plate mb-2">{m.accounts_liabilities()}</h2>
		{#if accounts.liabilities.length === 0}
			<div class="bg-tape rounded-lg border border-line p-6 text-center text-dim">
				<p class="text-sm">{m.accounts_empty_liabilities()}</p>
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
						<div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
							<button onclick={() => openEdit(acc)} class="text-xs text-dim hover:text-phosphor px-2">{m.common_edit()}</button>
							<button onclick={() => confirmDelete = acc} class="text-xs text-dim hover:text-debit px-2">{m.common_delete()}</button>
						</div>
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
</div>

<Modal bind:open={showForm} title={editing ? m.accounts_edit_modal() : m.accounts_add_modal()}>
	<AccountForm account={editing} onclose={() => showForm = false} />
</Modal>

<ConfirmDialog
	open={confirmDelete !== null}
	title={m.accounts_delete_confirm_title()}
	message={m.accounts_delete_confirm_body()}
	confirmLabel={m.common_delete()}
	onconfirm={doDelete}
/>
