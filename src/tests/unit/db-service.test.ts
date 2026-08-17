import { describe, it, expect } from 'vitest';
import { uniqueSavepointName } from '$lib/db';

// Two Tauri webview windows are separate JS contexts, but tauri-plugin-sql
// routes them to ONE pooled connection per DB path. The old code used a
// module-level `savepointCounter` that reset to 0 in every JS context, so two
// windows would both emit sp_1, sp_2, … on the shared connection. These tests
// pin the cheap, always-correct guard: savepoint names must be globally unique
// per call (defense in depth on top of the real fix — only the main window owns
// DB lifecycle, see src/routes/quick-add/+page.svelte).

describe('uniqueSavepointName', () => {
	it('is not the old per-context counter (sp_1)', () => {
		expect(uniqueSavepointName()).not.toBe('sp_1');
	});

	it('produces unique names across many calls', () => {
		const names = new Set(Array.from({ length: 200 }, () => uniqueSavepointName()));
		expect(names.size).toBe(200);
	});

	it('is a valid SQLite identifier (sp_ prefix + alphanumerics)', () => {
		expect(uniqueSavepointName()).toMatch(/^sp_[0-9a-f]{12}$/);
	});
});
