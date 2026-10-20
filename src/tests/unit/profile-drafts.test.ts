import { describe, expect, it, vi } from 'vitest';
import { registerDraft, resolveDrafts, markDraftChanged, cancelDraftTransition, prepareDraftAck, isDraftsFrozen } from '$lib/profiles/drafts.svelte';

const session = { profileId: 'A', generation: 'g1' };

describe('profile draft barrier', () => {
	it('keeps a dirty form intact when the user cancels', async () => {
		const discard = vi.fn();
		const unregister = registerDraft('form-1', () => true, discard);
		expect(await resolveDrafts('cancel')).toBe(false);
		expect(discard).not.toHaveBeenCalled();
		unregister();
	});
	it('discards only when the draft has not changed while resolving', async () => {
		const discard = vi.fn();
		let dirty = true;
		const unregister = registerDraft('form-2', () => dirty, () => { dirty = false; discard(); });
		const pending = resolveDrafts('discard');
		markDraftChanged('form-2');
		expect(await pending).toBe(false);
		expect(discard).not.toHaveBeenCalled();
		expect(await resolveDrafts('discard')).toBe(true);
		expect(discard).toHaveBeenCalledOnce();
		unregister();
	});
	it('freezes acknowledged inputs until cancellation releases them', async () => {
		const unregister = registerDraft('form-3', () => false, vi.fn());
		expect(await prepareDraftAck(session, 'discard')).toBe(true);
		expect(isDraftsFrozen()).toBe(true);
		cancelDraftTransition();
		expect(isDraftsFrozen()).toBe(false);
		unregister();
	});
});
