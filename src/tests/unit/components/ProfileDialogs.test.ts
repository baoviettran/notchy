// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import ProfileDialogs from '$lib/components/profiles/ProfileDialogs.svelte';
import { profileDialog } from '$lib/components/profiles/controller.svelte';
import { settings } from '$lib/stores/settings.svelte';

const target = { id: '01ABCDEFGH1234567890', name: 'Home', createdAt: '2026-01-02T00:00:00Z' };
const actions = { createAndOpen: vi.fn(async () => {}), rename: vi.fn(async () => {}), reset: vi.fn(async () => {}), remove: vi.fn(async () => ({ cleanupPending: false })), restore: vi.fn(async () => ({ ...target, id: 'new' })), switchTo: vi.fn(async () => {}), inspectRestore: vi.fn(async () => ({ token: 'preview', suggestedName: 'Recovered', schemaVersion: 8 })), cancelRestore: vi.fn(async () => {}), backup: vi.fn(async () => 'backup'), exportBackup: vi.fn(async () => {}) };

describe('ProfileDialogs', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		profileDialog.close();
		settings.loadAppPreferences({ locale: 'en', theme: 'light' });
	});
	it('keeps a trimmed name and rejects 81 Unicode characters', async () => {
		profileDialog.open('create');
		render(ProfileDialogs, { actions });
		const input = screen.getByRole('textbox', { name: /profile name/i });
		await fireEvent.input(input, { target: { value: 'A'.repeat(81) } });
		expect((screen.getByRole('button', { name: /create profile/i }) as HTMLButtonElement).disabled).toBe(true);
		await fireEvent.input(input, { target: { value: '  Family  ' } });
		await fireEvent.click(screen.getByRole('button', { name: /create profile/i }));
		await waitFor(() => expect(actions.createAndOpen).toHaveBeenCalledWith('Family'));
	});
	it('allows exactly 80 Unicode characters and preserves a name after a save error', async () => {
		profileDialog.open('create');
		render(ProfileDialogs, { actions });
		const input = screen.getByRole('textbox', { name: /profile name/i }) as HTMLInputElement;
		await fireEvent.input(input, { target: { value: '🧾'.repeat(80) } });
		expect((screen.getByRole('button', { name: /create profile/i }) as HTMLButtonElement).disabled).toBe(false);
		vi.mocked(actions.createAndOpen).mockRejectedValueOnce(new Error('disk full'));
		await fireEvent.click(screen.getByRole('button', { name: /create profile/i }));
		await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
		expect(input.value).toBe('🧾'.repeat(80));
	});
	it('explains the pre-reset backup and names the profile before confirmation', () => {
		profileDialog.open('reset', target);
		render(ProfileDialogs, { actions });
		expect(screen.getByText(/Home/)).toBeTruthy();
		expect(screen.getByText(/backup/i)).toBeTruthy();
	});
	it('preserves an entered name across language changes', async () => {
		settings.loadAppPreferences({ locale: 'en', theme: 'light' });
		profileDialog.open('create');
		render(ProfileDialogs, { actions });
		const input = screen.getByRole('textbox', { name: /profile name/i }) as HTMLInputElement;
		await fireEvent.input(input, { target: { value: 'Family draft' } });
		settings.loadAppPreferences({ locale: 'vi', theme: 'light' });
		expect(input.value).toBe('Family draft');
		await waitFor(() => expect(screen.getByRole('textbox', { name: /tên hồ sơ/i })).toBe(input));
		settings.loadAppPreferences({ locale: 'en', theme: 'light' });
	});
	it('cancels a staged restore when the dialog closes', async () => {
		profileDialog.open('restore');
		render(ProfileDialogs, { actions, chooseSourcePath: async () => '/tmp/source.sqlite' });
		await fireEvent.click(screen.getByRole('button', { name: /choose backup file/i }));
		await waitFor(() => expect(actions.inspectRestore).toHaveBeenCalledWith('/tmp/source.sqlite'));
		await fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
		await waitFor(() => expect(actions.cancelRestore).toHaveBeenCalledWith('preview'));
		expect(profileDialog.mode).toBeNull();
	});
	it('restores under an edited name and offers an explicit Open action', async () => {
		profileDialog.open('restore');
		render(ProfileDialogs, { actions, chooseSourcePath: async () => '/tmp/source.sqlite' });
		await fireEvent.click(screen.getByRole('button', { name: /choose backup file/i }));
		const input = await screen.findByRole('textbox', { name: /profile name/i });
		await fireEvent.input(input, { target: { value: '  Second home  ' } });
		await fireEvent.click(screen.getByRole('button', { name: /create restored profile/i }));
		await waitFor(() => expect(actions.restore).toHaveBeenCalledWith('preview', 'Second home'));
		expect(profileDialog.mode).toBe('restore-success');
		expect(screen.getByRole('button', { name: /open restored profile/i })).toBeTruthy();
	});
	it('uses Escape to cancel the staged restore', async () => {
		profileDialog.open('restore');
		render(ProfileDialogs, { actions, chooseSourcePath: async () => '/tmp/source.sqlite' });
		await fireEvent.click(screen.getByRole('button', { name: /choose backup file/i }));
		await screen.findByRole('textbox', { name: /profile name/i });
		await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
		await waitFor(() => expect(actions.cancelRestore).toHaveBeenCalledWith('preview'));
	});
	it('keeps backup dialog open when export destination is canceled', async () => {
		profileDialog.open('backup', target);
		render(ProfileDialogs, { actions, chooseSavePath: async () => null });
		await fireEvent.click(screen.getByRole('button', { name: /export backup/i }));
		expect(profileDialog.mode).toBe('backup');
		expect(actions.exportBackup).not.toHaveBeenCalled();
	});
	it('deletes without export only after that explicit choice', async () => {
		profileDialog.open('delete', target);
		render(ProfileDialogs, { actions, chooseSavePath: async () => { throw new Error('should not pick'); } });
		await fireEvent.click(screen.getByRole('radio', { name: /delete without exporting/i }));
		await fireEvent.click(screen.getByRole('button', { name: /delete profile/i }));
		await waitFor(() => expect(actions.remove).toHaveBeenCalledWith(target.id, null));
	});
	it('requires export-first deletion choice and preserves target on cancel', async () => {
		profileDialog.open('delete', target);
		render(ProfileDialogs, { actions, chooseSavePath: async () => null });
		expect(screen.getByText(/internal backups/i)).toBeTruthy();
		await fireEvent.click(screen.getByRole('button', { name: /delete profile/i }));
		expect(actions.remove).not.toHaveBeenCalled();
		expect(profileDialog.target?.id).toBe(target.id);
	});
});
