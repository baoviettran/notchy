<script lang="ts">
	let { onMenuToggle = () => {} }: { onMenuToggle?: () => void } = $props();
</script>

<header class="h-14 flex items-center px-4 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-800 shrink-0">
	<button class="md:hidden mr-3 p-1 text-zinc-600 dark:text-zinc-400" onclick={onMenuToggle} aria-label="Menu">☰</button>
	<span class="text-lg font-semibold text-zinc-900 dark:text-zinc-50 md:hidden">Notchy</span>
	<div class="flex-1"></div>
	<div class="hidden md:block flex-1 max-w-md mx-auto">
		<input
			type="search"
			placeholder="Search..."
			class="w-full px-3 py-1.5 text-sm rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-50 focus:outline-none focus:ring-2 focus:ring-emerald-500"
		/>
	</div>
	<div class="flex items-center gap-2">
		<button class="md:hidden p-1 text-zinc-600 dark:text-zinc-400" aria-label="Search">🔍</button>
		<button class="px-2 py-1 text-xs font-medium rounded border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400">EN</button>
	</div>
</header>
