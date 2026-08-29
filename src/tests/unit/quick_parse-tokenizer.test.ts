/**
 * parseQuickInput tokenizer must NOT expand k/m/tr.
 *
 * CLAUDE.md gotcha: `parseAmount` already expands k/m/tr and is locale-aware
 * (number_parse.ts) — the quick-capture TOKENIZER must not. The tokenizer's
 * only job is to split "50k coffee" into the numeric token "50k" and the payee
 * "coffee", then hand the raw suffix-bearing token to parseAmount, which owns
 * expansion. If the tokenizer independently expanded (or stripped the suffix),
 * it either double-multiplies or corrupts the unit and the payee.
 *
 * This test spies on the module binding parseQuickInput uses: it mocks
 * number_parse's parseAmount to RECORD the exact token received. The assertion
 * locks the raw token reaching parseAmount — the precise "must not expand"
 * contract. A tokenizer that pre-expanded "50k" to "50000" (or dropped the k)
 * would change the recorded argument and fail.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const parseCalls: string[] = [];
vi.mock('$lib/utils/number_parse', () => ({
	parseAmount: (input: string) => {
		parseCalls.push(input);
		return 999; // sentinel; this test only inspects the received token
	},
}));

// Import AFTER the mock is registered so quick_parse binds the mocked parseAmount.
import { parseQuickInput } from '$lib/utils/quick_parse';

describe('parseQuickInput tokenizer does not expand k/m/tr', () => {
	beforeEach(() => {
		parseCalls.length = 0;
	});

	it('hands the raw k token to parseAmount (no pre-expansion, no suffix strip)', () => {
		parseQuickInput('50k coffee', 'vi');
		expect(parseCalls).toEqual(['50k']);
	});

	it('hands the raw tr token to parseAmount under vi', () => {
		parseQuickInput('1.5tr lương', 'vi');
		expect(parseCalls).toEqual(['1.5tr']);
	});

	it('hands the raw m token to parseAmount under en', () => {
		parseQuickInput('1.2m rent', 'en');
		expect(parseCalls).toEqual(['1.2m']);
	});

	it('strips a leading + before delegating but keeps the suffix', () => {
		parseQuickInput('+50k salary', 'vi');
		expect(parseCalls).toEqual(['50k']);
	});

	it('delegates a bare amount with no suffix unchanged', () => {
		parseQuickInput('5000', 'vi');
		expect(parseCalls).toEqual(['5000']);
	});
});