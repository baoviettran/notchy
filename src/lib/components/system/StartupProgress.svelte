<script lang="ts">
	import type { StartupStage } from '$lib/db';
	import * as m from '$lib/paraglide/messages';

	let { stage }: { stage: StartupStage } = $props();

	const stageMessages: Partial<Record<StartupStage, () => string>> = {
		checking: m.startup_checking,
		backing_up: m.startup_backing_up,
		migrating: m.startup_migrating,
		verifying: m.startup_verifying
	};
</script>

<!-- Only rendered while starting up (never for `ready` or `recovery_required`). -->
<div class="h-screen flex flex-col items-center justify-center bg-ink gap-3">
	<div class="figures-glow text-2xl animate-flash">▮▮▮</div>
	<p class="plate">{stageMessages[stage]?.() ?? m.startup_checking()}</p>
</div>
