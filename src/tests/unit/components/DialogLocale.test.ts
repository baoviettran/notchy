import { afterEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/svelte';
import { setLanguageTag } from '$lib/paraglide/runtime';
import { settings } from '$lib/stores/settings.svelte';
import Modal from '$lib/components/primitives/Modal.svelte';
import ConfirmDialog from '$lib/components/primitives/ConfirmDialog.svelte';
import { snip } from '../helpers/snippet';

afterEach(() => { setLanguageTag('en'); settings.locale = 'en'; });

async function switchToVietnamese() {
	await act(() => { setLanguageTag('vi'); settings.locale = 'vi'; });
}

describe('dialog labels outside the locale key', () => {
	it('updates the modal close label when the locale changes', async () => {
		render(Modal, { open: true, title: 'Draft', children: snip('Draft') });
		expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
		await switchToVietnamese();
		expect(screen.getByRole('button', { name: 'Đóng' })).toBeInTheDocument();
	});

	it('updates confirmation buttons when the locale changes', async () => {
		render(ConfirmDialog, { open: true, title: 'Delete?' });
		await switchToVietnamese();
		expect(screen.getByRole('button', { name: 'Huỷ' })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Xoá' })).toBeInTheDocument();
	});
});
