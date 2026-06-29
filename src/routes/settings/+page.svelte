<script lang="ts">
	import Button from '$lib/components/primitives/Button.svelte';
	import { settings } from '$lib/stores/settings.svelte';

	function setTheme(theme: 'auto' | 'light' | 'dark') {
		settings.setTheme(theme);
	}
</script>

<div class="space-y-6">
	<h1 class="figures text-xl text-ledger tracking-wide">Settings</h1>

	<div class="space-y-3">
		<a href="/settings/categories" class="block bg-tape rounded-lg border border-line p-4 hover:bg-line/30 transition-colors">
			<div class="font-medium text-ledger">Categories</div>
			<div class="text-sm text-dim">Manage buckets and tags</div>
		</a>
		<a href="/settings/backup" class="block bg-tape rounded-lg border border-line p-4 hover:bg-line/30 transition-colors">
			<div class="font-medium text-ledger">Backup & Data</div>
			<div class="text-sm text-dim">Export, import, and manage backups</div>
		</a>
		<div class="bg-tape rounded-lg border border-line p-4">
			<div class="plate mb-2">Theme</div>
			<div class="flex gap-2">
				{#each ['auto', 'light', 'dark'] as theme}
					<button
						onclick={() => setTheme(theme as any)}
						class="px-3 py-1.5 text-sm rounded-md border transition-colors capitalize {settings.theme === theme ? 'border-phosphor bg-phosphor/15 text-phosphor' : 'border-line text-dim'}"
					>{theme}</button>
				{/each}
			</div>
		</div>
		<div class="bg-tape rounded-lg border border-line p-4">
			<div class="plate mb-1">Language</div>
			<div class="flex gap-2">
				<button
					onclick={() => settings.setLocale('en')}
					class="px-3 py-1.5 text-sm rounded-md border transition-colors {settings.locale === 'en' ? 'border-phosphor bg-phosphor/15 text-phosphor' : 'border-line text-dim'}"
				>English</button>
				<button
					onclick={() => settings.setLocale('vi')}
					class="px-3 py-1.5 text-sm rounded-md border transition-colors {settings.locale === 'vi' ? 'border-phosphor bg-phosphor/15 text-phosphor' : 'border-line text-dim'}"
				>Tiếng Việt</button>
			</div>
		</div>
		<div class="bg-tape rounded-lg border border-line p-4">
			<div class="text-xs text-dim">Notchy v0.1.0</div>
		</div>
	</div>
</div>
