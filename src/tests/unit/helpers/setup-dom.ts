import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/svelte';
import { afterEach } from 'vitest';

// Ensure DOM is cleaned up between component tests
afterEach(() => {
	cleanup();
});
