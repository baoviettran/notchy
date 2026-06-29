<script lang="ts">
	import Button from '$lib/components/primitives/Button.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import * as m from '$lib/paraglide/messages';

	const themeLabels = {
		auto: () => m.settings_theme_auto(),
		light: () => m.settings_theme_light(),
		dark: () => m.settings_theme_dark()
	} as const;

	function setTheme(theme: 'auto' | 'light' | 'dark') {
		settings.setTheme(theme);
	}
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
						class="px-3 py-1.5 text-sm rounded-md border transition-colors capitalize {settings.theme === theme ? 'border-phosphor bg-phosphor/15 text-phosphor' : 'border-line text-dim'}"
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
			<div class="text-xs text-dim">{m.settings_version()}</div>
		</div>
	</div>
</div>
