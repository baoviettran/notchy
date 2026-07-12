import { describe, it, expect } from 'vitest';
import { TOUR_STEPS } from '$lib/tour/steps';

describe('TOUR_STEPS', () => {
  it('has 5 steps', () => {
    expect(TOUR_STEPS).toHaveLength(5);
  });

  it('has expected step ids in order', () => {
    expect(TOUR_STEPS.map(s => s.id)).toEqual(['net', 'add', 'transactions', 'budgets', 'more']);
  });

  it('each step has at least one target selector', () => {
    for (const step of TOUR_STEPS) {
      expect(step.targets.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('each step has titleKey and bodyKey', () => {
    for (const step of TOUR_STEPS) {
      expect(step.titleKey).toBeTruthy();
      expect(step.bodyKey).toBeTruthy();
    }
  });
});
