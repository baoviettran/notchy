// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import { hasDirtyDrafts, resolveDrafts } from '$lib/profiles/drafts.svelte';

vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/stores/settings.svelte', () => ({ settings: {
	locale: 'en', currency: 'VND', setLocale: vi.fn(async () => {}),
	setCurrency: vi.fn(async () => {}), completeOnboarding: vi.fn(async () => {})
} }));
vi.mock('$lib/stores/accounts.svelte', () => ({ accounts: { create: vi.fn(async () => 'account') } }));
vi.mock('$lib/stores/db.svelte', () => ({ dbStore: { firstRunComplete: false } }));

import Onboarding from '../../../routes/onboarding/+page.svelte';

describe('profile draft integration', () => {
	it('keeps an unfinished onboarding account when a profile switch is canceled', async () => {
		render(Onboarding);
		await fireEvent.click(screen.getByRole('button', { name: 'Continue →' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Continue →' }));
		await fireEvent.input(screen.getByLabelText('Name'), { target: { value: 'My cash' } });
		await waitFor(() => expect(hasDirtyDrafts()).toBe(true));
		expect(await resolveDrafts('stay')).toBe(false);
		expect(screen.getByLabelText('Name')).toHaveValue('My cash');
	});
});
