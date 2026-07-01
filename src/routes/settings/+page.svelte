<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '$lib/components/primitives/Button.svelte';
	import Select from '$lib/components/primitives/Select.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { getDb } from '$lib/db';
	import { getDefaultQuickAccount, setDefaultQuickAccount, clearDefaultQuickAccount } from '$lib/db/repos/quick_account';
	import { listAccounts, type AccountWithBalance } from '$lib/db/repos/accounts';
	import * as m from '$lib/paraglide/messages';

	const themeLabels = {
		auto: () => m.settings_theme_auto(),
		light: () => m.settings_theme_light(),
		dark: () => m.settings_theme_dark()
	} as const;

	function setTheme(theme: 'auto' | 'light' | 'dark') {
		settings.setTheme(theme);
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
		const db = await getDb();
		accounts = await listAccounts(db);
		const loaded = (await getDefaultQuickAccount(db)) ?? '';
		quickAccountId = loaded;
		lastPersisted = loaded; // suppress redundant write for the seed value
		quickAccountLoaded = true;
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
			const db = await getDb();
			if (id === '') {
				await clearDefaultQuickAccount(db);
			} else {
				await setDefaultQuickAccount(db, id);
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

	onMount(loadQuickAccount);
</script>

<div class="space-y-6">
	<h1 class="figures text-xl text-ledger tracking-wide">{m.settings_title()}</h1>

	<div class="space-y-3">
		<a href="/settings/categories" class="block bg-tape rounded-lg border border-line p-4 hover:bg-line/30 transition-colors">
			<div class="font-medium text-ledger">{m.settings_categories()}</div>
			<div class="text-sm text-dim">{m.settings_categories_desc()}</div>
		</a>
		<a href="/settings/backup" class="block bg-tape rounded-lg border border-line p-4 hover:bg-line/30 transition-colors">
			<div class="font-medium text-ledger">{m.settings_backup()}</div>
			<div class="text-sm text-dim">{m.settings_backup_desc()}</div>
		</a>
		<div class="bg-tape rounded-lg border border-line p-4">
			<div class="plate mb-2">{m.settings_theme()}</div>
			<div class="flex gap-2">
				{#each ['auto', 'light', 'dark'] as theme}
					<button
						onclick={() => setTheme(theme as any)}
						class="px-3 py-1.5 text-sm rounded-md border transition-colors {settings.theme === theme ? 'border-phosphor bg-phosphor/15 text-phosphor' : 'border-line text-dim'}"
					>{themeLabels[theme as keyof typeof themeLabels]()}</button>
				{/each}
			</div>
		</div>
		<div class="bg-tape rounded-lg border border-line p-4">
			<div class="plate mb-1">{m.settings_language()}</div>
			<div class="flex gap-2">
				<button
					onclick={() => settings.setLocale('en')}
					class="px-3 py-1.5 text-sm rounded-md border transition-colors {settings.locale === 'en' ? 'border-phosphor bg-phosphor/15 text-phosphor' : 'border-line text-dim'}"
				>{m.lang_english()}</button>
				<button
					onclick={() => settings.setLocale('vi')}
					class="px-3 py-1.5 text-sm rounded-md border transition-colors {settings.locale === 'vi' ? 'border-phosphor bg-phosphor/15 text-phosphor' : 'border-line text-dim'}"
				>{m.lang_vietnamese()}</button>
			</div>
		</div>
		<div class="bg-tape rounded-lg border border-line p-4">
			<div class="plate mb-1">{m.settings_quick_account()}</div>
			<div class="text-sm text-dim mb-3">{m.settings_quick_account_desc()}</div>
			<Select
				bind:value={quickAccountId}
				options={quickAccountOptions}
				disabled={!quickAccountLoaded}
			/>
			{#if quickAccountError}
				<div class="text-xs text-phosphor mt-2">{quickAccountError}</div>
			{/if}
		</div>
		<div class="bg-tape rounded-lg border border-line p-4">
			<div class="text-xs text-dim">{m.settings_version()}</div>
		</div>
	</div>
</div>
