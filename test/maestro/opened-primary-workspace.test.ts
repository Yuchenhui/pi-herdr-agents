import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { describe, it } from "node:test";
import {
	OPENED_PRIMARY_CHILD_CHECK_TIMEOUT_MS,
	OPENED_PRIMARY_REPORT_CALLS,
	OPENED_PRIMARY_REPORT_WORST_CASE_MS,
	OPENED_PRIMARY_SNAPSHOT_CALLS,
	OPENED_PRIMARY_SNAPSHOT_TIMEOUT_MS,
	clearOpenedPrimaryWorkspaceClaims,
	openedPrimaryWorkspaceClaims,
	rememberOpenedPrimaryWorkspace,
	type PrimaryWorkspaceClaim,
} from "../../maestro/core/opened-primary-workspace.ts";
import { removeContainedWorktree } from "../../maestro/core/worktree-cleanup.ts";
import { HerdrSurfaceProvider } from "../../maestro/surfaces/herdr/herdr-surface-provider.ts";
import {
	__herdrTest__,
	createHerdrWorktree,
	reportOpenedPrimaryWorkspace,
	shellHasChildProcesses,
} from "../../maestro/surfaces/herdr/herdr.ts";
import { cleanupFixture } from "../worktree-cleanup-fixture.ts";

const claim: PrimaryWorkspaceClaim = {
	workspaceId: "w1",
	repoKey: "/repo/.git",
	terminalId: "term-1",
	checkoutPath: "/repo",
};

function json(value: any): string {
	return JSON.stringify({ result: value });
}

interface ListedWorktreeFixture {
	branch: string;
	path: string;
	is_linked_worktree: boolean;
	open_workspace_id?: string;
}

interface WorktreeSourceFixture {
	repo_name: string;
	repo_key?: string;
	source_checkout_path?: string;
	source_workspace_id?: string;
}

function worktreeList(
	primary?: string,
	rows: ListedWorktreeFixture[] = [],
	repoKey: string | null = "/repo/.git",
	checkoutPath: string | null = "/repo",
): string {
	const source: WorktreeSourceFixture = { repo_name: "repo" };
	if (repoKey) source.repo_key = repoKey;
	if (checkoutPath) source.source_checkout_path = checkoutPath;
	const principal: ListedWorktreeFixture = {
		branch: "main",
		path: "/repo",
		is_linked_worktree: false,
	};
	if (primary) {
		source.source_workspace_id = primary;
		principal.open_workspace_id = primary;
	}
	return json({
		type: "worktree_list",
		source,
		worktrees: [principal, ...rows],
	});
}

function created(): string {
	return json({
		type: "worktree_created",
		workspace: { workspace_id: "w2" },
		root_pane: { pane_id: "w2:p1" },
		tab: { tab_id: "w2:t1" },
		worktree: { path: "/managed/repo/task", branch: "task" },
	});
}

interface WorkspaceFixtureOverride {
	label?: string | number;
	focused?: boolean | string;
}

function workspace(overrides: WorkspaceFixtureOverride = {}): string {
	return json({
		type: "workspace_info",
		workspace: {
			workspace_id: "w1",
			label: "repo",
			focused: false,
			tab_count: 1,
			worktree: {
				is_linked_worktree: false,
				repo_key: "/repo/.git",
				repo_name: "repo",
			},
			...overrides,
		},
	});
}

interface PaneFixtureOverride {
	cwd?: string;
	foreground_cwd?: string;
	terminal_id?: string;
}

function paneList(extra: PaneFixtureOverride = {}): string {
	return json({
		type: "pane_list",
		panes: [
			{
				pane_id: "w1:p1",
				workspace_id: "w1",
				terminal_id: "term-1",
				cwd: "/repo",
				foreground_cwd: "/repo",
				...extra,
			},
		],
	});
}

function processInfo(foreground = 100): string {
	return json({
		type: "pane_process_info",
		process_info: {
			pane_id: "w1:p1",
			shell_pid: 100,
			foreground_process_group_id: foreground,
		},
	});
}

