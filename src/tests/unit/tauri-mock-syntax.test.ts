import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The Tauri IPC mock is injected as a JS template literal (injectTauriMock in
 * src/tests/e2e/fixtures/tauri-mock.ts). Template literals silently DROP the
 * backslash on unrecognized escapes: `\'` resolves to `'`, not `\'`. Inside the
 * mock's single-quoted SQL strings that terminates the string early and turns
 * the WHOLE init script into a parse error in the browser — so __TAURI_INTERNALS__
 * is never installed and every E2E spec silently falls back to the browser
 * database. This test re-resolves the template exactly as the module load does
 * and asserts the result parses as valid JavaScript.
 */
describe('tauri-mock init script', () => {
	it('resolved template parses as valid JavaScript', () => {
		const src = readFileSync('src/tests/e2e/fixtures/tauri-mock.ts', 'utf8');
		const open = src.indexOf('await page.addInitScript(`');
		expect(open).toBeGreaterThanOrEqual(0);
		const start = src.indexOf('`', open) + 1;
		const end = src.indexOf('\n\t`);', start);
		expect(end).toBeGreaterThan(start);

		// Neutralize the ${...} interpolations (base64 payloads — contain no escapes).
		let raw = src.slice(start, end).replace(/\$\{[^}]*\}/g, 'X');
		// Resolve the template with Node's own template-literal semantics.
		const resolved = (0, eval)('`' + raw + '`');
		// Playwright evals the resolved text in-page; it must be valid JS.
		expect(() => new Function(resolved)).not.toThrow();
	});
});
