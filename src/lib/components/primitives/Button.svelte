<script lang="ts">
	import type { Snippet } from 'svelte';
	let { variant = 'primary', size = 'md', disabled = false, onclick, children, type = 'button', ...rest }: {
		variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
		size?: 'sm' | 'md';
		disabled?: boolean;
		onclick?: () => void;
		children: Snippet;
		type?: 'button' | 'submit';
		[key: string]: unknown;
	} = $props();

	const base = 'inline-flex items-center justify-center font-medium rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-phosphor disabled:opacity-40 disabled:cursor-not-allowed';
	const sizes = {
		sm: 'min-h-9 pointer-coarse:min-h-11 px-3 text-sm',
		md: 'min-h-10 pointer-coarse:min-h-11 px-4 py-2 text-sm'
	};
	const variants = {
		primary: 'bg-phosphor text-ink hover:brightness-110',
		secondary: 'border border-dim bg-tape text-ledger hover:border-ledger',
		danger: 'bg-debit text-ink hover:brightness-110',
		ghost: 'text-dim hover:text-ledger hover:bg-line/40'
	};
</script>

<button {type} {disabled} {onclick} class="{base} {sizes[size]} {variants[variant]}" {...rest}>
	{@render children()}
</button>
