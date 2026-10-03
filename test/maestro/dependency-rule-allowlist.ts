export interface DependencyRuleAllowlistEntry {
	/** Repo-relative importing file path, for example pi-extension/subagents/index.ts. */
	importer: string;
	/** Exact module specifier text as written in the importing file. */
	specifier: string;
	reason: string;
	/** Task that removes this temporary exception; all entries must be gone by Task 18. */
	removalTask: string;
}

export const ALLOWLIST: readonly DependencyRuleAllowlistEntry[] = [
	{
		importer: "maestro/adapters/pi/pi-harness-adapter.ts",
		specifier: "../../../pi-extension/subagents/runtime-routing.ts",
		reason:
			"The Pi adapter resolves authenticated runtime plans until routing splits into core and Pi adapter halves.",
		removalTask: "Task 15",
	},
	{
		importer: "maestro/adapters/pi/pi-harness-adapter.ts",
		specifier: "../../../pi-extension/subagents/activity.ts",
		reason:
			"The Pi adapter reads child activity until activity splits into core and Pi adapter halves.",
		removalTask: "Task 15",
	},
	{
		importer: "maestro/adapters/pi/pi-harness-adapter.ts",
		specifier: "../../../pi-extension/subagents/lifecycle.ts",
		reason:
			"The Pi adapter projects legacy lifecycle observations until lifecycle moves into core.",
		removalTask: "Task 14",
	},
	{
		importer: "maestro/adapters/pi/pi-harness-adapter.ts",
		specifier: "../../../pi-extension/subagents/wake.ts",
		reason:
			"The Pi adapter accepts the legacy wake registry until supervision moves into core.",
		removalTask: "Task 14",
	},
	{
		importer: "maestro/adapters/pi/pi-harness-adapter.ts",
		specifier: "../../../pi-extension/subagents/supervision.ts",
		reason:
			"The Pi adapter registers completion waits with legacy supervision until it moves into core.",
		removalTask: "Task 14",
	},
	{
		importer: "maestro/adapters/pi/pi-harness-adapter.ts",
		specifier: "../../../pi-extension/subagents/pane-config.ts",
		reason:
			"The Pi adapter accepts parsed legacy pane config until config moves into core.",
		removalTask: "Task 17",
	},
	{
		importer: "maestro/adapters/pi/pi-harness-adapter.ts",
		specifier: "../../../pi-extension/subagents/type-guards.ts",
		reason:
			"The Pi adapter reuses legacy session-header validation until the pure guard leaf moves into core.",
		removalTask: "Task 14",
	},
	{
		importer: "maestro/runtime/pi-run-session.ts",
		specifier: "../../pi-extension/subagents/lifecycle.ts",
		reason:
			"Pi composition hydrates lifecycle and gates delivery until the pure lifecycle move.",
		removalTask: "Task 14",
	},
	{
		importer: "maestro/runtime/pi-run-session.ts",
		specifier: "../../pi-extension/subagents/wake.ts",
		reason:
			"Production composition supplies the coordinator's single explicit wake registry until supervision moves.",
		removalTask: "Task 14",
	},
	{
		importer: "maestro/runtime/pi-run-session.ts",
		specifier: "../../pi-extension/subagents/supervision.ts",
		reason:
			"Production composition constructs the single legacy coordinator until supervision moves.",
		removalTask: "Task 14",
	},
	{
		importer: "maestro/runtime/pi-run-session.ts",
		specifier: "../../pi-extension/subagents/activity.ts",
		reason:
			"Pi composition consumes cheap activity-file hydration until the activity split.",
		removalTask: "Task 15",
	},
	{
		importer: "maestro/runtime/pi-run-session.ts",
		specifier: "../../pi-extension/subagents/runtime-routing.ts",
		reason:
			"Pi composition consumes full validated plans and the plain registry port until routing moves.",
		removalTask: "Task 15",
	},
	{
		importer: "maestro/runtime/pi-run-session.ts",
		specifier: "../../pi-extension/subagents/pane-config.ts",
		reason:
			"Pi composition consumes durable pane configuration until config moves.",
		removalTask: "Task 17",
	},
	{
		importer: "pi-extension/subagents/index.ts",
		specifier: "../../maestro/adapters/pi/task-model-init.ts",
		reason:
			"The Pi host still owns the task-model init command until model config routing moves behind the core config boundary.",
		removalTask: "Task 17",
	},
	{
		importer: "pi-extension/subagents/index.ts",
		specifier: "../../maestro/adapters/pi/launch.ts",
		reason:
			"The Pi host still uses launch-operation types/defaults, dedicated worktree handoff and manifest/Git finalization helpers until worktree ownership moves behind the runtime seam.",
		removalTask: "Task 16",
	},
	{
		importer: "pi-extension/subagents/worktree-cleanup.ts",
		specifier: "../../maestro/adapters/pi/launch.ts",
		reason:
			"Legacy cleanup still uses worktree manifest helpers until worktree operations are extracted.",
		removalTask: "Task 16",
	},
	{
		importer: "pi-extension/subagents/worktree-cleanup.ts",
		specifier: "../../maestro/surfaces/herdr/herdr.ts",
		reason:
			"Legacy cleanup still uses Herdr operations directly until worktree operations are extracted.",
		removalTask: "Task 16",
	},
	{
		importer: "pi-extension/subagents/lifecycle.ts",
		specifier: "../../maestro/adapters/pi/completion.ts",
		reason:
			"Legacy lifecycle consumes completion results until lifecycle moves into core.",
		removalTask: "Task 14",
	},
	{
		importer: "maestro/adapters/pi/launch.ts",
		specifier: "../../../pi-extension/subagents/activity.ts",
		reason:
			"Moved Pi launch adapter temporarily reads child activity files until activity splits into core and Pi adapter halves.",
		removalTask: "Task 15",
	},
	{
		importer: "maestro/adapters/pi/launch.ts",
		specifier: "../../../pi-extension/subagents/lifecycle.ts",
		reason:
			"Moved Pi launch adapter temporarily creates legacy lifecycle records until lifecycle moves into core.",
		removalTask: "Task 14",
	},
	{
		importer: "maestro/adapters/pi/launch.ts",
		specifier: "../../../pi-extension/subagents/runtime-routing.ts",
		reason:
			"Moved Pi launch adapter temporarily consumes legacy runtime plans until routing splits into core and Pi adapter halves.",
		removalTask: "Task 15",
	},
	{
		importer: "maestro/adapters/pi/launch.ts",
		specifier: "../../../pi-extension/subagents/pane-config.ts",
		reason:
			"Moved Pi launch adapter temporarily loads legacy pane config until pane config moves behind the core config boundary.",
		removalTask: "Task 17",
	},
	{
		importer: "maestro/adapters/pi/launch.ts",
		specifier: "../../../pi-extension/subagents/type-guards.ts",
		reason:
			"Moved Pi launch adapter temporarily reuses legacy type guards until the pure guard leaf moves into core.",
		removalTask: "Task 14",
	},
	{
		importer: "maestro/adapters/pi/launch.ts",
		specifier: "../../surfaces/herdr/herdr-surface-provider.ts",
		reason:
			"Launch keeps provider-backed compatibility defaults for the staged worktree handoff; watched runs use explicit factory operations.",
		removalTask: "Task 16",
	},
	{
		importer: "maestro/adapters/pi/completion.ts",
		specifier: "../../../pi-extension/subagents/type-guards.ts",
		reason:
			"Moved Pi completion adapter temporarily reuses legacy type guards until the pure guard leaf moves into core.",
		removalTask: "Task 14",
	},
	{
		importer: "maestro/adapters/pi/session.ts",
		specifier: "../../../pi-extension/subagents/type-guards.ts",
		reason:
			"Moved Pi session adapter temporarily reuses legacy type guards until the pure guard leaf moves into core.",
		removalTask: "Task 14",
	},
	{
		importer: "maestro/adapters/pi/task-model-init.ts",
		specifier: "../../../pi-extension/subagents/model-config.ts",
		reason:
			"Moved task-model init adapter temporarily reads legacy model config types until config moves behind the core boundary.",
		removalTask: "Task 17",
	},
	{
		importer: "maestro/adapters/pi/child/subagent-done.ts",
		specifier: "../../../../pi-extension/subagents/activity.ts",
		reason:
			"Moved child extension temporarily writes legacy activity files until activity splits into core and Pi adapter halves.",
		removalTask: "Task 15",
	},
	{
		importer: "maestro/adapters/pi/child/subagent-done.ts",
		specifier: "../../../../pi-extension/subagents/type-guards.ts",
		reason:
			"Moved child extension temporarily reuses legacy type guards until the pure guard leaf moves into core.",
		removalTask: "Task 14",
	},
	{
		importer: "maestro/surfaces/herdr/herdr.ts",
		specifier: "../../../pi-extension/subagents/type-guards.ts",
		reason:
			"Moved Herdr driver temporarily reuses legacy type guards until the pure guard leaf moves into core.",
		removalTask: "Task 14",
	},
	{
		importer: "maestro/surfaces/herdr/herdr-surface-provider.ts",
		specifier: "../../../pi-extension/subagents/pane-config.ts",
		reason:
			"HerdrSurfaceProvider receives the parsed legacy pane config until pane config moves behind the surface boundary.",
		removalTask: "Task 17",
	},
];
