<script lang="ts">
	import { onMount } from 'svelte';
	import { emit } from '@tauri-apps/api/event';
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import * as m from '$lib/paraglide/messages';
	import { dbStore } from '$lib/stores/db.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { getDb, isTauri } from '$lib/db';
	import { listAccounts } from '$lib/db/repos/accounts';
	import { getDefaultQuickAccount } from '$lib/db/repos/quick_account';
	import { createTransaction } from '$lib/db/repos/transactions';
	import { parseQuickInput } from '$lib/utils/quick_parse';
	import { AppError } from '$lib/errors';

	let value = $state('');
	let error = $state<string | null>(null);
	let activeAccount = $state<{ id: string; name: string } | null>(null);
	let ready = $state(false);
	let submitting = $state(false);

	const accountName = $derived(activeAccount?.name ?? '');

	async function loadDefaultAccount(): Promise<void> {
		const db = await getDb();
		const id = await getDefaultQuickAccount(db);
		const accounts = await listAccounts(db);
		const chosen = (id && accounts.find((a) => a.id === id)) || accounts[0];
		activeAccount = chosen ? { id: chosen.id, name: chosen.name } : null;
	}

	onMount(async () => {
		await dbStore.init();
		if (dbStore.ready) await settings.load();
		await loadDefaultAccount();
		ready = true;
		queueMicrotask(() => document.getElementById('qa-input')?.focus());
	});

	async function hideWindow(): Promise<void> {
		if (isTauri()) await getCurrentWindow().hide();
	}

	async function submit(): Promise<void> {
		// Guard against rapid Enter re-entering submit and re-parsing an
		// already-cleared value.
		if (submitting) return;
		submitting = true;
		try {
			error = null;
			if (!activeAccount) {
				error = m.quick_add_no_account();
				return;
			}
			const db = await getDb();
			let parsed;
			try {
				parsed = parseQuickInput(value, settings.locale, settings.currency);
			} catch (e) {
				error = e instanceof AppError ? m.quick_add_placeholder() : m.errors_unknown();
				return;
			}

			await createTransaction(db, {
				kind: parsed.kind,
				date: new Date().toISOString().slice(0, 10),
				amount: parsed.amount,
				account_id: activeAccount.id,
				payee: parsed.payee,
				description: null,
				tag_id: null
			});

			// Only emit when running inside Tauri — Playwright/web has no event bus,
			// and emit() there throws. The E2E suite (Task 9) exercises the real
			// save path against sql.js and re-reads /transactions on mount instead.
			if (isTauri()) {
				await emit('transaction:saved', { accountId: activeAccount.id });
			}

			value = '';
			await hideWindow();
		} finally {
			submitting = false;
		}
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			hideWindow();
		}
		if (e.key === 'Enter') {
			e.preventDefault();
			submit();
		}
	}
</script>

<div class="tape">
	<header class="top">
		<span class="mark">▮</span>
		<span class="esc">ESC</span>
	</header>

	<input
		id="qa-input"
		class="amount"
		type="text"
		autocomplete="off"
		spellcheck="false"
		placeholder={m.quick_add_placeholder()}
		bind:value
		onkeydown={onKeydown}
		disabled={!ready || !activeAccount}
	/>

	<div class="rule"></div>

	<div class="payee" class:empty={!value}>
		{value ? value : m.quick_add_payee_hint()}
	</div>

	<footer class="status">
		<span>{accountName} · {m.quick_add_today()}</span>
		<span>{m.quick_add_save()} ⏎</span>
	</footer>

	{#if error}
		<div class="error">{error}</div>
	{/if}
</div>

<style>
	.tape {
		background: var(--tape);
		color: var(--ledger);
		height: 100vh;
		display: flex;
		flex-direction: column;
		padding: 0.75rem 1rem;
		box-sizing: border-box;
		font-family: 'IBM Plex Mono', monospace;
	}
	.top {
		display: flex;
		justify-content: space-between;
		color: var(--dim);
		font-size: 11px;
	}
	.mark {
		color: var(--phosphor);
	}
	.amount {
		background: transparent;
		border: none;
		outline: none;
		color: var(--phosphor-bright);
		font-family: 'IBM Plex Mono', monospace;
		font-size: 30px;
		margin-top: 0.4rem;
		width: 100%;
	}
	.amount::placeholder {
		color: var(--dim);
	}
	.rule {
		height: 1px;
		background: var(--line);
		opacity: 0.6;
		margin: 0.5rem 0;
	}
	.payee {
		color: var(--ledger);
		font-size: 15px;
		min-height: 1.2em;
	}
	.payee.empty {
		color: var(--dim);
	}
	.status {
		margin-top: auto;
		display: flex;
		justify-content: space-between;
		color: var(--dim);
		font-family: 'IBM Plex Mono', monospace;
		font-size: 11px;
		text-transform: uppercase;
	}
	.error {
		color: var(--phosphor);
		font-size: 11px;
		margin-top: 0.25rem;
	}
</style>
