import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/svelte';
import { AppError } from '$lib/errors';
import QuickAddPage from '../../../routes/quick-add/+page.svelte';

const state = vi.hoisted(() => ({
	initialized: false,
	firstRunComplete: true,
	persistedFirstRunComplete: true,
	active: true,
	profileId: 'A',
	profileName: 'Personal',
	generation: 'g1',
	create: vi.fn(),
	profileLoad: vi.fn(),
	showMain: vi.fn(),
	focus: null as null | ((event: { payload: boolean }) => void),
	list: vi.fn(),
	init: vi.fn(),
	initializeLifecycle: vi.fn(),
	profileListeners: null as null | { choose: (dirty: boolean) => Promise<string>; onTransitionCanceled?: () => void }
}));

vi.mock('$lib/db', () => ({
	isTauri: () => true,
	initDb: async () => { state.init(); state.initialized = true; },
	getDb: () => {
		if (!state.initialized) throw new Error('database not initialized');
		return { meta: { getDefaultQuickAccount: async () => null }, accounts: { list: state.list }, transactions: { create: state.create } };
	},
	databaseInitialize: state.initializeLifecycle
}));
vi.mock('$lib/stores/profiles.svelte', () => ({ profiles: {
	get snapshot() { return { active: state.active ? { profileId: state.profileId, generation: state.generation } : null, profiles: [{ id: state.profileId, name: state.profileName }] }; },
	load: async () => { state.profileLoad(); state.initialized = true; return { active: state.active ? { profileId: state.profileId, generation: state.generation } : null, profiles: [{ id: state.profileId, name: state.profileName }] }; }
} }));
vi.mock('$lib/profiles/windows', () => ({ installProfileWindowListeners: async (options: typeof state.profileListeners) => { state.profileListeners = options; return () => {}; } }));
vi.mock('@tauri-apps/api/webviewWindow', () => ({ WebviewWindow: { getByLabel: () => ({ show: state.showMain, setFocus: vi.fn() }) } }));
vi.mock('$lib/stores/settings.svelte', () => ({
	settings: { load: async () => {}, loadProfileSettings: async () => { state.firstRunComplete = state.persistedFirstRunComplete; }, locale: 'en', currency: 'VND', get firstRunComplete() { return state.firstRunComplete; } }
}));
vi.mock('@tauri-apps/api/event', () => ({ emit: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({
	onFocusChanged: async (callback: typeof state.focus) => { state.focus = callback; return () => {}; },
	show: vi.fn(), setFocus: vi.fn(), hide: vi.fn()
}) }));

beforeEach(() => {
	vi.clearAllMocks();
	state.initialized = false;
	state.firstRunComplete = true;
	state.persistedFirstRunComplete = true;
	state.active = true;
	state.profileId = 'A';
	state.profileName = 'Personal';
	state.generation = 'g1';
	state.focus = null;
	state.profileListeners = null;
	state.list.mockResolvedValue([{ id: 'acct1', name: 'Cash', balance: 50000 }]);
});

describe('native Quick Add startup', () => {
	it('becomes ready on focus after onboarding completes in the main window', async () => {
		state.firstRunComplete = false;
		state.persistedFirstRunComplete = false;
		render(QuickAddPage);
		await waitFor(() => expect(screen.getByRole('button', { name: /open main/i })).toBeInTheDocument());
		state.persistedFirstRunComplete = true;
		state.focus!({ payload: true });
		await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled());
	});
	it('shows the active profile name and updates it after a switch', async () => {
		render(QuickAddPage);
		await waitFor(() => expect(screen.getByText('Personal')).toBeInTheDocument());
		state.profileId = 'B'; state.profileName = 'Travel'; state.generation = 'g2';
		state.focus!({ payload: true });
		await waitFor(() => expect(screen.getByText('Travel')).toBeInTheDocument());
		expect(screen.queryByText('Personal')).not.toBeInTheDocument();
	});
	it('releases a pending draft choice when another window cancels the transition', async () => {
		render(QuickAddPage);
		await waitFor(() => expect(state.profileListeners).not.toBeNull());
		const input = screen.getByRole('textbox');
		await fireEvent.input(input, { target: { value: '50k lunch' } });
		const answer = state.profileListeners!.choose(true);
		await waitFor(() => expect(screen.getByRole('alertdialog')).toBeInTheDocument());
		expect(state.profileListeners!.onTransitionCanceled).toBeTypeOf('function');
		state.profileListeners!.onTransitionCanceled!();
		await expect(answer).resolves.toBe('cancel');
		expect(input).toHaveValue('50k lunch');
	});
	it('does not save an A draft into B when the session changes before Enter', async () => {
		render(QuickAddPage);
		await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled());
		await fireEvent.input(screen.getByRole('textbox'), { target: { value: '50k lunch' } });
		state.profileId = 'B';
		await fireEvent.keyDown(window, { key: 'Enter' });
		await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''));
		expect(state.create).not.toHaveBeenCalled();
	});
	it('drops the stale account selection after a reset advances generation', async () => {
		render(QuickAddPage);
		await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled());
		await fireEvent.input(screen.getByRole('textbox'), { target: { value: '50k lunch' } });
		state.generation = 'g2';
		await fireEvent.keyDown(window, { key: 'Enter' });
		await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''));
		expect(state.create).not.toHaveBeenCalled();
	});
	it('blocks input with no active profile and offers to open the main window', async () => {
		state.active = false;
		render(QuickAddPage);
		await waitFor(() => expect(screen.getByRole('button', { name: /open main/i })).toBeInTheDocument());
		expect(screen.getByRole('textbox')).toBeDisabled();
		expect(state.list).not.toHaveBeenCalled();
	});
	it('creates its window adapter without initializing the database lifecycle', async () => {
		render(QuickAddPage);
		await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled());
		expect(state.profileLoad).toHaveBeenCalledTimes(1);
		expect(state.init).not.toHaveBeenCalled();
		expect(state.initializeLifecycle).not.toHaveBeenCalled();
	});

	it('retries account loading when focused after the main window finishes startup', async () => {
		state.list.mockRejectedValueOnce(new AppError('database_update_required'));
		render(QuickAddPage);
		await waitFor(() => expect(state.focus).not.toBeNull());
		await waitFor(() => expect(state.list).toHaveBeenCalledTimes(1));
		expect(screen.getByRole('textbox')).toBeDisabled();
		state.focus!({ payload: true });
		await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled());
		await waitFor(() => expect(screen.getByRole('textbox')).toHaveFocus());
		expect(screen.queryByText('Something went wrong. Please try again')).not.toBeInTheDocument();
	});
});
