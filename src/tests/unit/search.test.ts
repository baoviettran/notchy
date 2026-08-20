import { describe, it, expect } from 'vitest';
import { transactionsSearchUrl } from '../../lib/utils/search';

describe('transactionsSearchUrl', () => {
	it('returns the plain route for an empty or blank query', () => {
		expect(transactionsSearchUrl('')).toBe('/transactions');
		expect(transactionsSearchUrl('   ')).toBe('/transactions');
	});

	it('encodes the query as the q param', () => {
		expect(transactionsSearchUrl('groceries')).toBe('/transactions?q=groceries');
	});

	it('encodes special characters', () => {
		expect(transactionsSearchUrl('coffee & tea')).toBe('/transactions?q=coffee%20%26%20tea');
	});
});
