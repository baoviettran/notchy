import { describe, it, expect, beforeEach } from 'vitest';
import { SessionStore } from '$lib/stores/session.svelte';

let store: InstanceType<typeof SessionStore>;

beforeEach(() => {
	store = new SessionStore();
});

describe('SessionStore', () => {
	it('starts with null lastUsedAccountId', () => {
		expect(store.lastUsedAccountId).toBeNull();
	});

	it('starts with null lastEnteredDate', () => {
		expect(store.lastEnteredDate).toBeNull();
	});

	it('starts with empty undoStack', () => {
		expect(store.undoStack).toHaveLength(0);
	});

	it('pushUndo adds an entry with expires timestamp', () => {
		const before = Date.now();
		store.pushUndo({ id: '1', description: 'Delete transaction', undo: async () => {} });
		const after = Date.now();

		expect(store.undoStack).toHaveLength(1);
		expect(store.undoStack[0].id).toBe('1');
		expect(store.undoStack[0].description).toBe('Delete transaction');
		expect(store.undoStack[0].expires).toBeGreaterThanOrEqual(before + 5000);
		expect(store.undoStack[0].expires).toBeLessThanOrEqual(after + 5000);
	});

	it('pushUndo replaces the stack (only one undo at a time)', () => {
		store.pushUndo({ id: '1', description: 'First', undo: async () => {} });
		store.pushUndo({ id: '2', description: 'Second', undo: async () => {} });

		expect(store.undoStack).toHaveLength(1);
		expect(store.undoStack[0].id).toBe('2');
	});

	it('popUndo returns the entry and clears the stack', () => {
		store.pushUndo({ id: '1', description: 'Test', undo: async () => {} });
		const entry = store.popUndo();

		expect(entry).not.toBeNull();
		expect(entry!.id).toBe('1');
		expect(store.undoStack).toHaveLength(0);
	});

	it('popUndo returns null when stack is empty', () => {
		const entry = store.popUndo();
		expect(entry).toBeNull();
	});

	it('undo callback is stored but not called by push/pop', async () => {
		let called = false;
		const undo = async () => { called = true; };
		store.pushUndo({ id: '1', description: 'Test', undo });
		store.popUndo();
		expect(called).toBe(false);
	});
});
