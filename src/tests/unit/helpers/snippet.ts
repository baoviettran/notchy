import type { Snippet } from 'svelte';

/**
 * Coerce a plain string into a Svelte 5 Snippet for component tests.
 *
 * Svelte's `Snippet` type is branded and can only be created by the Svelte
 * compiler, so `.test.ts` files cannot construct one directly. Runtime accepts
 * a plain function returning a string; this helper just satisfies the types.
 */
export function snip(text: string): Snippet {
	return (() => text) as unknown as Snippet;
}
