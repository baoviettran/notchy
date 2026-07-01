<script lang="ts">
	import { onMount } from 'svelte';
	import { emit } from '@tauri-apps/api/event';
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import * as m from '$lib/paraglide/messages';
	import { dbStore } from '$lib/stores/db.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { getDb } from '$lib/db';
	import { listAccounts } from '$lib/db/repos/accounts';
	import { getDefaultQuickAccount } from '$lib/db/repos/quick_account';
	import { createTransaction } from '$lib/db/repos/transactions';
	import { parseQuickInput } from '$lib/utils/quick_parse';
	import { AppError } from '$lib/errors';

	let value = $state('');
	let error = $state<string | null>(null);
	let accountName = $state('');
	let ready = $state(false);

	function isTauri(): boolean {
		return (
			typeof window !== 'undefined' &&
			!!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
		);
	}

	async function loadDefaultAccount(): Promise<void> {
		const db = await getDb();
		const id = await getDefaultQuickAccount(db);
		const accounts = await listAccounts(db);
		const chosen = (id && accounts.find((a) => a.id === id)) || accounts[0];
		accountName = chosen?.name ?? '';
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
		error = null;
		const db = await getDb();
		let parsed;
		try {
			parsed = parseQuickInput(value, settings.locale, settings.currency);
		} catch (e) {
			error = e instanceof AppError ? m.quick_add_placeholder() : 'Error';
			return;
		}

		const id = await getDefaultQuickAccount(db);
		const accounts = await listAccounts(db);
		const account = (id && accounts.find((a) => a.id === id)) || accounts[0];
		if (!account) {
			error = 'No account';
			return;
		}

		await createTransaction(db, {
			kind: parsed.kind,
			date: new Date().toISOString().slice(0, 10),
			amount: parsed.amount,
			account_id: account.id,
			payee: parsed.payee,
			description: null,
			tag_id: null
		});

		// Only emit when running inside Tauri — Playwright/web has no event bus,
		// and emit() there throws. Task 9 (E2E) intercepts createTransaction.
		if (isTauri()) {
			await emit('transaction:saved', { accountId: account.id });
		}

		value = '';
		await hideWindow();
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
		disabled={!ready}
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
