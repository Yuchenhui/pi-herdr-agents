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
		importer: "pi-extension/subagents/index.ts",
		specifier: "../../maestro/surfaces/herdr/herdr-surface-provider.ts",
		reason:
			"Runtime composition constructs the production Herdr surface provider until provider construction moves out of the Pi host.",
		removalTask: "Task 13",
	},
	{
		importer: "pi-extension/subagents/launch.ts",
		specifier: "../../maestro/surfaces/herdr/herdr-surface-provider.ts",
		reason:
			"Launch keeps provider-backed default operations for compatibility until runtime composition owns the production provider.",
		removalTask: "Task 13",
	},
	{
		importer: "pi-extension/subagents/worktree-cleanup.ts",
		specifier: "../../maestro/surfaces/herdr/herdr.ts",
		reason:
			"Legacy cleanup still uses Herdr operations directly until worktree operations are extracted.",
		removalTask: "Task 16",
	},
	{
		importer: "maestro/surfaces/herdr/herdr.ts",
		specifier: "../../../pi-extension/subagents/type-guards.ts",
		reason:
			"Moved Herdr driver temporarily reuses legacy type guards until config and type guards move behind the core boundary.",
		removalTask: "Task 17",
	},
	{
		importer: "maestro/surfaces/herdr/herdr-surface-provider.ts",
		specifier: "../../../pi-extension/subagents/pane-config.ts",
		reason:
			"HerdrSurfaceProvider receives the parsed legacy pane config until pane config moves behind the surface boundary.",
		removalTask: "Task 17",
	},
];
