<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '$lib/components/primitives/Button.svelte';
	import Modal from '$lib/components/primitives/Modal.svelte';
	import Input from '$lib/components/primitives/Input.svelte';
	import Select from '$lib/components/primitives/Select.svelte';
	import ConfirmDialog from '$lib/components/primitives/ConfirmDialog.svelte';
	import { categories } from '$lib/stores/categories.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { getDb } from '$lib/db';
	import { getTagTransactionInfo } from '$lib/db/repos/categories';
	import type { Tag } from '$lib/db/repos/categories';
	import * as m from '$lib/paraglide/messages';

	let showForm = $state(false);
	let editing = $state<Tag | null>(null);
	let formName = $state('');
	let formBucketId = $state('');
	let confirmDelete = $state<Tag | null>(null);
	let deleteOption = $state<'uncategorise' | string>('uncategorise');
	let affectedCount = $state(0);

	onMount(() => categories.load());

	function openCreate() {
		editing = null; formName = ''; formBucketId = categories.buckets[0]?.id ?? ''; showForm = true;
	}
	function openEdit(t: Tag) {
		editing = t; formName = t.name; formBucketId = t.type_id; showForm = true;
	}

	async function saveTag() {
		if (!formName.trim()) return;
		try {
			if (editing) {
				if (formName !== editing.name) await categories.renameTag(editing.id, formName);
				if (formBucketId !== editing.type_id) await categories.moveTag(editing.id, formBucketId);
				toast.show(m.categories_tag_updated());
			} else {
				await categories.createTag(formName, formBucketId);
				toast.show(m.categories_tag_created());
			}
			showForm = false;
		} catch (e) {
			toast.show(String(e).replace('Error: ', ''));
		}
	}

	async function startDelete(t: Tag) {
		const db = await getDb();
		const info = await getTagTransactionInfo(db, t.id);
		affectedCount = info.affected_count;
		deleteOption = 'uncategorise';
		confirmDelete = t;
	}

	async function doDelete() {
		if (!confirmDelete) return;
		try {
			const opt = deleteOption === 'uncategorise' ? 'uncategorise' : { merge_into: deleteOption };
			await categories.deleteTag(confirmDelete.id, opt);
			toast.show(m.categories_tag_deleted());
			confirmDelete = null;
		} catch (e) {
			toast.show(String(e).replace('Error: ', ''));
		}
	}

	const bucketOptions = $derived(categories.buckets.map((b) => ({ value: b.id, label: b.name })));

	function mergeTargetOptions(currentTagId: string) {
		return [
			{ value: 'uncategorise', label: m.categories_uncategorise() },
			...categories.tags.filter((t) => t.id !== currentTagId).map((t) => ({ value: t.id, label: m.categories_merge_into({ name: t.name }) }))
		];
	}
</script>

<div class="space-y-6">
	<div class="flex items-center justify-between">
		<h1 class="figures text-xl text-ledger tracking-wide">{m.categories_title()}</h1>
		<Button size="sm" onclick={openCreate}>{m.categories_add_tag()}</Button>
	</div>

	{#each categories.buckets as bucket}
		{@const bucketTags = categories.tagsForBucket(bucket.id)}
		<section>
			<h2 class="plate mb-2">{bucket.name}</h2>
			<div class="bg-tape rounded-lg border border-line divide-y divide-line">
				{#if bucketTags.length === 0}
					<p class="p-4 text-sm text-dim">{m.categories_no_tags()}</p>
				{:else}
					{#each bucketTags as tag}
						<div class="p-3 flex items-center justify-between group">
							<div>
								<span class="text-sm text-ledger">{tag.name}</span>
								{#if tag.is_system}<span class="text-xs text-dim ml-2">{m.categories_system()}</span>{/if}
							</div>
							<div class="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
								<button onclick={() => openEdit(tag)} class="text-xs text-dim hover:text-phosphor px-2">{m.categories_edit()}</button>
								{#if !tag.is_system}
									<button onclick={() => startDelete(tag)} class="text-xs text-dim hover:text-debit px-2">{m.categories_delete()}</button>
								{/if}
							</div>
						</div>
					{/each}
				{/if}
			</div>
		</section>
	{/each}
</div>

<Modal bind:open={showForm} title={editing ? m.categories_edit_tag() : m.categories_add_tag_modal()}>
	<div class="space-y-4">
		<Input label={m.categories_name()} bind:value={formName} placeholder={m.categories_name_placeholder()} />
		<Select label={m.categories_bucket()} bind:value={formBucketId} options={bucketOptions} />
		<div class="flex justify-end gap-2 pt-2">
			<Button variant="ghost" onclick={() => showForm = false}>{m.common_cancel()}</Button>
			<Button onclick={saveTag}>{editing ? m.categories_save() : m.categories_create()}</Button>
		</div>
	</div>
</Modal>

{#if confirmDelete}
	<Modal open={true} title={m.categories_delete_confirm_title()}>
		<div class="space-y-4">
			<p class="text-sm text-dim">
				{#if affectedCount > 0}
					{m.categories_delete_referenced({ count: affectedCount })}
				{:else}
					{m.categories_delete_confirm_body()}
				{/if}
			</p>
			{#if affectedCount > 0}
				<Select label={m.categories_action()} bind:value={deleteOption} options={mergeTargetOptions(confirmDelete.id)} />
			{/if}
			<div class="flex justify-end gap-2 pt-2">
				<Button variant="ghost" onclick={() => confirmDelete = null}>{m.common_cancel()}</Button>
				<Button variant="danger" onclick={doDelete}>{m.common_delete()}</Button>
			</div>
		</div>
	</Modal>
{/if}
