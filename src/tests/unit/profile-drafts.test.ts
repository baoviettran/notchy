import { describe, expect, it, vi } from 'vitest';
import { createEditorDraft, registerDraft, resolveDrafts, markDraftChanged, cancelDraftTransition, prepareDraftAck, isDraftsFrozen } from '$lib/profiles/drafts.svelte';

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


describe('editor draft tracking', () => {
  it('blocks a transition only for changed input and retains it after a failed save', async () => {
    let value = '';
    const discard = vi.fn(() => { value = ''; });
    const draft = createEditorDraft('editor-failed-save', () => value, discard);
    expect(await resolveDrafts('stay')).toBe(true);
    value = '123'; draft.changed();
    expect(await resolveDrafts('stay')).toBe(false);
    expect(value).toBe('123');
    draft.unregister();
  });
  it('clears dirtiness after a successful save without discarding another editor', async () => {
    let first = ''; let second = '';
    const a = createEditorDraft('editor-save-a', () => first, () => { first = ''; });
    const b = createEditorDraft('editor-save-b', () => second, () => { second = ''; });
    first = 'saved'; a.changed(); second = 'unsaved'; b.changed();
    a.saved();
    expect(await resolveDrafts('stay')).toBe(false);
    await resolveDrafts('discard');
    expect(first).toBe('saved');
    expect(second).toBe('');
    a.unregister(); b.unregister();
  });
});
