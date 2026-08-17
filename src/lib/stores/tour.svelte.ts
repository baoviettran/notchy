import { getDb } from '$lib/db';
import { TOUR_STEPS } from '$lib/tour/steps';

class TourStore {
	active = $state(false);
	currentStep = $state(0);
	complete = $state(false);

	/** Called once at main-layout boot. Grandfathers existing users. */
	async load(): Promise<void> {
		const db = getDb();
		const firstRunDone = await db.meta.isFirstRunComplete();
		const tourDone = await db.meta.isTourComplete();

		if (firstRunDone && !tourDone) {
			// Grandfather: existing user who finished onboarding before tour existed.
			await db.meta.setTourComplete();
			this.complete = true;
			return;
		}

		if (tourDone) {
			this.complete = true;
		}
		// If firstRunDone is false (fresh user mid-onboarding), do nothing —
		// the tour will auto-start after onboarding completes and layout re-runs.
	}

	start(opts?: { force?: boolean }): void {
		if (!opts?.force && this.complete) return;
		this.currentStep = 0;
		this.active = true;
	}

	async next(): Promise<void> {
		if (!this.active) return;
		if (this.currentStep + 1 >= TOUR_STEPS.length) {
			await this.finish();
			return;
		}
		this.currentStep++;
	}

	back(): void {
		if (!this.active) return;
		if (this.currentStep > 0) this.currentStep--;
	}

	async skip(): Promise<void> {
		this.active = false;
		const db = getDb();
		await db.meta.setTourComplete();
		this.complete = true;
	}

	async finish(): Promise<void> {
		this.active = false;
		const db = getDb();
		await db.meta.setTourComplete();
		this.complete = true;
	}
}

export const tour = new TourStore();
