<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { emit } from '@tauri-apps/api/event';
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import * as m from '$lib/paraglide/messages';
	import { settings } from '$lib/stores/settings.svelte';
	import { getDb, initDb, isTauri } from '$lib/db';
	import { parseQuickInput } from '$lib/utils/quick_parse';
	import { formatCurrency } from '$lib/utils/currency';
	import { AppError } from '$lib/errors';
	import { mapError } from '$lib/utils/errors';

	let value = $state('');
	let error = $state<string | null>(null);
	let activeAccount = $state<{ id: string; name: string } | null>(null);
	let ready = $state(false);
	let submitting = $state(false);
	let justSaved = $state(false);
	let unlistenFocus: (() => void) | undefined;

	const accountName = $derived(activeAccount?.name ?? '');

	function updateRequiredError(e: unknown): string | null {
		return e instanceof AppError && e.code === 'database_update_required'
			? m.quick_add_database_update_required()
			: null;
	}

	// Only claim "no account" once the window is genuinely ready — during the
	// initial load, or after a db/locale error, it would contradict reality
	// (and, on a database_update_required rejection, stack against the error).
	// In web mode there is no tray window — show a softer hint instead.
	const noAccountHint = $derived.by(() => {
		if (!ready || activeAccount) return null;
		return isTauri() ? m.quick_add_no_account_hint() : m.quick_add_no_account_hint_web();
	});

	// Live parsed preview: show kind·amount·payee as the user types.
	const preview = $derived.by(() => {
		if (!value.trim()) return null;
		try {
			const parsed = parseQuickInput(value, settings.locale, settings.currency);
			const amount = formatCurrency(parsed.amount, settings.currency, settings.locale);
			const kind = parsed.kind === 'income' ? '+' : '−';
			return { kind, amount, payee: parsed.payee ?? '' };
		} catch {
			return null;
		}
	});

	async function loadDefaultAccount(): Promise<void> {
		const db = getDb();
		const id = await db.meta.getDefaultQuickAccount();
		const accounts = await db.accounts.list();
		const chosen = (id && accounts.find((a) => a.id === id)) || accounts[0];
		activeAccount = chosen ? { id: chosen.id, name: chosen.name } : null;
	}

	onMount(async () => {
		// quick-add must NOT run dbStore.init(): that re-runs migrations,
		// integrity checks, and runAutoBackup (VACUUM INTO — an exclusive lock)
		// from this window's JS context. The main window owns DB lifecycle.
		// tauri-plugin-sql pools one connection per DB path shared across all
		// webview windows, so getDb() here reuses the connection the main
		// window already initialized — no second boot, no lock contention.
		// Concurrent VACUUM from two windows was bricking writes
		// ("no such savepoint" after a 5s busy_timeout). While the main window
		// is still migrating an older schema, getDb() rejects with
		// `database_update_required` — show that explicitly instead of failing
		// silently.
		try {
			// The Tauri-only skip above means the quick-add window reuses the main
			// window's pooled connection. On the web there is no pool and no
			// second window — a fresh /quick-add navigation must initialize its
			// own sql.js database or getDb() throws "database not initialized".
			if (!isTauri()) await initDb();
			await getDb();
			await settings.load();
			await loadDefaultAccount();
			ready = true;
		} catch (e) {
			error = updateRequiredError(e) ?? mapError(e);
			return;
		}
		queueMicrotask(() => document.getElementById('qa-input')?.focus());

		// The quick-add window is shown/hidden (not destroyed) for the app's
		// lifetime, so onMount runs once. Re-resolve the default account each
		// time the window gains focus: the user may have changed the default
		// (or created the first account) in the main window since the last show.
		if (isTauri()) {
			const win = getCurrentWindow();
			unlistenFocus = await win.onFocusChanged(({ payload: focused }) => {
				if (focused) void loadDefaultAccount();
			});
		}
	});

	onDestroy(() => { unlistenFocus?.(); });

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
			let db;
			try {
				db = await getDb();
			} catch (e) {
				error = updateRequiredError(e) ?? mapError(e);
				return;
			}
			let parsed;
			try {
				parsed = parseQuickInput(value, settings.locale, settings.currency);
			} catch (e) {
				// A parse failure must say what's wrong, not echo the placeholder.
				error = e instanceof AppError ? m.validation_invalid_amount() : mapError(e);
				return;
			}

			await db.transactions.create({
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
			// The machine registers the keypress: one phosphor flicker before the
			// window hides, so a save never vanishes unacknowledged.
			justSaved = true;
			await new Promise((r) => setTimeout(r, 400));
			justSaved = false;
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

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<svelte:window onkeydown={onKeydown} />

<div class="tape" class:disabled={!ready || !activeAccount}>
	<header class="top">
		<span class="mark" class:animate-flash={justSaved} aria-hidden="true">▮</span>
		<span class="esc" role="img" aria-label="Escape key">ESC</span>
	</header>

	<input
		id="qa-input"
		class="amount"
		type="text"
		inputmode="decimal"
		autocomplete="off"
		spellcheck="false"
		placeholder={m.quick_add_placeholder()}
		aria-label={m.quick_add_placeholder()}
		bind:value
		disabled={!ready || !activeAccount}
	/>

	{#if noAccountHint}
		<div id="qa-hint" class="hint" aria-live="polite">{noAccountHint}</div>
	{/if}

	<div class="rule"></div>

	<div class="payee" class:empty={!value && !preview}>
		{#if preview}
			<span class="preview-kind" class:income={preview.kind === '+'}>{preview.kind}</span>
			<span class="preview-amount">{preview.amount}</span>
			{#if preview.payee}
				<span class="preview-payee">{preview.payee}</span>
			{/if}
		{:else}
			{m.quick_add_payee_hint()}
		{/if}
	</div>

	<footer class="status">
		<span>{accountName} · {m.quick_add_today()}</span>
		<span class:animate-flash={justSaved}>{m.quick_add_save()} ⏎</span>
	</footer>

	{#if error}
		<div class="error" aria-live="polite">{error}</div>
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
		font-family: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		transition: opacity 150ms ease-out;
	}
	.tape.disabled {
		opacity: 0.5;
		pointer-events: none;
	}
	.top {
		display: flex;
		justify-content: space-between;
		color: var(--dim);
		font-size: 11px;
		letter-spacing: 0.18em; /* engraved-faceplate tracking, matching .plate */
	}
	.mark {
		color: var(--phosphor);
	}
	.amount {
		background: transparent;
		border: none;
		outline: none;
		color: var(--phosphor-bright);
		font-family: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 30px;
		letter-spacing: -0.01em; /* same VFD digit spacing as .figures */
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
		font-size: 16px;
		min-height: 1.2em;
		display: flex;
		align-items: baseline;
		gap: 0.35em;
	}
	.payee.empty {
		color: var(--dim);
	}
	.preview-kind {
		color: var(--debit);
		font-family: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-weight: 600;
		font-size: 18px;
	}
	.preview-kind.income {
		color: var(--phosphor);
	}
	.preview-amount {
		color: var(--ledger);
		font-family: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
	}
	.preview-payee {
		color: var(--dim);
	}
	.status {
		margin-top: auto;
		display: flex;
		justify-content: space-between;
		color: var(--dim);
		font-family: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.18em; /* engraved-faceplate tracking, matching .plate */
	}
	/* Vietnamese: sentence-case the status bar and tighten tracking —
	   stacked diacritics smear under uppercase at 11px, and the wider
	   characters need less separation. */
	:global(html[lang='vi']) .status {
		text-transform: none;
		letter-spacing: 0.08em;
	}
	.error {
		color: var(--debit);
		font-size: 11px;
		margin-top: 0.25rem;
	}
	.hint {
		color: var(--dim);
		font-size: 11px;
		margin-top: 0.25rem;
	}
</style>
