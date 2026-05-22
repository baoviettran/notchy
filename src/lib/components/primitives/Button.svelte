<script lang="ts">
	import type { Snippet } from 'svelte';
	let { variant = 'primary', size = 'md', disabled = false, onclick, children, type = 'button' }: {
		variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
		size?: 'sm' | 'md';
		disabled?: boolean;
		onclick?: () => void;
		children: Snippet;
		type?: 'button' | 'submit';
	} = $props();

	const base = 'inline-flex items-center justify-center font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
	const sizes = { sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2 text-sm' };
	const variants = {
		primary: 'bg-emerald-600 text-white hover:bg-emerald-700',
		secondary: 'border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700',
		danger: 'bg-red-500 text-white hover:bg-red-600',
		ghost: 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
	};
</script>

<button {type} {disabled} {onclick} class="{base} {sizes[size]} {variants[variant]}">
	{@render children()}
</button>