function scriptedHerdr(queues: Record<string, string[]>) {
	const calls: string[][] = [];
	const timeouts: Array<number | undefined> = [];
	return {
		calls,
		timeouts,
		exec(args: string[], timeout?: number): string {
			calls.push(args);
			timeouts.push(timeout);
			if (args[0] === "tab" && args[1] === "rename")
				return json({ type: "ok" });
			const key = `${args[0]} ${args[1]}`;
			const queue = queues[key];
			const next = queue?.shift();
			if (next === undefined)
				throw new Error(`unexpected herdr ${args.join(" ")}`);
			if (next.startsWith("THROW "))
				throw new Error(next.slice("THROW ".length));
			return next;
		},
	};
}

function herdrCalls(calls: string[][]): string[] {
	return calls.map((args) => args.join(" "));
}

describe("opened primary workspace snapshots", () => {
	it("claims the primary workspace only when create opened it", async () => {
		clearOpenedPrimaryWorkspaceClaims();
		try {
			const script = scriptedHerdr({
				"worktree list": [worktreeList(undefined), worktreeList("w1")],
				"worktree create": [created()],
				"pane list": [paneList()],
			});
			await __herdrTest__.withMockHerdrExec(script.exec, () => {
				const surface = createHerdrWorktree("task", "/repo", "task", "HEAD");
				assert.equal(surface.workspaceId, "w2");
				assert.deepEqual(surface.openedPrimaryWorkspace, claim);
				assert.deepEqual(openedPrimaryWorkspaceClaims(), [claim]);
				const snapshotTimeouts = script.calls.flatMap((args, index) =>
					(args[0] === "worktree" && args[1] === "list") ||
					(args[0] === "pane" && args[1] === "list")
						? [script.timeouts[index]]
						: [],
				);
				assert.deepEqual(snapshotTimeouts, [
					OPENED_PRIMARY_SNAPSHOT_TIMEOUT_MS,
					OPENED_PRIMARY_SNAPSHOT_TIMEOUT_MS,
					OPENED_PRIMARY_SNAPSHOT_TIMEOUT_MS,
				]);
			});
			assert.equal(OPENED_PRIMARY_SNAPSHOT_CALLS, 3);
			assert.equal(OPENED_PRIMARY_SNAPSHOT_TIMEOUT_MS, 10_000);
		} finally {
			clearOpenedPrimaryWorkspaceClaims();
		}
	});

	it("does not claim a primary workspace that was already open", async () => {
		clearOpenedPrimaryWorkspaceClaims();
		try {
			const script = scriptedHerdr({
				"worktree list": [worktreeList("w1")],
				"worktree create": [created()],
			});
			await __herdrTest__.withMockHerdrExec(script.exec, () => {
				const surface = createHerdrWorktree("task", "/repo", "task", "HEAD");
				assert.equal(surface.openedPrimaryWorkspace, undefined);
				assert.deepEqual(openedPrimaryWorkspaceClaims(), []);
				assert.deepEqual(
					herdrCalls(script.calls).filter((call) =>
						call.startsWith("worktree list"),
					),
					["worktree list --cwd /repo"],
				);
				assert.equal(
					script.calls.some((args) => args[0] === "pane"),
					false,
				);
			});
		} finally {
			clearOpenedPrimaryWorkspaceClaims();
		}
	});

	it("logs a snapshot failure and claims nothing", async () => {
		clearOpenedPrimaryWorkspaceClaims();
		const warnings: string[] = [];
		const original = console.warn;
		console.warn = (...args: any[]) => {
			warnings.push(args.map(String).join(" "));
		};
		try {
			const script = scriptedHerdr({
				"worktree list": ["THROW herdr timed out"],
				"worktree create": [created()],
			});
			await __herdrTest__.withMockHerdrExec(script.exec, () => {
				const surface = createHerdrWorktree("task", "/repo", "task", "HEAD");
				assert.equal(surface.workspaceId, "w2");
				assert.equal(surface.openedPrimaryWorkspace, undefined);
			});
			assert.deepEqual(openedPrimaryWorkspaceClaims(), []);
			assert.deepEqual(warnings, [
				"pi-herdr-agents: opened primary workspace before snapshot failed: herdr timed out",
			]);
			assert.equal(
				herdrCalls(script.calls).filter((call) =>
					call.startsWith("worktree list"),
				).length,
				1,
			);
		} finally {
			console.warn = original;
			clearOpenedPrimaryWorkspaceClaims();
		}
	});

	it("logs an after-snapshot failure and does not read a terminal", async () => {
		clearOpenedPrimaryWorkspaceClaims();
		const warnings: string[] = [];
		const original = console.warn;
		console.warn = (...args: any[]) => {
			warnings.push(args.map(String).join(" "));
		};
		try {
			const script = scriptedHerdr({
				"worktree list": [worktreeList(undefined), "THROW list failed"],
				"worktree create": [created()],
			});
			await __herdrTest__.withMockHerdrExec(script.exec, () => {
				assert.equal(
					createHerdrWorktree("task", "/repo", "task", "HEAD")
						.openedPrimaryWorkspace,
					undefined,
				);
			});
			assert.match(warnings[0] ?? "", /after snapshot failed: list failed/);
			assert.equal(
				script.calls.some((args) => args[0] === "pane"),
				false,
			);
			assert.deepEqual(openedPrimaryWorkspaceClaims(), []);
		} finally {
			console.warn = original;
			clearOpenedPrimaryWorkspaceClaims();
		}
	});

	it("claims nothing when the opened workspace has no terminal id", async () => {
		clearOpenedPrimaryWorkspaceClaims();
		try {
			const script = scriptedHerdr({
				"worktree list": [worktreeList(undefined), worktreeList("w1")],
				"worktree create": [created()],
				"pane list": [
					json({
						type: "pane_list",
						panes: [{ pane_id: "w1:p1", workspace_id: "w1", cwd: "/repo" }],
					}),
				],
			});
			await __herdrTest__.withMockHerdrExec(script.exec, () => {
				assert.equal(
					createHerdrWorktree("task", "/repo", "task", "HEAD")
						.openedPrimaryWorkspace,
					undefined,
				);
			});
			assert.deepEqual(openedPrimaryWorkspaceClaims(), []);
		} finally {
			clearOpenedPrimaryWorkspaceClaims();
		}
	});
});

