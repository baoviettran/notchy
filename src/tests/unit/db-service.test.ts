import { describe, it, expect } from 'vitest';
import { uniqueSavepointName } from '$lib/db';
import { createTestDb } from './helpers/test-db';

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

describe('savepoint contention on a single pooled connection (no "no such savepoint")', () => {
	// The quick-add bug: a write arriving while another op holds a savepoint open
	// on the ONE pooled connection. With globally-unique savepoint names the
	// nested LIFO stack stays sound — the inner transaction RELEASE pops only its
	// own entry, never the outer's. With the old per-context counter (both `sp_1`)
	// the inner RELEASE consumes the outer's savepoint and the outer's later
	// RELEASE/ROLLBACK hits "no such savepoint".
	it('runs a second transaction while the first holds its savepoint open', async () => {
		const db = createTestDb();
		const order: string[] = [];

		const outer = db.transaction(async () => {
			await db.execute('CREATE TABLE t (id INTEGER PRIMARY KEY)');
			// Quick-add-style write while the outer savepoint is still on the stack.
			await db.transaction(async () => {
				await db.execute('INSERT INTO t (id) VALUES (1)');
				order.push('inner');
			});
			order.push('outer');
		});

		// If the savepoint names collided, this would reject with "no such savepoint".
		await expect(outer).resolves.not.toThrow();
		expect(order).toEqual(['inner', 'outer']);
		await db.close();
	});
});
