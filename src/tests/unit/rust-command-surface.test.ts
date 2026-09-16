/**
 * Self-tests for the Rust command-surface parser.
 *
 * The parser is the only thing standing between this repo and a fourth
 * instance of the scan failures recorded in the fix-phase spec §8 — three
 * separate scans returned an empty or wrong set and were read as a fact about
 * the code. So the parser is tested against those exact shapes: a comment
 * header that swallows the following entry, and malformed input that must
 * throw rather than degrade to an empty set.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
	camelCase,
	expectedArgKeys,
	loadCommandSurface,
	parseRegisteredCommands,
} from './helpers/rust-command-surface';

function tempLibRs(body: string): string {
	const dir = mkdtempSync(join(tmpdir(), 'notchy-lib-rs-'));
	const path = join(dir, 'lib.rs');
	writeFileSync(path, body);
	return path;
}

describe('camelCase', () => {
	it('projects the snake_case params the IPC layer receives', () => {
		expect(camelCase('account_id')).toBe('accountId');
		expect(camelCase('month_a')).toBe('monthA');
		expect(camelCase('include_adjustments')).toBe('includeAdjustments');
		expect(camelCase('id')).toBe('id');
	});

	it('strips the leading underscore Rust uses to mark an unused binding', () => {
		expect(camelCase('_bucket_id')).toBe('bucketId');
	});
});

describe('parseRegisteredCommands', () => {
	it('does not let a comment header swallow the entry that follows it', () => {
		// The §8 bug: splitting on commas before stripping comments made each
		// `// Account commands` header absorb the next command.
		const path = tempLibRs(`
			.invoke_handler(tauri::generate_handler![
				quit_app,
				// Account commands
				account_list,
				account_get,
				// Transaction commands
				transaction_list,
			])
		`);
		expect(parseRegisteredCommands(path)).toEqual([
			'quit_app',
			'account_list',
			'account_get',
			'transaction_list',
		]);
	});

	it('throws when the file has no generate_handler! block', () => {
		const path = tempLibRs('fn main() {}');
		expect(() => parseRegisteredCommands(path)).toThrow(/generate_handler/);
	});

	it('throws on an unbalanced bracket rather than returning what it found', () => {
		const path = tempLibRs('.invoke_handler(tauri::generate_handler![a, b,');
		expect(() => parseRegisteredCommands(path)).toThrow(/unbalanced/);
	});

	it('throws on an empty handler list', () => {
		const path = tempLibRs('.invoke_handler(tauri::generate_handler![])');
		expect(() => parseRegisteredCommands(path)).toThrow(/empty/);
	});
});

describe('loadCommandSurface on the real tree', () => {
	const surface = loadCommandSurface();

	it('finds the registered commands and a signature for every one', () => {
		expect(surface.registered.length).toBeGreaterThan(50);
		for (const name of surface.registered) {
			expect(surface.commands.has(name)).toBe(true);
		}
	});

	it('projects account_get_balance_as_of to the camelCase the client sends', () => {
		expect(expectedArgKeys(surface, 'account_get_balance_as_of')).toEqual([
			'accountId',
			'date',
		]);
	});

	it('excludes Tauri-injected params that never cross the IPC argument map', () => {
		const params = expectedArgKeys(surface, 'account_delete');
		expect(params).toEqual(['id']);
	});

	it('throws for a command that is not registered', () => {
		expect(() => expectedArgKeys(surface, 'not_a_real_command')).toThrow(/unknown command/);
	});
});