describe("reporting an opened primary workspace", () => {
	const untouched = {
		"worktree list": [worktreeList("w1")],
		"workspace get": [workspace(), workspace()],
		"pane list": [paneList(), paneList()],
		"pane process-info": [processInfo(), processInfo()],
	};

	it("reports the close command and never closes the workspace", async () => {
		const script = scriptedHerdr({
			"worktree list": [...untouched["worktree list"]],
			"workspace get": [...untouched["workspace get"]],
			"pane list": [...untouched["pane list"]],
			"pane process-info": [...untouched["pane process-info"]],
		});
		const children: number[] = [];
		await __herdrTest__.withMockHerdrExec(script.exec, () => {
			const report = reportOpenedPrimaryWorkspace(
				"/repo",
				[claim],
				30_000,
				(pid) => {
					children.push(pid);
					return false;
				},
			);
			assert.equal(
				report?.note,
				"w1 was opened by worktree creation; close it with herdr workspace close w1",
			);
			assert.deepEqual(report?.releasedClaims, [
				{
					workspaceId: "w1",
					repoKey: "/repo/.git",
					terminalId: "term-1",
				},
			]);
		});
		assert.equal(children.length, 2);
		assert.deepEqual(herdrCalls(script.calls), [
			"worktree list --cwd /repo",
			"workspace get w1",
			"pane list --workspace w1",
			"pane process-info --pane w1:p1",
			"workspace get w1",
			"pane list --workspace w1",
			"pane process-info --pane w1:p1",
		]);
		assert.equal(
			herdrCalls(script.calls).length + children.length,
			OPENED_PRIMARY_REPORT_CALLS,
		);
		assert.equal(OPENED_PRIMARY_REPORT_WORST_CASE_MS, 220_000);
		assert.equal(OPENED_PRIMARY_CHILD_CHECK_TIMEOUT_MS, 5_000);
		assert.ok(script.timeouts.every((timeout) => timeout === 30_000));
		assert.equal(
			script.calls.some(
				(args) => args[0] === "workspace" && args[1] === "close",
			),
			false,
		);
	});

	it("re-checks workspace state immediately before reporting", async () => {
		const script = scriptedHerdr({
			"worktree list": [worktreeList("w1")],
			"workspace get": [workspace(), workspace({ focused: true })],
			"pane list": [paneList(), paneList()],
			"pane process-info": [processInfo(), processInfo()],
		});
		await __herdrTest__.withMockHerdrExec(script.exec, () => {
			const report = reportOpenedPrimaryWorkspace(
				"/repo",
				[claim],
				undefined,
				() => false,
			);
			assert.equal(report?.note, undefined);
			assert.deepEqual(report?.releasedClaims, []);
		});
		assert.equal(
			script.calls.filter(
				(args) => args[0] === "workspace" && args[1] === "get",
			).length,
			2,
		);
		assert.equal(
			script.calls.some((args) => args[1] === "close"),
			false,
		);
	});

	for (const [name, queues] of [
		[
			"label is missing",
			{ "workspace get": [workspace({ label: undefined })] },
		],
		["label is not a string", { "workspace get": [workspace({ label: 1 })] }],
		[
			"focused is missing",
			{ "workspace get": [workspace({ focused: undefined })] },
		],
		[
			"focused is not a boolean",
			{ "workspace get": [workspace({ focused: "false" })] },
		],
		[
			"foreground_cwd is missing",
			{
				"workspace get": [workspace()],
				"pane list": [paneList({ foreground_cwd: undefined })],
			},
		],
		[
			"terminal_id is missing",
			{
				"workspace get": [workspace()],
				"pane list": [paneList({ terminal_id: undefined })],
			},
		],
		[
			"cwd is missing",
			{
				"workspace get": [workspace()],
				"pane list": [paneList({ cwd: undefined })],
			},
		],
	] as const) {
		it(`fails closed when ${name}`, async () => {
			const script = scriptedHerdr({
				"worktree list": [worktreeList("w1")],
				"workspace get": [...queues["workspace get"]],
				"pane list": "pane list" in queues ? [...queues["pane list"]] : [],
				"pane process-info": [],
			});
			await __herdrTest__.withMockHerdrExec(script.exec, () => {
				const report = reportOpenedPrimaryWorkspace(
					"/repo",
					[claim],
					undefined,
					() => false,
				);
				assert.equal(report?.note, undefined);
			});
			assert.equal(
				script.calls.some((args) => args[1] === "close"),
				false,
			);
		});
	}

	it("ignores claims of other repositories", async () => {
		const script = scriptedHerdr({
			"worktree list": [worktreeList("w1")],
		});
		await __herdrTest__.withMockHerdrExec(script.exec, () => {
			assert.equal(
				reportOpenedPrimaryWorkspace("/repo", [
					{ ...claim, repoKey: "/other/.git" },
				]),
				undefined,
			);
		});
		assert.deepEqual(herdrCalls(script.calls), ["worktree list --cwd /repo"]);
	});

	it("does not report while another linked worktree workspace is open", async () => {
		const script = scriptedHerdr({
			"worktree list": [
				worktreeList("w1", [
					{
						branch: "other",
						path: "/managed/repo/other",
						is_linked_worktree: true,
						open_workspace_id: "w7",
					},
				]),
			],
		});
		await __herdrTest__.withMockHerdrExec(script.exec, () => {
			const report = reportOpenedPrimaryWorkspace(
				"/repo",
				[claim],
				undefined,
				() => false,
			);
			assert.equal(report?.note, undefined);
			assert.deepEqual(report?.releasedClaims, []);
		});
		assert.equal(
			script.calls.some((args) => args[0] === "workspace"),
			false,
		);
	});

	it("asks the Herdr provider, which still never closes", async () => {
		const script = scriptedHerdr({
			"worktree list": [worktreeList("w1"), worktreeList("w1")],
			"workspace get": [workspace(), workspace()],
			"pane list": [paneList(), paneList()],
			"pane process-info": [processInfo(), processInfo()],
		});
		const provider = new HerdrSurfaceProvider({
			paneConfig: { mode: "tab", direction: "right", maxPerTab: 4 },
		});
		await __herdrTest__.withMockHerdrExec(script.exec, () => {
			const report = provider.reportOpenedPrimaryWorkspace({
				sourceRepo: "/repo",
				claims: [claim],
				timeoutMs: 30_000,
			});
			assert.match(report?.note ?? "", /herdr workspace close w1/);
		});
		assert.equal(
			script.calls.some((args) => args[1] === "close"),
			false,
		);
	});
});

