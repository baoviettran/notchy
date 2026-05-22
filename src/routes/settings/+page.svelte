<script lang="ts">
	import Button from '$lib/components/primitives/Button.svelte';
	import { settings } from '$lib/stores/settings.svelte';

	function setTheme(theme: 'auto' | 'light' | 'dark') {
		settings.setTheme(theme);
	}
</script>

<div class="space-y-6">
	<h1 class="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Settings</h1>

	<div class="space-y-3">
		<a href="/settings/categories" class="block bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 hover:bg-zinc-50 dark:hover:bg-zinc-750 transition-colors">
			<div class="font-medium text-zinc-900 dark:text-zinc-50">Categories</div>
			<div class="text-sm text-zinc-500">Manage buckets and tags</div>
		</a>
		<a href="/settings/backup" class="block bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 hover:bg-zinc-50 dark:hover:bg-zinc-750 transition-colors">
			<div class="font-medium text-zinc-900 dark:text-zinc-50">Backup & Data</div>
			<div class="text-sm text-zinc-500">Export, import, and manage backups</div>
		</a>
		<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
			<div class="font-medium text-zinc-900 dark:text-zinc-50 mb-2">Theme</div>
			<div class="flex gap-2">
				{#each ['auto', 'light', 'dark'] as theme}
					<button
						onclick={() => setTheme(theme as any)}
						class="px-3 py-1.5 text-sm rounded-md border transition-colors capitalize {settings.theme === theme ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700' : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400'}"
					>{theme}</button>
				{/each}
			</div>
		</div>
		<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
			<div class="font-medium text-zinc-900 dark:text-zinc-50 mb-1">Language</div>
			<div class="flex gap-2">
				<button
					onclick={() => settings.setLocale('en')}
					class="px-3 py-1.5 text-sm rounded-md border transition-colors {settings.locale === 'en' ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700' : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400'}"
				>English</button>
				<button
					onclick={() => settings.setLocale('vi')}
					class="px-3 py-1.5 text-sm rounded-md border transition-colors {settings.locale === 'vi' ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700' : 'border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400'}"
				>Tiếng Việt</button>
			</div>
		</div>
		<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4">
			<div class="text-xs text-zinc-400">Notchy v0.1.0</div>
		</div>
	</div>
</div>
