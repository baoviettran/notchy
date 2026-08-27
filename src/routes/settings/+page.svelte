<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import Select from '$lib/components/primitives/Select.svelte';
	import Button from '$lib/components/primitives/Button.svelte';
	import Skeleton from '$lib/components/primitives/Skeleton.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { tour } from '$lib/stores/tour.svelte';
	import { getDb } from '$lib/db';
	import type { AccountWithBalance } from '$lib/db/client';
	import * as m from '$lib/paraglide/messages';

	const themeLabels = {
		auto: () => m.settings_theme_auto(),
		light: () => m.settings_theme_light(),
		dark: () => m.settings_theme_dark()
	} as const;

	function setTheme(theme: 'auto' | 'light' | 'dark') {
		settings.setTheme(theme);
	}

	async function setLocale(locale: 'en' | 'vi') {
		await settings.setLocale(locale);
	}

	let quickAccountId = $state<string>('');
	let accounts = $state<AccountWithBalance[]>([]);
	let quickAccountLoaded = $state(false);
	let quickAccountError = $state<string | null>(null);

	const quickAccountOptions = $derived([
		{ value: '', label: m.settings_quick_account_none() },
		...accounts.map((a) => ({ value: a.id, label: a.name }))
	]);

	let lastPersisted = '';
	async function loadQuickAccount() {
		quickAccountError = null;
		try {
			const db = getDb();
			accounts = await db.accounts.list();
			const loaded = (await db.meta.getDefaultQuickAccount()) ?? '';
			quickAccountId = loaded;
			lastPersisted = loaded; // suppress redundant write for the seed value
			quickAccountLoaded = true;
		} catch {
			quickAccountLoaded = false;
			quickAccountError = m.errors_unknown();
		}
	}

	// Persist when the user changes the selection. Skips the seed value (set in
	// loadQuickAccount). The empty "None" option clears the meta key so the
	// accounts[0] fallback takes effect downstream.
	$effect(() => {
		if (!quickAccountLoaded) return;
		const id = quickAccountId;
		if (id === lastPersisted) return;
		void persistQuickAccount(id);
	});

	async function persistQuickAccount(id: string): Promise<void> {
		try {
			const db = getDb();
			if (id === '') {
				await db.meta.clearDefaultQuickAccount();
			} else {
				await db.meta.setDefaultQuickAccount(id);
			}
			// Mark as persisted only after the write succeeds, so a failed write
			// is retried on the next change rather than silently dropped.
			lastPersisted = id;
			quickAccountError = null;
		} catch (e) {
			console.error('Failed to persist quick account', e);
			quickAccountError = m.errors_unknown();
		}
	}

	async function replayTour() {
		if ($page.url.pathname !== '/') {
			await goto('/');
		}
		tour.start({ force: true });
	}

	onMount(loadQuickAccount);
</script>

<div class="space-y-6">
	<h1 class="page-title">{m.settings_title()}</h1>

	<div class="space-y-3">
		<a href="/settings/categories" class="block surface rounded-lg p-4 hover:bg-line/30 transition-colors">
			<div class="font-medium text-ledger">{m.settings_categories()}</div>
			<div class="text-sm text-dim">{m.settings_categories_desc()}</div>
		</a>
		<a href="/settings/backup" class="block surface rounded-lg p-4 hover:bg-line/30 transition-colors">
			<div class="font-medium text-ledger">{m.settings_backup()}</div>
			<div class="text-sm text-dim">{m.settings_backup_desc()}</div>
		</a>
		<div class="surface rounded-lg p-4">
			<div class="plate mb-2">{m.settings_theme()}</div>
			<div class="flex gap-2" role="radiogroup" aria-label={m.settings_theme()}>
				{#each ['auto', 'light', 'dark'] as theme}
					<button
						onclick={() => setTheme(theme as 'auto' | 'light' | 'dark')}
						role="radio"
						aria-checked={settings.theme === theme}
						class="px-3 py-2.5 text-sm rounded-md border transition-colors {settings.theme === theme ? 'border-phosphor bg-phosphor/15 text-phosphor' : 'border-line text-dim'}"
					>{themeLabels[theme as keyof typeof themeLabels]()}</button>
				{/each}
			</div>
		</div>
		<div class="surface rounded-lg p-4">
			<div class="plate mb-2">{m.settings_language()}</div>
			<div class="flex gap-2" role="radiogroup" aria-label={m.settings_language()}>
				<button
					onclick={() => setLocale('en')}
					role="radio"
					aria-checked={settings.locale === 'en'}
					class="px-3 py-2.5 text-sm rounded-md border transition-colors {settings.locale === 'en' ? 'border-phosphor bg-phosphor/15 text-phosphor' : 'border-line text-dim'}"
				>{m.lang_english()}</button>
				<button
					onclick={() => setLocale('vi')}
					role="radio"
					aria-checked={settings.locale === 'vi'}
					class="px-3 py-2.5 text-sm rounded-md border transition-colors {settings.locale === 'vi' ? 'border-phosphor bg-phosphor/15 text-phosphor' : 'border-line text-dim'}"
				>{m.lang_vietnamese()}</button>
			</div>
		</div>
		<div class="surface rounded-lg p-4">
			<div class="plate mb-1">{m.settings_quick_account()}</div>
			<div class="text-sm text-dim mb-3">{m.settings_quick_account_desc()}</div>
			{#if !quickAccountLoaded && !quickAccountError}
				<Skeleton lines={1} />
			{:else}
				<Select
					label={m.settings_quick_account()}
					bind:value={quickAccountId}
					options={quickAccountOptions}
					disabled={!quickAccountLoaded}
				/>
			{/if}
			{#if quickAccountError}
				<div class="flex items-center gap-2 text-xs text-debit mt-2">
					<span>{quickAccountError}</span>
					<button onclick={loadQuickAccount} class="text-dim hover:text-ledger transition-colors underline">{m.common_retry()}</button>
				</div>
			{/if}
		</div>
		<div class="surface rounded-lg p-4">
			<div class="font-medium text-ledger">{m.tour_replay()}</div>
			<div class="text-sm text-dim mb-3">{m.tour_replay_desc()}</div>
			<Button size="sm" onclick={replayTour}>{m.tour_replay()}</Button>
		</div>
		<div class="surface rounded-lg p-4">
			<div class="text-xs text-dim">{m.settings_version()}</div>
		</div>
	</div>
</div>
