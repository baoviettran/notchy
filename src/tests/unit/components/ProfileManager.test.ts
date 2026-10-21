// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import ProfileManager from '$lib/components/profiles/ProfileManager.svelte';

const records = [
	{ id: '01ABCDEFGH1234567890', name: 'Personal', createdAt: '2026-01-02T00:00:00Z' },
	{ id: '01ZYXWVUTS1234567890', name: 'Personal', createdAt: '2026-02-03T00:00:00Z' }
];
const preferences = { locale: 'en' as const, theme: 'light' as const };

describe('ProfileManager', () => {
	it('offers create and restore without an active profile', () => {
		render(ProfileManager, { mode: 'picker', snapshot: { profiles: [], active: null, phase: 'idle', preferences, recovery: null } });
		expect(screen.getByRole('button', { name: /create profile/i })).toBeTruthy();
		expect(screen.getByRole('button', { name: /restore backup/i })).toBeTruthy();
	});
	it('distinguishes duplicate names and marks only the active profile', () => {
		render(ProfileManager, { mode: 'manage', snapshot: { profiles: records, active: { profileId: records[0].id, generation: 'g1' }, phase: 'idle', preferences, recovery: null } });
		expect(screen.getAllByText('Personal')).toHaveLength(2);
		expect(screen.getAllByText(/01ABC|01ZYX/)).toHaveLength(2);
		expect(screen.getAllByText(/2026/)).toHaveLength(2);
		expect(screen.getAllByText(/active/i)).toHaveLength(1);
	});
	it('keeps the chosen row available after opening fails', async () => {
		const onopen = vi.fn(async () => { throw new Error('open failed'); });
		render(ProfileManager, { mode: 'picker', snapshot: { profiles: records, active: null, phase: 'idle', preferences, recovery: null }, onopen });
		await fireEvent.click(screen.getByRole('button', { name: /open.*01ABC/i }));
		expect(screen.getByRole('alert')).toBeTruthy();
		expect(screen.getByRole('button', { name: /open.*01ABC/i })).toBeTruthy();
	});
	it('keeps the picker quiet when the user keeps a draft in another window', async () => {
		const onopen = vi.fn(async () => { throw new Error('profile transition canceled'); });
		render(ProfileManager, { mode: 'picker', snapshot: { profiles: records, active: null, phase: 'idle', preferences, recovery: null }, onopen });
		await fireEvent.click(screen.getByRole('button', { name: /open.*01ABC/i }));
		expect(screen.queryByRole('alert')).toBeNull();
		expect(screen.getByRole('button', { name: /open.*01ABC/i })).toBeEnabled();
	});
	it('opens the selected profile instead of choosing by duplicate label', async () => {
		const onopen = vi.fn();
		render(ProfileManager, { mode: 'picker', snapshot: { profiles: records, active: null, phase: 'idle', preferences, recovery: null }, onopen });
		await fireEvent.click(screen.getByRole('button', { name: /open.*01ZYX/i }));
		expect(onopen).toHaveBeenCalledWith(records[1].id);
	});
});
