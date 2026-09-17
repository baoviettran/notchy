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
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
	camelCase,
	expectedArgKeys,
	invokeSites,
	loadCommandSurface,
	parseCommandSignatures,
	parseRegisteredCommands,
	unusedCommandParams,
} from './helpers/rust-command-surface';

function tempLibRs(body: string): string {
	const dir = mkdtempSync(join(tmpdir(), 'notchy-lib-rs-'));
	const path = join(dir, 'lib.rs');
	writeFileSync(path, body);
	return path;
}

/**
 * A throwaway repo root, keyed by repo-relative path. The failure modes below
 * are properties of the tree (`src-tauri/src/lib.rs` missing, no signatures
 * under it), so they need a directory, not a single file.
 */
function tempTree(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), 'notchy-tree-'));
	for (const [rel, body] of Object.entries(files)) {
		const path = join(root, rel);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, body);
	}
	return root;
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
		// Anchored to the block guard's own message: a bare /generate_handler/
		// also matches the downstream "has no argument list" throw, so it would
		// pass even with this guard removed.
		expect(() => parseRegisteredCommands(path)).toThrow(/no generate_handler! block/);
	});

	it('throws on an unbalanced bracket rather than returning what it found', () => {
		const path = tempLibRs('.invoke_handler(tauri::generate_handler![a, b,');
		expect(() => parseRegisteredCommands(path)).toThrow(/unbalanced/);
	});

	it('throws on an empty handler list', () => {
		const path = tempLibRs('.invoke_handler(tauri::generate_handler![])');
		expect(() => parseRegisteredCommands(path)).toThrow(/empty/);
	});

	it('throws when generate_handler! has no argument list at all', () => {
		const path = tempLibRs('.invoke_handler(tauri::generate_handler!)');
		expect(() => parseRegisteredCommands(path)).toThrow(/no argument list/);
	});

	it('throws on a path-qualified entry rather than reading it as a name', () => {
		// `commands::account_list` is a plausible edit that would otherwise be
		// returned verbatim and then compared against the client's op names.
		const path = tempLibRs(
			'.invoke_handler(tauri::generate_handler![commands::account_list])'
		);
		expect(() => parseRegisteredCommands(path)).toThrow(/unparsable entries/);
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

/** A `lib.rs` that registers exactly the names it is given. */
function libRsRegistering(...names: string[]): string {
	return `.invoke_handler(tauri::generate_handler![\n\t${names.join(',\n\t')},\n])\n`;
}

const DECLARES_ACCOUNT_LIST = `
#[tauri::command]
pub async fn account_list() -> Result<(), String> {
	Ok(())
}
`;

describe('loadCommandSurface cross-checks', () => {
	it('throws when a registered command has no #[tauri::command] signature', () => {
		// The §8 shape: `lib.rs` names a command the tree cannot resolve. Without
		// this throw the surface would silently under-report and read as fact.
		const root = tempTree({
			'src-tauri/src/lib.rs': libRsRegistering('account_list', 'ghost_command'),
			'src-tauri/src/commands.rs': DECLARES_ACCOUNT_LIST,
		});
		expect(() => loadCommandSurface(root)).toThrow(
			/registered but no #\[tauri::command\] signature found: ghost_command/
		);
	});

	it('throws naming every missing command, not just the first', () => {
		const root = tempTree({
			'src-tauri/src/lib.rs': libRsRegistering('ghost_one', 'account_list', 'ghost_two'),
			'src-tauri/src/commands.rs': DECLARES_ACCOUNT_LIST,
		});
		expect(() => loadCommandSurface(root)).toThrow(/ghost_one, ghost_two/);
	});

	it('keeps an unregistered #[tauri::command] in the map so orphans stay visible', () => {
		// The cross-check runs one way: it fails closed on a registered name with
		// no signature. A signature that is never registered cannot be invoked —
		// it is not a parse failure, so nothing throws here. The command must stay
		// in the map (rather than being filtered to the registered set) for a
		// caller to be able to detect it at all.
		const root = tempTree({
			'src-tauri/src/lib.rs': libRsRegistering('account_list'),
			'src-tauri/src/commands.rs': `${DECLARES_ACCOUNT_LIST}
#[tauri::command]
pub async fn orphan_command(id: String) -> Result<(), String> {
	Ok(())
}
`,
		});
		const surface = loadCommandSurface(root);
		expect(surface.registered).toEqual(['account_list']);
		expect([...surface.commands.keys()].sort()).toEqual([
			'account_list',
			'orphan_command',
		]);
	});

	it('throws when lib.rs is missing under the repo root', () => {
		const root = tempTree({ 'src-tauri/src/commands.rs': DECLARES_ACCOUNT_LIST });
		expect(() => loadCommandSurface(root)).toThrow(/lib\.rs not found/);
	});
});

describe('parseCommandSignatures failure modes', () => {
	it('throws when the tree declares no #[tauri::command] signatures', () => {
		const root = tempTree({ 'src-tauri/src/helpers.rs': 'pub fn plain() {}\n' });
		expect(() => parseCommandSignatures(join(root, 'src-tauri/src'))).toThrow(
			/no #\[tauri::command\] signatures found/
		);
	});

	it('throws when src-tauri/src does not exist', () => {
		const root = tempTree({ 'README.md': 'no rust in this tree\n' });
		expect(() => parseCommandSignatures(join(root, 'src-tauri/src'))).toThrow(
			/Rust source directory not found/
		);
	});

	it('throws on a duplicate #[tauri::command] signature for the same name', () => {
		// Two matches for one name means the surface map is ambiguous: whichever
		// file is read last would win silently.
		const duplicate = `
#[tauri::command]
pub async fn dup_command(id: String) -> Result<(), String> {
	Ok(())
}
`;
		const root = tempTree({
			'src-tauri/src/first.rs': duplicate,
			'src-tauri/src/nested/second.rs': duplicate,
		});
		expect(() => parseCommandSignatures(join(root, 'src-tauri/src'))).toThrow(
			/duplicate #\[tauri::command\] signature for dup_command/
		);
	});

	it('throws on a parameter declaration with no type', () => {
		const root = tempTree({
			'src-tauri/src/commands.rs': `
#[tauri::command]
pub fn broken(id_string) -> Result<(), String> {
	Ok(())
}
`,
		});
		expect(() => parseCommandSignatures(join(root, 'src-tauri/src'))).toThrow(
			/unparsable parameter declaration: id_string/
		);
	});
});

/**
 * The rule that closes I1's blind spot. `camelCase()` strips the leading
 * underscore by design, so the wire-key check cannot see that `_bucket_id` is
 * an unused binding. These run over synthetic source — a test that only asserts
 * "the real tree is clean" cannot show the rule has any signal.
 */
describe('unusedCommandParams', () => {
	it('flags a declared parameter that the command body never references', () => {
		const source = `
#[tauri::command]
pub async fn report_get_trend(
	state: State<'_, Arc<DatabaseManager>>,
	months: u32,
	_bucket_id: Option<String>,
) -> Result<Vec<TrendPoint>, DbError> {
	let conn = state.connection()?;
	domains::reports::get_trend(conn, months, false)
}
`;
		const offenders = unusedCommandParams(source);
		expect(offenders).toEqual([{ command: 'report_get_trend', param: '_bucket_id' }]);
	});

	it('does not flag a parameter the body references', () => {
		const source = `
#[tauri::command]
pub async fn report_get_trend(
	state: State<'_, Arc<DatabaseManager>>,
	months: u32,
	bucket_id: Option<String>,
) -> Result<Vec<TrendPoint>, DbError> {
	let conn = state.connection()?;
	domains::reports::get_trend(conn, months, false, bucket_id.as_deref())
}
`;
		expect(unusedCommandParams(source)).toEqual([]);
	});

	it('exempts a Tauri-injected parameter the body never names', () => {
		// `state` is supplied by the invocation context, so the client never sends
		// it and there is nothing to drop. It must stay exempt.
		const source = `
#[tauri::command]
pub async fn account_list(
	state: State<'_, Arc<DatabaseManager>>,
	window: WebviewWindow,
) -> Result<Vec<Account>, DbError> {
	Ok(Vec::new())
}
`;
		expect(unusedCommandParams(source)).toEqual([]);
	});

	it('searches the body through nested braces and closures', () => {
		// Braces are matched, not truncated at the first `}`: a body that closes a
		// block before the parameter's real use must not read as unused.
		const source = `
#[tauri::command]
pub async fn budget_set(
	state: State<'_, Arc<DatabaseManager>>,
	amount: i64,
) -> Result<(), DbError> {
	let conn = state.connection()?;
	if amount > 0 {
		conn.transaction(|tx| {
			tx.execute("UPDATE budget SET amount = ?", [amount])?;
			Ok(())
		})?;
	}
	Ok(())
}
`;
		expect(unusedCommandParams(source)).toEqual([]);
	});

	it('matches on the word boundary, so a longer identifier is not a use', () => {
		// `bucket_id` inside `bucket_id_cached` is a different name; `\b` is what
		// keeps a near-miss from reading as a reference.
		const source = `
#[tauri::command]
pub fn report_get_trend(
	months: u32,
	bucket_id: Option<String>,
) -> Result<(), DbError> {
	let span = months * 30;
	let bucket_id_cached = Some("month");
	Ok(())
}
`;
		expect(unusedCommandParams(source)).toEqual([
			{ command: 'report_get_trend', param: 'bucket_id' },
		]);
	});

	it('throws rather than reporting nothing when there is no command to check', () => {
		// The §8 shape: an empty scan reading as a passing assertion. A source with
		// no #[tauri::command] must never come back as "no offenders".
		expect(() => unusedCommandParams('pub fn plain() {}\n')).toThrow(
			/no #\[tauri::command\] signatures to check/
		);
	});

	it('finds no unused parameter in the real tree', () => {
		expect(unusedCommandParams(loadCommandSurface())).toEqual([]);
	});
});

describe('invokeSites', () => {
	it('reads the command literal from every call-site shape and skips prose', () => {
		const root = tempTree({
			'src/lib/a.ts': [
				"import { invoke } from '@tauri-apps/api/core';",
				"// invoke('database_restore');",
				'/**',
				' * Wraps Tauri invoke() calls — an empty argument list is prose.',
				' */',
				"export const one = () => invoke<number>('account_get_balance', { accountId });",
				'export const two = () => invoke(',
				"\t'database_status'",
				');',
			].join('\n'),
		});

		expect(invokeSites(root).map((site) => site.command)).toEqual([
			'account_get_balance',
			'database_status',
		]);
	});

	it('excludes the namespaced Tauri plugin and core APIs', () => {
		// `plugin:sql|execute` is registered by tauri-plugin-sql, not by this
		// app's generate_handler!, so it is neither a failure nor a command here.
		const root = tempTree({
			'src/lib/sql.ts': [
				"invoke('plugin:sql|execute', { db, query });",
				"invoke('core:event|listen', { event });",
				"invoke('quit_app');",
			].join('\n'),
		});

		expect(invokeSites(root).map((site) => site.command)).toEqual(['quit_app']);
	});

	it('does not scan src/tests, whose fixtures would grade the scan on itself', () => {
		const root = tempTree({
			'src/lib/a.ts': "invoke('quit_app');",
			'src/tests/unit/a.test.ts': "invoke('not_a_command');",
		});

		expect(invokeSites(root).map((site) => site.command)).toEqual(['quit_app']);
	});

	it('throws when a call site names its command with a variable, not a literal', () => {
		const root = tempTree({
			'src/lib/a.ts': 'export const run = (command: string) => invoke(command);',
		});

		expect(() => invokeSites(root)).toThrow(/not a string literal/);
	});

	it('throws when the walk finds no call site at all', () => {
		// The §8 shape again: an empty scan must not read as "nothing to check".
		const root = tempTree({ 'src/lib/a.ts': 'export const x = 1;\n' });

		expect(() => invokeSites(root)).toThrow(/no invoke\(\) call sites/);
	});
});
