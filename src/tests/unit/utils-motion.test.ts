import { describe, expect, it } from 'vitest';
import { savePauseMs } from '$lib/utils/motion';

describe('savePauseMs', () => {
	it('keeps the 400ms flash beat by default', () => {
		expect(savePauseMs(false)).toBe(400);
	});

	it('returns 0 under reduced motion', () => {
		expect(savePauseMs(true)).toBe(0);
	});
});
