// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

// The modal drives the REAL ImportStore through its full flow (file → mapping →
// preview → commit) with $state-reactive fields. The only thing we can't let it
// touch is getDb() — sql.js wasm can't init in jsdom — so we mock the DB
// boundary (empty existing transactions + a committable batch).
const mockList = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const mockCreateBatch = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockTxLoad = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => vi.fn());

vi.mock('$lib/db', () => ({
	getDb: () => ({ transactions: { list: mockList, createBatch: mockCreateBatch } })
}));
vi.mock('$lib/stores/accounts.svelte', () => ({
	accounts: {
		items: [{ id: 'acc-1', name: 'Checking', archived: 0 }],
		load: vi.fn()
	}
}));
vi.mock('$lib/stores/settings.svelte', () => ({
	settings: { locale: 'en', currency: 'VND' }
}));
vi.mock('$lib/stores/transactions.svelte', () => ({
	transactions: { items: [], load: mockTxLoad }
}));
vi.mock('$lib/stores/toast.svelte', () => ({
	toast: { show: mockToast }
}));
// The Tauri cross-window emit path is exercised by the __TAURI_INTERNALS__ test.
vi.mock('@tauri-apps/api/event', () => ({ emit: vi.fn().mockResolvedValue(undefined) }));

import ImportTransactionsModal from '$lib/components/modals/ImportTransactionsModal.svelte';

// Two valid new rows: a coffee expense and a salary income.
const CSV = 'Date,Amount,Payee\n2026-01-01,100000,Coffee\n2026-01-02,200000,Salary';
const FILE = () => new File([CSV], 'tx.csv', { type: 'text/csv' });

async function chooseFile(container: HTMLElement, file: File = FILE()) {
	await fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files: [file] } });
}

async function loadFile(container: HTMLElement) {
	await fireEvent.change(screen.getByLabelText('Select account'), { target: { value: 'acc-1' } });
	await chooseFile(container);
	await fireEvent.click(screen.getByRole('button', { name: 'Load file' }));
	// The real ImportStore parses + classifies and lands on the mapping phase.
	await waitFor(() => expect(screen.getByText('Sign convention')).toBeInTheDocument());
}

