import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import { AppError } from '$lib/errors';
import QuickAddPage from '../../../routes/quick-add/+page.svelte';

const state = vi.hoisted(() => ({
	initialized: false,
	focus: null as null | ((event: { payload: boolean }) => void),
	list: vi.fn(),
	init: vi.fn(),
	initializeLifecycle: vi.fn()
}));

vi.mock('$lib/db', () => ({
	isTauri: () => true,
	initDb: async () => { state.init(); state.initialized = true; },
	getDb: () => {
		if (!state.initialized) throw new Error('database not initialized');
		return { meta: { getDefaultQuickAccount: async () => null }, accounts: { list: state.list } };
	},
	databaseInitialize: state.initializeLifecycle
}));
vi.mock('$lib/stores/settings.svelte', () => ({
	settings: { load: async () => {}, locale: 'en', currency: 'VND' }
}));
vi.mock('@tauri-apps/api/event', () => ({ emit: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({
	onFocusChanged: async (callback: typeof state.focus) => { state.focus = callback; return () => {}; },
	hide: vi.fn()
}) }));

beforeEach(() => {
	vi.clearAllMocks();
	state.initialized = false;
	state.focus = null;
	state.list.mockResolvedValue([{ id: 'acct1', name: 'Cash', balance: 50000 }]);
});

describe('native Quick Add startup', () => {
	it('creates its window adapter without initializing the database lifecycle', async () => {
		render(QuickAddPage);
		await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled());
		expect(state.init).toHaveBeenCalledTimes(1);
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