describe("explicit removal reports a live claim only", () => {
	it("includes the report and forgets the claim without closing", async () => {
		clearOpenedPrimaryWorkspaceClaims();
		try {
			rememberOpenedPrimaryWorkspace(claim);
			const fixture = cleanupFixture();
			fixture.operations.reportOpenedPrimaryWorkspace = (source, claims) => {
				assert.equal(source, "/repo");
				assert.deepEqual(claims, [claim]);
				return {
					note: "w1 was opened by worktree creation; close it with herdr workspace close w1",
					repoKey: claim.repoKey,
					releasedClaims: [
						{
							workspaceId: claim.workspaceId,
							repoKey: claim.repoKey,
							terminalId: claim.terminalId,
						},
					],
				};
			};
			const result = await removeContainedWorktree(fixture.input);
			assert.equal(result.status, "removed");
			assert.match(
				result.message,
				/w1 was opened by worktree creation; close it with herdr workspace close w1/,
			);
			assert.doesNotMatch(result.message, /Closed primary workspace/);
			assert.deepEqual(openedPrimaryWorkspaceClaims(), []);
			assert.deepEqual(fixture.calls, [
				"git:/repo:/managed/repo/task",
				"prune:/repo",
			]);
		} finally {
			clearOpenedPrimaryWorkspaceClaims();
		}
	});

	it("ignores a manifest claim after restart when this process did not record it", async () => {
		clearOpenedPrimaryWorkspaceClaims();
		try {
			const fixture = cleanupFixture();
			fixture.operations.readManifests = () => [
				{
					file: "/manifest.json",
					value: {
						branch: "task",
						path: "/managed/repo/task",
						state: "ready_for_review",
						openedPrimaryWorkspaceId: "w1",
						openedPrimaryRepoKey: "/repo/.git",
						openedPrimaryTerminalId: "term-1",
						openedPrimaryCheckoutPath: "/repo",
					},
				},
			];
			fixture.operations.reportOpenedPrimaryWorkspace = () => {
				throw new Error("must not be called");
			};
			const result = await removeContainedWorktree(fixture.input);
			assert.equal(result.status, "removed", result.message);
			assert.doesNotMatch(result.message, /opened by worktree creation/);
		} finally {
			clearOpenedPrimaryWorkspaceClaims();
		}
	});

	it("reports a failed primary lookup as a warning after the checkout is gone", async () => {
		clearOpenedPrimaryWorkspaceClaims();
		try {
			rememberOpenedPrimaryWorkspace(claim);
			const fixture = cleanupFixture();
			fixture.operations.reportOpenedPrimaryWorkspace = () => {
				throw new Error("herdr unavailable");
			};
			const result = await removeContainedWorktree(fixture.input);
			assert.equal(result.status, "removed");
			assert.match(
				result.message,
				/Primary workspace report failed: herdr unavailable/,
			);
			assert.deepEqual(openedPrimaryWorkspaceClaims(), [claim]);
		} finally {
			clearOpenedPrimaryWorkspaceClaims();
		}
	});
});

describe("shell child check", () => {
	it("detects child processes of a real shell with pgrep", async () => {
		const child = spawn("sleep", ["30"], { stdio: "ignore" });
		try {
			assert.equal(Number.isInteger(child.pid), true);
			assert.equal(shellHasChildProcesses(process.pid), true);
			assert.equal(shellHasChildProcesses(child.pid ?? 0), false);
		} finally {
			child.kill();
		}
	});
});
