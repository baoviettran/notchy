import { describe, expect, it } from 'vitest';
import capability from '../../../src-tauri/capabilities/quick-add.json';

describe('Quick Add native window capability', () => {
	it('can show and focus itself to resolve an unsaved draft before switching profiles', () => {
		expect(capability.permissions).toContain('core:window:allow-show');
		expect(capability.permissions).toContain('core:window:allow-set-focus');
	});
});
