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
	import type { AccountWithBalance } from '$lib/db/repos/accounts';

	let showForm = $state(false);
	let editing = $state<AccountWithBalance | null>(null);
	let confirmDelete = $state<AccountWithBalance | null>(null);

	onMount(() => accounts.load());

	function openCreate() { editing = null; showForm = true; }
	function openEdit(a: AccountWithBalance) { editing = a; showForm = true; }

	async function archiveAccount(a: AccountWithBalance) {
		await accounts.update(a.id, { archived: a.archived ? 0 : 1 });
		toast.show(a.archived ? 'Account unarchived.' : 'Account archived.');
	}

	async function doDelete() {
		if (!confirmDelete) return;
		try {
			await accounts.delete(confirmDelete.id);
			toast.show('Account deleted.');
		} catch (e) {
			toast.show(String(e).replace('Error: ', ''));
		}
		confirmDelete = null;
	}
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="figures text-xl text-ledger tracking-wide">Accounts</h1>
		<Button size="sm" onclick={openCreate}>+ Add account</Button>
	</div>

	<section>
		<h2 class="plate mb-2">Assets</h2>
		{#if accounts.assets.length === 0}
			<div class="bg-tape rounded-lg border border-line p-6 text-center text-dim">
				<p class="text-sm">No asset accounts.</p>
			</div>
		{:else}
			<div class="bg-tape rounded-lg border border-line divide-y divide-line">
				{#each accounts.assets as acc}
					<div class="flex items-center justify-between p-4 group">
						<a href="/accounts/{acc.id}" class="flex-1">
							<div class="text-sm font-medium text-ledger">{acc.name}</div>
							<div class="text-xs text-dim">{acc.type}{acc.counterparty ? ` · ${acc.counterparty}` : ''}</div>
						</a>
						<span class="figures text-sm text-ledger mr-3">{formatCurrency(acc.balance, settings.currency, settings.locale)}</span>
						<div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
							<button onclick={() => openEdit(acc)} class="text-xs text-dim hover:text-phosphor px-2">Edit</button>
							<button onclick={() => archiveAccount(acc)} class="text-xs text-dim hover:text-phosphor px-2">Archive</button>
							<button onclick={() => confirmDelete = acc} class="text-xs text-dim hover:text-debit px-2">Delete</button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<section>
		<h2 class="plate mb-2">Liabilities</h2>
		{#if accounts.liabilities.length === 0}
			<div class="bg-tape rounded-lg border border-line p-6 text-center text-dim">
				<p class="text-sm">No liability accounts.</p>
			</div>
		{:else}
			<div class="bg-tape rounded-lg border border-line divide-y divide-line">
				{#each accounts.liabilities as acc}
					<div class="flex items-center justify-between p-4 group">
						<a href="/accounts/{acc.id}" class="flex-1">
							<div class="text-sm font-medium text-ledger">{acc.name}</div>
							<div class="text-xs text-dim">{acc.type}{acc.counterparty ? ` · ${acc.counterparty}` : ''}</div>
						</a>
						<span class="figures text-sm text-debit mr-3">{formatCurrency(Math.abs(acc.balance), settings.currency, settings.locale)}</span>
						<div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
							<button onclick={() => openEdit(acc)} class="text-xs text-dim hover:text-phosphor px-2">Edit</button>
							<button onclick={() => confirmDelete = acc} class="text-xs text-dim hover:text-debit px-2">Delete</button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	{#if accounts.archived.length > 0}
		<section>
			<h2 class="plate mb-2">Archived</h2>
			<div class="bg-tape rounded-lg border border-line divide-y divide-line">
				{#each accounts.archived as acc}
					<div class="flex items-center justify-between p-4">
						<div class="flex-1">
							<div class="text-sm text-dim">{acc.name}</div>
						</div>
						<button onclick={() => archiveAccount(acc)} class="text-xs text-phosphor hover:underline">Unarchive</button>
					</div>
				{/each}
			</div>
		</section>
	{/if}
</div>

<Modal bind:open={showForm} title={editing ? 'Edit account' : 'Add account'}>
	<AccountForm account={editing} onclose={() => showForm = false} />
</Modal>

<ConfirmDialog
	open={confirmDelete !== null}
	title="Delete account?"
	message="This will hide the account from active lists. You can restore it from a backup if needed."
	confirmLabel="Delete"
	onconfirm={doDelete}
/>
