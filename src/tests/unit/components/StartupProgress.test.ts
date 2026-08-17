// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import StartupProgress from '$lib/components/system/StartupProgress.svelte';

describe('StartupProgress', () => {
	it('shows checking stage message by default', () => {
		render(StartupProgress, { props: { stage: 'checking' } });
		expect(screen.getByText('Checking your data…')).toBeVisible();
	});

	it('shows backing_up stage message', () => {
		render(StartupProgress, { props: { stage: 'backing_up' } });
		expect(screen.getByText('Creating a recovery backup…')).toBeVisible();
	});

	it('shows migrating stage message', () => {
		render(StartupProgress, { props: { stage: 'migrating' } });
		expect(screen.getByText('Upgrading your data…')).toBeVisible();
	});

	it('shows verifying stage message', () => {
		render(StartupProgress, { props: { stage: 'verifying' } });
		expect(screen.getByText('Verifying your data…')).toBeVisible();
	});

	it('falls back to checking for unknown stage', () => {
		render(StartupProgress, { props: { stage: 'ready' } });
		expect(screen.getByText('Checking your data…')).toBeVisible();
	});
});
