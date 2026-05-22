<script lang="ts">
	import { page } from '$app/stores';

	const primaryNav = [
		{ href: '/', label: 'Dashboard', icon: '🏠' },
		{ href: '/transactions', label: 'Transactions', icon: '📋' },
		{ href: '/budgets', label: 'Budgets', icon: '💰' },
		{ href: '/reports', label: 'Reports', icon: '📊' }
	];
	const secondaryNav = [
		{ href: '/accounts', label: 'Accounts', icon: '🏦' },
		{ href: '/goals', label: 'Goals', icon: '🎯' },
		{ href: '/debts', label: 'Debts', icon: '🤝' },
		{ href: '/settings', label: 'Settings', icon: '⚙' }
	];
</script>

<aside class="hidden md:flex flex-col w-60 border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-800 h-full">
	<div class="p-4 text-lg font-semibold text-zinc-900 dark:text-zinc-50">Notchy</div>
	<nav class="flex-1 px-2 space-y-1">
		{#each primaryNav as item}
			<a
				href={item.href}
				class="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors
					{$page.url.pathname === item.href ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400 font-medium' : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700'}"
			>
				<span>{item.icon}</span>
				<span>{item.label}</span>
			</a>
		{/each}
		<div class="my-3 border-t border-zinc-200 dark:border-zinc-700"></div>
		{#each secondaryNav as item}
			<a
				href={item.href}
				class="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors
					{$page.url.pathname === item.href ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400 font-medium' : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700'}"
			>
				<span>{item.icon}</span>
				<span>{item.label}</span>
			</a>
		{/each}
	</nav>
</aside>
