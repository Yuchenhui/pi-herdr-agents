import type {
	CreateSurfaceOptions,
	CreateWorktreeSurfaceOptions,
	SurfaceInfo,
	SurfaceProcessInfo,
	SurfaceProvider,
	WorktreeSurface,
	WorktreeSurfaceInfo,
} from "../../core/surface-provider.ts";
import type { PaneInspection, SurfaceHandle } from "../../core/types.ts";
import type { PaneConfig } from "../../../pi-extension/subagents/pane-config.ts";
import {
	closeHerdrSurface,
	createHerdrGroupedSurface,
	createHerdrSurface,
	createHerdrSurfaceSplit,
	createHerdrWorktree,
	focusHerdrWorkspace,
	getHerdrPaneProcessInfoAsync,
	inspectHerdrPane,
	isHerdrAvailable,
	listHerdrPanes,
	listHerdrWorktrees,
	readHerdrScreenAsync,
	removeHerdrWorktree,
	renameHerdrTab,
	renameHerdrWorkspace,
	sendHerdrCommand,
	sendHerdrKeys,
	waitForHerdrPaneAbsence,
	waitForHerdrShellReady,
} from "./herdr.ts";
import { runScriptInPane, terminalSetupHint } from "./terminal.ts";

export class HerdrSurfaceProvider implements SurfaceProvider {
	readonly name = "herdr";
	readonly #paneConfig: PaneConfig;

	constructor(options: { paneConfig: PaneConfig }) {
		this.#paneConfig = options.paneConfig;
	}

	isAvailable(): boolean {
		return isHerdrAvailable();
	}

	createSurface(opts: CreateSurfaceOptions): string {
		const placement = opts.placement ?? { kind: "grouped" };
		if (placement.kind === "grouped") {
			return createHerdrGroupedSurface(
				opts.name,
				opts.cwd,
				this.#paneConfig.maxPerTab,
				this.#paneConfig.direction,
			);
		}
		if (placement.kind === "split") {
			return createHerdrSurfaceSplit(opts.name, placement.direction, opts.cwd);
		}
		return createHerdrSurface(opts.name, opts.cwd);
	}

	runCommand(surfaceId: string, command: string): void {
		sendHerdrCommand(surfaceId, command);
	}

	runScript(
		surfaceId: string,
		command: string,
		options: { scriptPath: string; scriptPreamble: string },
	): string {
		return runScriptInPane(surfaceId, command, options);
	}

	readScreen(surfaceId: string, lines?: number): Promise<string> {
		return readHerdrScreenAsync(surfaceId, lines);
	}

	closeSurface(surfaceId: string): void {
		closeHerdrSurface(surfaceId);
	}

	async listSurfaces(): Promise<SurfaceInfo[]> {
		const panes = await listHerdrPanes();
		if (panes === null) throw new Error("Unable to list Herdr panes");
		return panes.map((pane) => {
			const surface: SurfaceInfo = { id: pane.paneId };
			if (pane.name) surface.name = pane.name;
			if (pane.cwd) surface.cwd = pane.cwd;
			if (pane.tabId) surface.group = pane.tabId;
			surface.workspaceId = pane.workspaceId;
			return surface;
		});
	}

	attachSurface(id: string): SurfaceHandle {
		return {
			id,
			runCommand: (command) => this.runCommand(id, command),
			readScreen: (lines) => this.readScreen(id, lines),
			sendKeys: (keys) => this.sendKeys(id, keys),
			close: () => this.closeSurface(id),
		};
	}

	createWorktreeSurface(opts: CreateWorktreeSurfaceOptions): WorktreeSurface {
		const worktree = createHerdrWorktree(
			opts.name,
			opts.cwd,
			opts.branch,
			opts.base,
		);
		return {
			path: worktree.path,
			branch: worktree.branch,
			workspaceId: worktree.workspaceId,
			surfaceId: worktree.paneId,
		};
	}

	removeWorktreeSurface(workspaceId: string): void {
		removeHerdrWorktree(workspaceId);
	}

	setupHint(): string {
		return terminalSetupHint();
	}

	async inspectSurface(surfaceId: string): Promise<PaneInspection> {
		const result = await inspectHerdrPane(surfaceId);
		if (result.kind === "present") return { ...result, observedAt: Date.now() };
		return result;
	}

	sendKeys(surfaceId: string, keys: string): void {
		sendHerdrKeys(surfaceId, keys);
	}

	async getProcessInfo(surfaceId: string): Promise<SurfaceProcessInfo> {
		const info = await getHerdrPaneProcessInfoAsync(surfaceId);
		return {
			shellPid: info.shellPid,
			foregroundProcessGroupId: info.foregroundProcessGroupId,
			pids: [...info.pids],
			foregroundProcesses: info.foregroundProcesses.map((process) => ({
				...process,
				argv: process.argv ? [...process.argv] : undefined,
			})),
		};
	}

	async waitForShellReady(
		surfaceId: string,
		opts?: { timeoutMs?: number },
	): Promise<void> {
		await waitForHerdrShellReady(surfaceId, opts);
	}

	async waitForSurfaceAbsence(
		surfaceId: string,
		opts?: { timeoutMs?: number },
	): Promise<void> {
		const absent = await waitForHerdrPaneAbsence(surfaceId, opts);
		if (!absent) {
			throw new Error(
				`Herdr pane absence unconfirmed after ${opts?.timeoutMs ?? 5_000}ms: ${surfaceId}`,
			);
		}
	}

	async listWorktreeSurfaces(opts?: {
		cwd?: string;
		timeoutMs?: number;
	}): Promise<WorktreeSurfaceInfo[]> {
		return listHerdrWorktrees(opts?.cwd, opts?.timeoutMs).map((worktree) => ({
			...worktree,
		}));
	}

	focusWorkspace(workspaceId: string): void {
		focusHerdrWorkspace(workspaceId);
	}

	setTitle(target: "tab" | "workspace", title: string): void {
		if (target === "tab") renameHerdrTab(title);
		else renameHerdrWorkspace(title);
	}
}
