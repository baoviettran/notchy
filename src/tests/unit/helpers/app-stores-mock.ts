// Mock for $app/stores used by BottomNav in component tests.
// The component workspace lacks the SvelteKit plugin, so $app/* imports
// must be aliased to this file via vitest.workspace.ts.
import { writable } from 'svelte/store';

export const page = writable({ url: { pathname: '/' } });
export const navigating = writable(null);
export const updated = { subscribe: writable(false).subscribe, check: async () => false };
