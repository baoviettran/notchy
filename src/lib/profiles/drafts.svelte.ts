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
	const resolved = await resolveDrafts(choice);
	if (!resolved || (choice !== 'discard' && revision !== before)) return false;
	acknowledgedSession = session;
	frozen = true;
	return true;
}

export function matchesAcknowledgedSession(session: ProfileSession | null): boolean {
	return !!acknowledgedSession === !!session && (!session || (acknowledgedSession?.profileId === session.profileId && acknowledgedSession.generation === session.generation));
}

export function cancelDraftTransition(): void {
	frozen = false;
	acknowledgedSession = null;
}
