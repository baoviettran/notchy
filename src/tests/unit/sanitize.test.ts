import { expect, it } from 'vitest';
import corpus from '../../../src-tauri/tests/fixtures/control-chars.json';
import { stripControlChars } from '$lib/utils/sanitize';

it('strips C0, DEL, and C1, and preserves newline, carriage return, and tab', () => {
	for (const testCase of corpus.cases) {
		expect(
			stripControlChars(testCase.input),
			`input ${JSON.stringify(testCase.input)}`
		).toBe(testCase.expected);
	}
});
