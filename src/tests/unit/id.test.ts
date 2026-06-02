import { describe, it, expect } from 'vitest';
import { ulid } from '$lib/utils/id';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

describe('ulid', () => {
	it('returns a 26-character string', () => {
		const result = ulid();
		expect(result).toHaveLength(26);
	});

	it('uses only Crockford Base32 characters', () => {
		const result = ulid();
		for (const ch of result) {
			expect(CROCKFORD).toContain(ch);
		}
	});

	it('produces different values on successive calls', () => {
		const a = ulid();
		const b = ulid();
		expect(a).not.toBe(b);
	});

	it('produces the same 10-char time prefix for the same timestamp', () => {
		const now = 1_700_000_000_000;
		const a = ulid(now);
		const b = ulid(now);
		expect(a.slice(0, 10)).toBe(b.slice(0, 10));
	});

	it('produces lexicographically larger prefixes for later timestamps', () => {
		const earlier = ulid(1_700_000_000_000);
		const later = ulid(1_700_000_001_000);
		expect(later.slice(0, 10) > earlier.slice(0, 10)).toBe(true);
	});
});
