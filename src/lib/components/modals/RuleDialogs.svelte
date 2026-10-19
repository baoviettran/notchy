<script lang="ts">
	import Modal from '$lib/components/primitives/Modal.svelte';
	import ConfirmDialog from '$lib/components/primitives/ConfirmDialog.svelte';
	import RuleForm from '$lib/components/forms/RuleForm.svelte';
	import { rules } from '$lib/stores/rules.svelte';
	import { ruleUI } from '$lib/stores/rule-ui.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { label } from '$lib/utils/i18n.svelte';
	import { mapError } from '$lib/utils/errors';
	import * as m from '$lib/paraglide/messages';

	async function remove() {
		const target = ruleUI.deleteTarget;
		ruleUI.deleteTarget = null;
		if (!target || ruleUI.saving) return;
		ruleUI.saving = true;
		try { await rules.delete(target.id); }
		catch (e) { toast.show(mapError(e)); }
		finally { ruleUI.saving = false; }
	}

	async function clearLearned() {
		ruleUI.clearOpen = false;
		if (ruleUI.saving) return;
		ruleUI.saving = true;
		try {
			const count = await rules.clearLearned();
			toast.show(m.rules_cleared({ count }));
		} catch (e) { toast.show(mapError(e)); }
		finally { ruleUI.saving = false; }
	}
</script>

<!-- Stateful dialogs stay outside the locale-keyed shell in the root layout. -->
<Modal bind:open={ruleUI.editorOpen} locked={ruleUI.saving} title={label(() => ruleUI.editing ? m.rules_edit() : m.rules_add())}>
	<RuleForm existing={ruleUI.editing} onclose={() => ruleUI.editorOpen = false} />
</Modal>
<ConfirmDialog open={ruleUI.deleteTarget !== null} title={label(() => m.rules_delete_title())}
	message={label(() => m.rules_delete_message({ payee: ruleUI.deleteTarget?.payee_term ?? '' }))}
	confirmLabel={label(() => m.common_delete())} danger onconfirm={remove} onclose={() => ruleUI.deleteTarget = null} />
<ConfirmDialog bind:open={ruleUI.clearOpen} title={label(() => m.rules_clear())}
	message={label(() => m.rules_clear_message())} confirmLabel={label(() => m.rules_clear())}
	danger onconfirm={clearLearned} />
