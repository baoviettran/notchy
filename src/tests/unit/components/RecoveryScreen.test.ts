// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import RecoveryScreen from '$lib/components/system/RecoveryScreen.svelte';
import { buildTechnicalReport } from '$lib/recovery';
import type { RecoveryContext } from '$lib/db/startup';

const context: RecoveryContext = {
	code: 'migration_failed',
	appVersion: '0.1.4',
	latestSchemaVersion: 4,
	detectedSchemaVersion: 4,
	liveDatabasePath: '/data/notchy.db',
	backupPath: '/data/backups/upgrades/safe.sqlite',
	detail: 'Private Clinic 900000'
};

function props(overrides: Partial<RecoveryContext> = {}) {
	return {
		context: { ...context, ...overrides },
		onretry: vi.fn(),
		onrestore: vi.fn(),
		onopenfolder: vi.fn(),
		onquit: vi.fn()
	};
}

function renderScreen(p: ReturnType<typeof props>) {
	// `context` is also a Svelte option name, so all props must sit under `props`.
	return render(RecoveryScreen, { props: p });
}

describe('RecoveryScreen', () => {
	it('shows non-sensitive recovery facts and exposes retry', async () => {
		const p = props();
		renderScreen(p);

		expect(screen.getByRole('heading', { name: 'Notchy needs attention' })).toBeVisible();
		// non-sensitive facts: app version, schema versions, file paths
		expect(screen.getByText('0.1.4')).toBeInTheDocument();
		expect(screen.getAllByText('4')).toHaveLength(2);
		expect(screen.getByText('/data/notchy.db')).toBeInTheDocument();
		expect(screen.getByText('/data/backups/upgrades/safe.sqlite')).toBeInTheDocument();
		// never render raw failure detail (may embed financial values)
		expect(screen.queryByText(/Private Clinic/)).toBeNull();
		expect(screen.queryByText(/900000/)).toBeNull();

		await fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
		expect(p.onretry).toHaveBeenCalledOnce();
	});

	it('copies the allowlisted technical report to the clipboard', async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		const p = props();
		renderScreen(p);

		await fireEvent.click(screen.getByRole('button', { name: 'Copy technical report' }));
		await waitFor(() => expect(writeText).toHaveBeenCalledWith(buildTechnicalReport(p.context)));
	});

	it('shows restore only when a backup path exists', async () => {
		const first = renderScreen(props());
		expect(screen.getByRole('button', { name: 'Restore verified backup' })).toBeInTheDocument();
		first.unmount();

		renderScreen(props({ backupPath: null }));
		expect(screen.queryByRole('button', { name: 'Restore verified backup' })).not.toBeInTheDocument();
	});
});
