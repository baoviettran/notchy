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

	const base = 'inline-flex items-center justify-center font-medium rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
	const sizes = { sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2 text-sm' };
	const variants = {
		primary: 'bg-phosphor text-ink hover:bg-phosphor-bright',
		secondary: 'border border-line bg-tape text-ledger hover:border-dim',
		danger: 'bg-debit text-ledger hover:brightness-110',
		ghost: 'text-dim hover:text-ledger hover:bg-line/40'
	};
</script>

<button {type} {disabled} {onclick} class="{base} {sizes[size]} {variants[variant]}">
	{@render children()}
</button>
