import type { ProfileSession } from './types';

type Draft = { isDirty: () => boolean; discard: () => void };
const drafts = new Map<string, Draft>();
const changeListeners = new Set<() => void>();
function notifyChange(): void { for (const listener of changeListeners) listener(); }
export function subscribeDraftChanges(listener: () => void): () => void {
	changeListeners.add(listener);
	return () => { changeListeners.delete(listener); };
}
let revision = 0;
let frozen = $state(false);
let acknowledgedSession: ProfileSession | null = null;

export function registerDraft(id: string, isDirty: () => boolean, discard: () => void): () => void {
	if (drafts.has(id)) throw new Error(`draft already registered: ${id}`);
	drafts.set(id, { isDirty, discard });
	revision++;
	notifyChange();
	return () => {
		if (drafts.delete(id)) { revision++; notifyChange(); }
	};
}

export function markDraftChanged(id: string): void {
	if (!drafts.has(id)) return;
	revision++;
	if (frozen) {
		frozen = false;
		acknowledgedSession = null;
	}
	notifyChange();
}

export function hasDirtyDrafts(): boolean {
	return [...drafts.values()].some((draft) => draft.isDirty());
}

export function isDraftsFrozen(): boolean { return frozen; }

export async function resolveDrafts(choice: 'stay' | 'discard' | 'cancel'): Promise<boolean> {
	if (choice !== 'discard') return !hasDirtyDrafts() && choice !== 'cancel';
	const before = revision;
	const dirty = [...drafts.values()].filter((draft) => draft.isDirty());
	await Promise.resolve();
	if (revision !== before) return false;
	for (const draft of dirty) draft.discard();
	revision++;
	return !hasDirtyDrafts();
}

export async function prepareDraftAck(session: ProfileSession | null, choice: 'stay' | 'discard' | 'cancel'): Promise<boolean> {
	const before = revision;
	await Promise.resolve();
	if (revision !== before || choice === 'cancel' || (choice === 'stay' && hasDirtyDrafts())) return false;
	acknowledgedSession = session;
	frozen = true;
	return true;
}

/** Discard only after the transition has committed in every participating window. */
export function commitDraftTransition(): void {
	if (!frozen) return;
	frozen = false;
	acknowledgedSession = null;
	const dirty = [...drafts.values()].filter((draft) => draft.isDirty());
	for (const draft of dirty) draft.discard();
	revision++;
	notifyChange();
}

export function matchesAcknowledgedSession(session: ProfileSession | null): boolean {
	return !!acknowledgedSession === !!session && (!session || (acknowledgedSession?.profileId === session.profileId && acknowledgedSession.generation === session.generation));
}

export function cancelDraftTransition(): void {
	frozen = false;
	acknowledgedSession = null;
}

/** A baseline follows a successful save, while persistence failures leave the draft dirty. */
export function createEditorDraft(id: string, snapshot: () => string, discard: () => void): {
	changed: () => void; saved: () => void; unregister: () => void; isDirty: () => boolean;
} {
	let baseline = snapshot();
	const isDirty = () => snapshot() !== baseline;
	const unregister = registerDraft(id, isDirty, discard);
	return {
		changed: () => markDraftChanged(id),
		saved: () => { baseline = snapshot(); markDraftChanged(id); },
		unregister, isDirty
	};
}

export function profileDraft(node: HTMLElement, options: {
	id: string; snapshot: () => string; discard: () => void;
	onReady?: (draft: ReturnType<typeof createEditorDraft> | null) => void;
}) {
	const draft = createEditorDraft(options.id, options.snapshot, options.discard);
	options.onReady?.(draft);
	const changed = () => draft.changed();
	node.addEventListener('input', changed, true);
	node.addEventListener('change', changed, true);
	node.addEventListener('click', changed, true);
	const syncFrozen = () => { node.inert = isDraftsFrozen(); };
	const unsubscribe = subscribeDraftChanges(syncFrozen);
	syncFrozen();
	return { destroy() {
		node.removeEventListener('input', changed, true);
		node.removeEventListener('change', changed, true);
		node.removeEventListener('click', changed, true);
		unsubscribe(); options.onReady?.(null); draft.unregister();
	} };
}
