// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/svelte';
import ProfileSwitcher from '$lib/components/profiles/ProfileSwitcher.svelte';
const a = { id: '01ABCDEFGH1234567890', name: 'Personal', createdAt: '2026-01-02T00:00:00Z' };
const b = { id: '01ZYXWVUTS1234567890', name: 'Work', createdAt: '2026-02-03T00:00:00Z' };
const snapshot = { profiles: [a, b], active: { profileId: a.id, generation: 'g1' }, phase: 'idle' as const, preferences: { locale: 'en' as const, theme: 'light' as const }, recovery: null };

describe('ProfileSwitcher', () => {
	it('does not show a failure when a draft cancels switching', async () => {
		const onopen = vi.fn(async () => { throw new Error('profile transition canceled'); });
		render(ProfileSwitcher, { snapshot, onopen });
		await fireEvent.click(screen.getByRole('button', { name: /current profile.*Personal/i }));
		await fireEvent.click(screen.getByRole('button', { name: /Work/ }));
		expect(screen.queryByRole('alert')).toBeNull();
	});
	it('shows active name and switches by ID from a keyboard-reachable list', async () => {
		const onopen = vi.fn(async () => {});
		render(ProfileSwitcher, { snapshot, onopen });
		await fireEvent.click(screen.getByRole('button', { name: /current profile.*Personal/i }));
		await fireEvent.click(screen.getByRole('button', { name: /Work/ }));
		expect(onopen).toHaveBeenCalledWith(b.id);
	});
});
