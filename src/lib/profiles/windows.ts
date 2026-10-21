import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { assertCurrentSession } from './session';
import {
	cancelDraftTransition, commitDraftTransition, hasDirtyDrafts, prepareDraftAck, subscribeDraftChanges
} from './drafts.svelte';
import type { AppPreferences, ProfileSession } from './types';
import type { TransitionRequest } from '$lib/native/contracts.generated';

export type DraftChoice = 'stay' | 'discard' | 'cancel';
type ReadyEvent = { requestId: string; transitionToken: string };
type ChangedEvent = { session: ProfileSession | null };

/** Subscribe before announcing this webview as ready, so a pending request cannot be missed. */
export async function installProfileWindowListeners(options: {
	currentSession: () => ProfileSession | null;
	choose: (dirty: boolean) => Promise<DraftChoice>;
	onSessionChanged: (session: ProfileSession | null) => void;
	onTransitionCanceled?: () => void;
}): Promise<() => void> {
	let pending: string | null = null;
	const respond = async (request: TransitionRequest) => {
		if (pending === request.requestId) return;
		pending = request.requestId;
		try {
			const actual = options.currentSession();
			if (request.expectedSession || actual) assertCurrentSession(request.expectedSession!, actual);
			const dirty = hasDirtyDrafts();
			const choice = dirty ? await options.choose(true) : 'discard';
			if (pending !== request.requestId) return;
			const resolved = await prepareDraftAck(request.expectedSession, choice);
			if (pending !== request.requestId) { cancelDraftTransition(); return; }
			await invoke('profile_ack_transition', { requestId: request.requestId, dirty, resolved });
		} catch {
			await invoke('profile_ack_transition', { requestId: request.requestId, dirty: true, resolved: false }).catch(() => {});
		}
	};
	const unlistenPrepare = await listen<TransitionRequest>('profile:prepare-transition', ({ payload }) => { void respond(payload); });
	const unlistenCanceled = await listen<{ requestId: string }>('profile:transition-canceled', ({ payload }) => {
		if (pending === payload.requestId) { pending = null; cancelDraftTransition(); options.onTransitionCanceled?.(); }
	});
	const unlistenChanged = await listen<ChangedEvent>('profile:session-changed', ({ payload }) => {
		pending = null;
		commitDraftTransition();
		cancelDraftTransition();
		options.onSessionChanged(payload.session);
	});
	const unsubscribeChanges = subscribeDraftChanges(() => {
		if (pending) void invoke('profile_ack_transition', { requestId: pending, dirty: true, resolved: false }).catch(() => {});
	});
	const current = await invoke<TransitionRequest | null>('profile_window_ready');
	if (current) void respond(current);
	return () => {
		unsubscribeChanges();
		unlistenPrepare(); unlistenCanceled(); unlistenChanged();
		cancelDraftTransition();
	};
}

/** The token resolves only after all live webviews acknowledge the same session. */
export async function requestProfileTransition(expected: ProfileSession | null): Promise<{
	request: TransitionRequest;
	token: Promise<string>;
	cancel: () => Promise<void>;
}> {
	let resolveToken!: (value: string) => void;
	let rejectToken!: (reason: Error) => void;
	const token = new Promise<string>((resolve, reject) => { resolveToken = resolve; rejectToken = reject; });
	let requestId: string | null = null;
	const earlyReady = new Map<string, string>();
	const earlyCanceled = new Set<string>();
	let settled = false;
	const cleanup = () => { unlistenReady(); unlistenCanceled(); };
	const onReady = (event: ReadyEvent) => {
		if (requestId === null) { earlyReady.set(event.requestId, event.transitionToken); return; }
		if (event.requestId !== requestId || settled) return;
		settled = true; resolveToken(event.transitionToken); cleanup();
	};
	const onCanceled = (id: string) => {
		if (requestId === null) { earlyCanceled.add(id); return; }
		if (id !== requestId || settled) return;
		settled = true; rejectToken(new Error('profile transition canceled')); cleanup();
	};
	const unlistenReady = await listen<ReadyEvent>('profile:transition-ready', ({ payload }) => onReady(payload));
	const unlistenCanceled = await listen<{ requestId: string }>('profile:transition-canceled', ({ payload }) => onCanceled(payload.requestId));
	try {
		const request = await invoke<TransitionRequest>('profile_prepare_transition', { expected });
		requestId = request.requestId;
		if (earlyCanceled.has(requestId)) onCanceled(requestId);
		else if (earlyReady.has(requestId)) onReady({ requestId, transitionToken: earlyReady.get(requestId)! });
		return {
			request, token,
			cancel: async () => { await invoke('profile_cancel_transition', { requestId: request.requestId }); }
		};
	} catch (error) {
		cleanup();
		throw error;
	}
}

export async function installAppPreferencesListener(onChange: (preferences: AppPreferences) => void): Promise<() => void> {
	return listen<AppPreferences>('app:preferences-changed', ({ payload }) => onChange(payload));
}