describe('ImportTransactionsModal', () => {
	beforeEach(() => {
		mockList.mockReset();
		mockList.mockResolvedValue([]);
		mockCreateBatch.mockReset();
		mockCreateBatch.mockResolvedValue(undefined);
		mockTxLoad.mockReset();
		mockTxLoad.mockResolvedValue(undefined);
		mockToast.mockReset();
	});

	it('starts on the select phase with the Load button disabled until account + file', () => {
		render(ImportTransactionsModal, { open: true });
		expect(screen.getByText('Import Transactions')).toBeInTheDocument();
		expect(screen.getByText('Select CSV file')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Load file' })).toBeDisabled();
	});

	it('enables Load once an account is chosen and a file is selected', async () => {
		const { container } = render(ImportTransactionsModal, { open: true });
		await fireEvent.change(screen.getByLabelText('Select account'), { target: { value: 'acc-1' } });
		expect(screen.getByRole('button', { name: 'Load file' })).toBeDisabled();
		await chooseFile(container);
		expect(screen.getByRole('button', { name: 'Load file' })).not.toBeDisabled();
	});

	it('warns when the file is too large and never calls the store', async () => {
		const { container } = render(ImportTransactionsModal, { open: true });
		const big = FILE();
		Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 });
		await fireEvent.change(screen.getByLabelText('Select account'), { target: { value: 'acc-1' } });
		await chooseFile(container, big);
		expect(screen.getByText('File too large (>10MB). Please choose a smaller file.')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Load file' })).toBeDisabled();
		expect(mockList).not.toHaveBeenCalled();
	});

	it('surfaces a parse error and returns to the select phase when the store throws', async () => {
		const { container } = render(ImportTransactionsModal, { open: true });
		// An existing-transactions fetch that rejects propagates out of loadFile.
		mockList.mockRejectedValueOnce(new Error('db down'));
		await fireEvent.change(screen.getByLabelText('Select account'), { target: { value: 'acc-1' } });
		await chooseFile(container);
		await fireEvent.click(screen.getByRole('button', { name: 'Load file' }));

		await waitFor(() =>
			expect(screen.getByText('Could not parse this CSV file. Check that it is a valid CSV.')).toBeInTheDocument()
		);
		expect(screen.getByText('Select CSV file')).toBeInTheDocument();
	});

	it('advances to the mapping phase and previews the classified rows', async () => {
		const { container } = render(ImportTransactionsModal, { open: true });
		await loadFile(container);
		// Mapping phase, then continue to preview.
		await fireEvent.click(screen.getByRole('button', { name: 'Continue to preview' }));
		expect(screen.getByText('Coffee')).toBeInTheDocument();
		expect(screen.getByText('Salary')).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Import 2' })).toBeInTheDocument();
	});

	it('switches the money fields to Debit/Credit under the separate convention', async () => {
		const { container } = render(ImportTransactionsModal, { open: true });
		await loadFile(container);
		// The default CSV uses a single signed Amount column.
		await fireEvent.change(screen.getByLabelText('Sign convention'), { target: { value: 'debit_credit_separate' } });
		expect(screen.getByLabelText(/^Debit column$/)).toBeInTheDocument();
		expect(screen.getByLabelText(/^Credit column$/)).toBeInTheDocument();
		expect(screen.queryByLabelText(/^Amount column$/)).not.toBeInTheDocument();
	});

	it('backs out of mapping to the empty select phase', async () => {
		const { container } = render(ImportTransactionsModal, { open: true });
		await loadFile(container);
		await fireEvent.click(screen.getByRole('button', { name: 'Back' }));
		expect(screen.getByText('Select CSV file')).toBeInTheDocument();
		// fileText was reset, so Load stays disabled even with an account chosen.
		await fireEvent.change(screen.getByLabelText('Select account'), { target: { value: 'acc-1' } });
		expect(screen.getByRole('button', { name: 'Load file' })).toBeDisabled();
	});

	it('commits the new rows, reloads transactions, toasts, and dismisses', async () => {
		const { container } = render(ImportTransactionsModal, { open: true });
		await loadFile(container);
		await fireEvent.click(screen.getByRole('button', { name: 'Continue to preview' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Import 2' }));

		await waitFor(() => expect(mockCreateBatch).toHaveBeenCalled());
		expect(mockCreateBatch.mock.calls[0][0]).toHaveLength(2);
		expect(mockCreateBatch.mock.calls[0][0][0].payee).toBe('Coffee');
		expect(mockTxLoad).toHaveBeenCalled();
		expect(mockToast).toHaveBeenCalledWith('Imported 2 transactions');
		await waitFor(() => expect(screen.queryByText('Import Transactions')).not.toBeInTheDocument());
	});

	it('surfaces a commit error and stays open', async () => {
		const { container } = render(ImportTransactionsModal, { open: true });
		mockCreateBatch.mockRejectedValueOnce(new Error('commit failed'));
		await loadFile(container);
		await fireEvent.click(screen.getByRole('button', { name: 'Continue to preview' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Import 2' }));

		await waitFor(() =>
			expect(screen.getByText('Could not import transactions. Please try again.')).toBeInTheDocument()
		);
		expect(screen.getByText('Import Transactions')).toBeInTheDocument();
	});

	it('marks duplicate and invalid rows in preview and locks their checkboxes', async () => {
		// Row 1 already exists in the DB (same account/date/amount/kind) →
		// duplicate. Row 2 has an unparseable amount AND no payee → invalid,
		// and its checkbox label must fall back to the row number. Row 3 is new.
		const dupList = [
			{ id: 'tx-1', account_id: 'acc-1', date: '2026-01-01', amount: 100000, kind: 'expense' }
		];
		mockList.mockResolvedValue(dupList);

		const { container } = render(ImportTransactionsModal, { open: true });
		const mixed = 'Date,Amount,Payee\n2026-01-01,100000,Coffee\n2026-01-02,not-a-number,\n2026-01-03,200000,Salary';
		await fireEvent.change(screen.getByLabelText('Select account'), { target: { value: 'acc-1' } });
		await chooseFile(container, new File([mixed], 'tx.csv', { type: 'text/csv' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Load file' }));
		await waitFor(() => expect(screen.getByText('Sign convention')).toBeInTheDocument());
		await fireEvent.click(screen.getByRole('button', { name: 'Continue to preview' }));

		expect(screen.getByText('Duplicate')).toBeInTheDocument();
		expect(screen.getByText('Invalid')).toBeInTheDocument();
		expect(screen.getByText('—')).toBeInTheDocument(); // payee-less row renders the em dash

		// Duplicate + invalid checkboxes are locked; the new row's is not.
		expect(screen.getByRole('checkbox', { name: 'Include: Coffee' })).toBeDisabled();
		expect(screen.getByRole('checkbox', { name: 'Include: #2' })).toBeDisabled();
		expect(screen.getByRole('checkbox', { name: 'Include: Salary' })).toBeEnabled();

		// Only genuinely new rows are committable.
		expect(screen.getByRole('button', { name: 'Import 1' })).toBeInTheDocument();
	});

	it('emits the cross-window save event through Tauri when running in Tauri', async () => {
		const { emit } = vi.mocked(await import('@tauri-apps/api/event'), true);
		vi.mocked(emit).mockClear();

		// Pretend we're inside the Tauri webview so the modal takes the emit path
		// instead of the browser window event fallback.
		(window as unknown as { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__ = {};

		const { container } = render(ImportTransactionsModal, { open: true });
		try {
			await loadFile(container);
			await fireEvent.click(screen.getByRole('button', { name: 'Continue to preview' }));
			await fireEvent.click(screen.getByRole('button', { name: 'Import 2' }));

			await waitFor(() => expect(vi.mocked(emit)).toHaveBeenCalledWith('transaction:saved', {}));
		} finally {
			delete (window as unknown as { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__;
		}
	});
});