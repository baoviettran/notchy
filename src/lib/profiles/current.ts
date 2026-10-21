import type { ProfileSession } from './types';

let current: ProfileSession | null = null;
export function setBoundProfileSession(session: ProfileSession | null): void { current = session; }
export function getBoundProfileSession(): ProfileSession | null { return current; }
