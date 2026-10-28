<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import { emit } from '@tauri-apps/api/event';
	import { getCurrentWindow } from '@tauri-apps/api/window';
	import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
	import { goto } from '$app/navigation';
	import * as m from '$lib/paraglide/messages';
	import { settings } from '$lib/stores/settings.svelte';
	import { getDb, isTauri } from '$lib/db';
	import { profiles } from '$lib/stores/profiles.svelte';
	import { registerDraft, markDraftChanged, isDraftsFrozen } from '$lib/profiles/drafts.svelte';
	import { installProfileWindowListeners, type DraftChoice } from '$lib/profiles/windows';
	import { startAutomaticBackupChecks } from '$lib/backup/automatic';
	import type { ProfileSession } from '$lib/profiles/types';
	import { parseQuickInput } from '$lib/utils/quick_parse';
	import { formatCurrency, formatCurrencyCompact } from '$lib/utils/currency';
	import { AppError } from '$lib/errors';
	import { mapError } from '$lib/utils/errors';
	import { savePauseMs } from '$lib/utils/motion';

	let value = $state('');
	let error = $state<string | null>(null);
	let profileName = $state('');
	let activeAccount = $state<{ id: string; name: string; balance: number } | null>(null);
	let allAccounts = $state<{ id: string; name: string; balance: number }[]>([]);
	let ready = $state(false);
	let submitting = $state(false);
	let justSaved = $state(false);
	let unlistenFocus: (() => void) | undefined;
	let unlistenProfiles: (() => void) | undefined;
	let unregisterDraft: (() => void) | undefined;
	let loadedSession = $state<ProfileSession | null>(null);
	let noProfile = $state(false);
	let pendingChoice = $state<((choice: DraftChoice) => void) | null>(null);

	const accountName = $derived(activeAccount?.name ?? '');
	const accountBalance = $derived(activeAccount?.balance ?? 0);

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
		allAccounts = accounts.map((a) => ({ id: a.id, name: a.name, balance: a.balance }));
		const chosen = (id && accounts.find((a) => a.id === id)) || accounts[0];
		activeAccount = chosen ? { id: chosen.id, name: chosen.name, balance: chosen.balance } : null;
	}

	function cycleAccount(): void {
		if (allAccounts.length < 2) return;
		const idx = allAccounts.findIndex((a) => a.id === activeAccount?.id);
		const next = allAccounts[(idx + 1) % allAccounts.length];
		activeAccount = next;
	}

	async function loadQuickState(): Promise<void> {
		try {
			// Every webview binds its own adapter to the current native session.
			const snapshot = await profiles.load();
			const active = snapshot.active;
			// Onboarding may finish in main without advancing the profile session.
			// Refresh this webview's profile settings on every focus.
			if (active) await settings.loadProfileSettings();
			profileName = snapshot.profiles.find((profile) => profile.id === active?.profileId)?.name ?? '';
			if (!active || !settings.firstRunComplete) {
				noProfile = true; ready = false; activeAccount = null; allAccounts = [];
				loadedSession = active; error = null; return;
			}
			noProfile = false;
			if (loadedSession && (loadedSession.profileId !== active.profileId || loadedSession.generation !== active.generation)) {
				value = ''; markDraftChanged('quick-add');
			}
			loadedSession = active;
			await loadDefaultAccount();
			error = null;
			ready = true;
			await tick();
			document.getElementById('qa-input')?.focus();
		} catch (e) {
			ready = false;
			error = updateRequiredError(e) ?? mapError(e);
		}
	}

	onMount(async () => {
		unregisterDraft = registerDraft('quick-add', () => !!value.trim(), () => { value = ''; });
		// Register before loading: the hidden window can mount while Rust is
		// still starting. A later focus must retry even if the first load failed.
		if (isTauri()) {
			const win = getCurrentWindow();
			unlistenFocus = await win.onFocusChanged(({ payload: focused }) => {
				if (focused) void loadQuickState();
			});
		}
		await loadQuickState();
		if (isTauri()) {
			unlistenProfiles = await installProfileWindowListeners({
				currentSession: () => profiles.snapshot?.active ?? null,
				choose: async () => {
					const win = getCurrentWindow();
					await win.show(); await win.setFocus();
					return new Promise<DraftChoice>((resolve) => { pendingChoice = resolve; });
				},
				onSessionChanged: () => { value = ''; activeAccount = null; ready = false; markDraftChanged('quick-add'); void loadQuickState(); },
				onTransitionCanceled: () => answerChoice('cancel')
			});
		}
	});

	$effect(() => {
		if (!ready || !loadedSession) return;
		return startAutomaticBackupChecks(getDb(), () => profiles.snapshot?.active ?? null);
	});

	onDestroy(() => { unlistenFocus?.(); unlistenProfiles?.(); unregisterDraft?.(); });

	function answerChoice(choice: DraftChoice): void {
		const resolve = pendingChoice; pendingChoice = null; resolve?.(choice);
	}

	async function openMain(): Promise<void> {
		if (isTauri()) { const main = await WebviewWindow.getByLabel('main'); await main?.show(); await main?.setFocus(); }
		else await goto('/');
	}


	async function hideWindow(): Promise<void> {
		if (isTauri()) await getCurrentWindow().hide();
	}

	async function submit(): Promise<void> {
		// Guard against rapid Enter re-entering submit and re-parsing an
		// already-cleared value.
		if (submitting || !ready || isDraftsFrozen() || pendingChoice) return;
		submitting = true;
		try {
			error = null;
			if (!activeAccount) {
				error = m.quick_add_no_account();
				return;
			}
			const saveSession = profiles.snapshot?.active ?? null;
			if (!saveSession || !settings.firstRunComplete) { noProfile = true; ready = false; return; }
			if (!loadedSession || loadedSession.profileId !== saveSession.profileId || loadedSession.generation !== saveSession.generation) {
				ready = false;
				await loadQuickState();
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
				await emit('transaction:saved', { accountId: activeAccount.id, session: saveSession });
			}

			value = ''; markDraftChanged('quick-add');
			// The machine registers the keypress: one phosphor flicker before the
			// window hides, so a save never vanishes unacknowledged.
			justSaved = true;
			const pause = savePauseMs(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
			if (pause > 0) await new Promise((r) => setTimeout(r, pause));
			justSaved = false;
			await hideWindow();
		} catch (e) {
			error = mapError(e);
		} finally {
			submitting = false;
		}
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			if (pendingChoice) answerChoice('stay'); else hideWindow();
		}
		if (e.key === 'Enter') {
			e.preventDefault();
			if (!pendingChoice) submit();
		}
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<svelte:window onkeydown={onKeydown} />

<div class="tape" class:disabled={!ready || !activeAccount}>
	<header class="top">
		<span class="mark" class:animate-flash={justSaved} aria-hidden="true">▮</span>
		<span class="profile-name" title={profileName}>{profileName}</span>
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
		oninput={() => markDraftChanged('quick-add')}
		disabled={!ready || !activeAccount || isDraftsFrozen() || !!pendingChoice}
	/>

	{#if noProfile}
		<div class="hint" aria-live="polite">{m.quick_add_open_main_hint()} <button type="button" onclick={openMain}>{m.quick_add_open_main()}</button></div>
	{/if}
	{#if pendingChoice}
		<div class="hint" role="alertdialog" aria-label={m.quick_add_unsaved_draft()}>
			<span>{m.quick_add_unsaved_draft()}</span>
			<button type="button" onclick={() => answerChoice('stay')}>{m.quick_add_stay()}</button>
			<button type="button" onclick={() => answerChoice('discard')}>{m.quick_add_discard()}</button>
		</div>
	{/if}
	{#if noAccountHint && !noProfile}
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
		<button
			type="button"
			onclick={cycleAccount}
			disabled={allAccounts.length < 2 || isDraftsFrozen() || !!pendingChoice}
			class="account-switch"
			aria-label={m.quick_add_switch_account()}
		>{accountName}{#if activeAccount} · {formatCurrencyCompact(accountBalance, settings.currency, settings.locale)}{/if}{#if allAccounts.length > 1} ▾{/if}</button>
		<span>· {m.quick_add_today()}</span>
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
	.profile-name {
		max-width: 70%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.amount {
		@apply text-3xl;
		background: transparent;
		border: none;
		outline: none;
		color: var(--phosphor-bright);
		font-family: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
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
		@apply text-base;
		color: var(--ledger);
		min-height: 1.2em;
		display: flex;
		align-items: baseline;
		gap: 0.35em;
	}
	.payee.empty {
		color: var(--dim);
	}
	.preview-kind {
		@apply text-lg font-semibold;
		color: var(--debit);
		font-family: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
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
		align-items: center;
		color: var(--dim);
		font-family: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.18em; /* engraved-faceplate tracking, matching .plate */
	}
	.account-switch {
		background: none;
		border: 1px solid var(--line);
		color: var(--dim);
		font-family: inherit;
		font-size: inherit;
		letter-spacing: inherit;
		text-transform: inherit;
		padding: 0.15em 0.5em;
		border-radius: 6px; /* rounded-md: tight chip for adding-machine status bar */
		cursor: pointer;
		transition: color 150ms, border-color 150ms, background 150ms;
	}
	.account-switch:not(:disabled):hover {
		color: var(--ledger);
		border-color: var(--dim);
		background: var(--line);
	}
	.account-switch:disabled {
		cursor: default;
		border-color: transparent;
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
