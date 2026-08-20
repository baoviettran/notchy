// Mock for $app/navigation used by TopBar in component tests.
// The component workspace lacks the SvelteKit plugin, so $app/* imports
// must be aliased to this file via vitest.workspace.ts.
import { vi } from 'vitest';

export const goto = vi.fn();
export const invalidateAll = vi.fn();
export const invalidate = vi.fn();
export const prefetch = vi.fn();
export const prefetchData = vi.fn();
