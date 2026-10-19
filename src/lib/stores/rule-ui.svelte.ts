import type { CategorizeRule } from '$lib/db/client';

class RuleUI {
	editorOpen = $state(false);
	editing = $state<CategorizeRule | null>(null);
	deleteTarget = $state<CategorizeRule | null>(null);
	clearOpen = $state(false);
	saving = $state(false);

	openEditor(rule: CategorizeRule | null = null) {
		this.editing = rule;
		this.editorOpen = true;
	}
}

export const ruleUI = new RuleUI();
