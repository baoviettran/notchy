import { test as base, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { onboard } from '../helpers/ui';

/**
 * Every non-onboarding spec starts from an onboarded app on the Dashboard.
 * Re-runs the real onboarding (not a SQL seed) each test, so the setup path
 * stays under test and can't drift from what real onboarding produces.
 */
export const test = base.extend<{ onboardedPage: Page }>({
	// eslint-disable-next-line no-empty-pattern
	onboardedPage: async ({ page }, use) => {
		await onboard(page);
		await use(page);
	}
});

export { expect };
