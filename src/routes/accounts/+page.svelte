<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '$lib/components/primitives/Button.svelte';
	import Modal from '$lib/components/primitives/Modal.svelte';
	import ConfirmDialog from '$lib/components/primitives/ConfirmDialog.svelte';
	import AccountForm from '$lib/components/forms/AccountForm.svelte';
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
		await accounts.delete(confirmDelete.id);
		toast.show('Account deleted.');
		confirmDelete = null;
	}
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Accounts</h1>
		<Button size="sm" onclick={openCreate}>+ Add account</Button>
	</div>

	<section>
		<h2 class="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-2">Assets</h2>
		{#if accounts.assets.length === 0}
			<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-6 text-center text-zinc-400">
				<p class="text-sm">No asset accounts.</p>
			</div>
		{:else}
			<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-100 dark:divide-zinc-700">
				{#each accounts.assets as acc}
					<div class="flex items-center justify-between p-4 group">
						<a href="/accounts/{acc.id}" class="flex-1">
							<div class="text-sm font-medium text-zinc-900 dark:text-zinc-50">{acc.name}</div>
							<div class="text-xs text-zinc-500">{acc.type}{acc.counterparty ? ` · ${acc.counterparty}` : ''}</div>
						</a>
						<span class="text-sm tabular-nums text-zinc-900 dark:text-zinc-50 mr-3">{formatCurrency(acc.balance, settings.currency, settings.locale)}</span>
						<div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
							<button onclick={() => openEdit(acc)} class="text-xs text-zinc-500 hover:text-emerald-600 px-2">Edit</button>
							<button onclick={() => archiveAccount(acc)} class="text-xs text-zinc-500 hover:text-amber-600 px-2">Archive</button>
							<button onclick={() => confirmDelete = acc} class="text-xs text-zinc-500 hover:text-red-500 px-2">Delete</button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	<section>
		<h2 class="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-2">Liabilities</h2>
		{#if accounts.liabilities.length === 0}
			<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-6 text-center text-zinc-400">
				<p class="text-sm">No liability accounts.</p>
			</div>
		{:else}
			<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-100 dark:divide-zinc-700">
				{#each accounts.liabilities as acc}
					<div class="flex items-center justify-between p-4 group">
						<a href="/accounts/{acc.id}" class="flex-1">
							<div class="text-sm font-medium text-zinc-900 dark:text-zinc-50">{acc.name}</div>
							<div class="text-xs text-zinc-500">{acc.type}{acc.counterparty ? ` · ${acc.counterparty}` : ''}</div>
						</a>
						<span class="text-sm tabular-nums text-red-500 mr-3">{formatCurrency(Math.abs(acc.balance), settings.currency, settings.locale)}</span>
						<div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
							<button onclick={() => openEdit(acc)} class="text-xs text-zinc-500 hover:text-emerald-600 px-2">Edit</button>
							<button onclick={() => confirmDelete = acc} class="text-xs text-zinc-500 hover:text-red-500 px-2">Delete</button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>

	{#if accounts.archived.length > 0}
		<section>
			<h2 class="text-sm font-medium text-zinc-500 dark:text-zinc-400 mb-2">Archived</h2>
			<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 divide-y divide-zinc-100 dark:divide-zinc-700">
				{#each accounts.archived as acc}
					<div class="flex items-center justify-between p-4">
						<div class="flex-1">
							<div class="text-sm text-zinc-500">{acc.name}</div>
						</div>
						<button onclick={() => archiveAccount(acc)} class="text-xs text-emerald-600 hover:underline">Unarchive</button>
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
