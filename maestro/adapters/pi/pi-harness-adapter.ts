import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type {
	HarnessAdapter,
	ResumeOptions,
	SpawnOptions,
} from "../../core/harness-adapter.ts";
import type {
	AgentHandle,
	AgentState,
	CompletionEvidence,
} from "../../core/types.ts";
import type {
	SurfaceProcessInfo,
	SurfaceProvider,
} from "../../core/surface-provider.ts";
import { readSubagentActivityFile } from "./activity-file.ts";
import {
	markCompletionDetected,
	markInterruptRequested,
	observeActivity,
	observePaneInspection,
} from "../../core/lifecycle.ts";
import { isNonEmptyString } from "../../core/config/type-guards.ts";
import type { PaneConfig } from "../../core/config/pane-config.ts";
import {
	isThinkingLevel,
	parseExactModelRef,
	resolveRuntimePlan,
	type ModelRegistryAdapter,
	type ParentRuntime,
	type ResolvedRuntimePlan,
} from "../../core/routing.ts";
import type { FileWakeRegistry } from "../../core/wake.ts";
import type { SupervisionCoordinator } from "../../core/supervision.ts";
import {
	isExpectedPiProcess,
	launchOperationsFromSurface,
	launchPiSubagent,
	type FreshPiLaunchRequest,
	type PiLaunchOperations,
	type PiRunningChild,
} from "./launch.ts";
import type { WorktreeOperations } from "../../core/worktree.ts";
import { waitForCompletion } from "./completion.ts";
import {
	appendPersistentDeliveryLedger,
	findObservedSessionRuntime,
	getNewEntries,
	inspectFinalAssistantMessage,
	readPersistentTaskEvents,
	readSubagentSessionPolicy,
	writePersistentTaskInbox,
} from "./session.ts";

export interface PiSpawnOptions extends SpawnOptions {
	/** Pi host normalization: retain validation/provenance and raw cwd/config origins.
	 * Presence selects this snapshot, including intentionally omitted agent/tools/cwd.
	 * Generic callers continue to resolve their role/runtime through the adapter.
	 */
	resolvedLaunch?: {
		runtimePlan: ResolvedRuntimePlan;
		agent?: string;
		cwd?: string;
		roleCwd?: string;
		tools?: string;
	};
	/** Preserve opaque host identities during the staged migration. Not the core task/session ID. */
	launchIdentity?: {
		id?: string;
		logicalId?: string;
		generationId?: string;
		taskId?: string;
	};
}
export interface PiHarnessAdapterOptions {
	surface: SurfaceProvider;
	paneConfig: PaneConfig;
	modelRegistry: ModelRegistryAdapter;
	parent: FreshPiLaunchRequest["parent"];
	/** Compatibility only; supervision owns its wake registry and registrations. */
	wake?: FileWakeRegistry;
	supervision: SupervisionCoordinator;
	/** The active parent's registry runtime can precede persisted model-change entries. */
	parentRuntime?: ParentRuntime;
	/** Optional launch-operation injection, keeping the real Pi protocol in unit tests. */
	operations?: PiLaunchOperations;
	worktreeOperations?: WorktreeOperations;
	/** Signals one Herdr-identified owned Pi process; injected by tests. */
	terminateProcess?(pid: number, sessionFile: string): void;
	/** Host process-table evidence for a retained worktree child's exit; injected by tests. */
	localProcesses?: LocalProcessProbe;
	/** Bound for confirming a retained worktree child's exit. Default: 5000ms. */
	killTimeoutMs?: number;
	/** Explicit local evidence/lifecycle bridge. The host still owns delivery and deduplication. */
	onObservation?(
		child: PiRunningChild,
		kind:
			| "local-evidence"
			| "pane"
			| "tick"
			| "completion"
			| "state"
			| "interrupt",
	): void;
}
/**
 * This host's process table, seen from the parent. Herdr enumerates only a
 * pane's foreground processes, so a suspended or backgrounded Pi is invisible
 * there; exit is proven only when no local process still carries the child's
 * exact `--session` argv. `shellVisible` shows the pane's shell is in this PID
 * namespace, so an empty owned list is evidence rather than a blind spot.
 * Throws when the process table cannot be read.
 */
export interface LocalProcessView {
	/** Local PIDs whose argv carries the child's exact `--session`. */
	owned: number[];
	shellVisible: boolean;
}
export type LocalProcessProbe = (
	sessionFile: string,
	shellPid: number,
) => LocalProcessView;

interface CompletionWait {
	controller: AbortController;
	promise: Promise<CompletionEvidence>;
	waiters: number;
}

/** Pi's existing launch and child-sidecar protocol behind the harness seam. */
export class PiHarnessAdapter implements HarnessAdapter {
	readonly name = "pi";
	private readonly options: PiHarnessAdapterOptions;
	private readonly operations: PiLaunchOperations;
	private readonly children = new Map<string, PiRunningChild>();
	private readonly evidence = new Map<string, CompletionEvidence>();
	private readonly waits = new Map<string, CompletionWait>();
	constructor(options: PiHarnessAdapterOptions) {
		this.options = options;
		this.operations =
			options.operations ??
			launchOperationsFromSurface(
				options.surface,
				options.paneConfig,
				options.worktreeOperations,
			);
	}
	isAvailable(): boolean {
		try {
			execFileSync("pi", ["--version"], { stdio: "ignore" });
			return true;
		} catch {
			return false;
		}
	}
	async spawn(opts: PiSpawnOptions): Promise<AgentHandle> {
		this.rejectEnvironment(opts.env);
		if (opts.worktree && !opts.worktreeRequest)
			throw new Error(
				"Pi requires an unprovisioned worktreeRequest; it owns worktree acquisition",
			);
		// One ordinary attempt per spawn; the run session owns retries and their evidence.
		if (opts.worktreeRequest && opts.runtime?.fallbacks?.length)
			throw new Error(
				"Model fallbacks are not supported for worktree subagents.",
			);
		if (
			opts.session?.parentSessionId &&
			opts.session.parentSessionId !== this.options.parent.sessionId
		)
			throw new Error(
				"Pi session parent identity does not match the launch parent",
			);
		const defaults = opts.role.defaults;
		const persistent =
			opts.behavior?.persistent ?? defaults?.persistent ?? false;
		const autoExit = persistent
			? false
			: (opts.behavior?.autoExit ?? defaults?.autoExit ?? false);
		const interactive =
			opts.behavior?.interactive ??
			opts.interactive ??
			(persistent ? false : (defaults?.interactive ?? !autoExit));
		const denied = new Set([
			...(defaults?.denyTools ?? []),
			...(opts.behavior?.denyTools ?? []),
		]);
		if (defaults?.spawning === false)
			for (const name of [
				"subagent",
				"subagent_interrupt",
				"subagent_cancel",
				"subagent_send",
				"subagent_stop",
				"subagents_list",
				"subagent_resume",
			])
				denied.add(name);
		const resolved = opts.resolvedLaunch;
		const cwd = resolved ? resolved.cwd : opts.cwd;
		const roleCwd = resolved ? resolved.roleCwd : defaults?.cwd;
		const id = opts.launchIdentity?.id ?? randomUUID();
		const taskId = opts.launchIdentity?.taskId ?? randomUUID();
		const child = await launchPiSubagent(
			{
				kind: "fresh",
				id,
				name: opts.name,
				task: opts.task,
				agent: resolved ? resolved.agent : opts.role.name,
				cwd,
				worktree: opts.worktreeRequest,
				// An omitted override must not force lineage-only/default fork to standalone.
				fork: opts.session
					? opts.session.mode === "fork"
						? true
						: opts.session.mode === "standalone"
							? false
							: undefined
					: undefined,
				surface: opts.surface?.id,
				parent: this.options.parent,
				runtimePlan:
					resolved?.runtimePlan ??
					resolveRuntimePlan(
						opts.runtime ?? {},
						defaults ?? {},
						this.parentRuntime(opts),
						this.options.modelRegistry,
					),
				behavior: {
					tools: resolved
						? resolved.tools
						: (opts.tools ?? opts.role.allowedTools).join(","),
					cwd: roleCwd,
					skills: (opts.behavior?.skills ?? defaults?.skills)?.join(","),
					deniedTools: [...denied],
					autoExit,
					interactive,
					persistent,
					logicalId: opts.launchIdentity?.logicalId ?? id,
					generationId: opts.launchIdentity?.generationId ?? randomUUID(),
					taskId,
					identity: opts.systemPrompt ?? opts.role.systemPrompt,
					systemPromptMode:
						opts.behavior?.systemPromptMode ?? defaults?.systemPromptMode,
					sessionMode:
						opts.session?.mode ?? defaults?.sessionMode ?? "standalone",
				},
			},
			this.operations,
		);
		if (persistent) {
			const policy = readSubagentSessionPolicy(child.sessionFile);
			if (policy.version !== 2)
				throw new Error("Persistent launch policy was not written as v2.");
			Object.assign(child, {
				persistent: true,
				logicalId: policy.logicalId,
				generationId: policy.generationId,
				policyHash: policy.policyHash,
				policyTools: policy.tools,
				policyDeniedTools: policy.deniedTools,
				tasksCompleted: 0,
				taskId,
				inboxSequence: 0,
				observedTaskEvents: 0,
			});
			appendPersistentDeliveryLedger(child.sessionFile, {
				task: taskId,
				outcome: "dispatched",
				generation: policy.generationId,
				logicalId: policy.logicalId,
				policyHash: policy.policyHash,
			});
		}
		const rawCwd = cwd ?? roleCwd;
		const cwdBase =
			cwd == null && roleCwd != null
				? (this.options.parent.agentDir ??
					process.env.PI_CODING_AGENT_DIR ??
					join(homedir(), ".pi", "agent"))
				: (this.options.parent.invocationCwd ?? this.options.parent.cwd);
		return this.track(
			child,
			rawCwd
				? rawCwd.startsWith("/")
					? rawCwd
					: join(cwdBase, rawCwd)
				: this.options.parent.cwd,
		);
	}
	async resume(opts: ResumeOptions): Promise<AgentHandle> {
		this.rejectEnvironment(opts.env);
		if (opts.surface)
			throw new Error("Pi public resume owns its new ordinary pane");
		if (opts.tools)
			throw new Error(
				"Pi resume restores saved tools; tool overrides are not supported",
			);
		const child = await launchPiSubagent(
			{
				kind: "resume",
				name: opts.name,
				sessionFile: opts.sessionId,
				message: opts.message,
				parent: this.options.parent,
				behavior: { autoExit: opts.autoExit },
			},
			this.operations,
		);
		const header = getNewEntries(child.sessionFile, 0).find(
			(entry) => entry.type === "session",
		);
		return this.track(
			child,
			isNonEmptyString(header?.cwd) ? header.cwd : process.cwd(),
		);
	}
	/** Temporary Pi-specific bridge for runtime migration; never infer task delivery from coarse state. */
	getRunningChild(handle: AgentHandle): PiRunningChild {
		const child = this.children.get(handle.id);
		if (
			!child ||
			handle.harness !== this.name ||
			handle.sessionId !== child.sessionFile
		)
			throw new Error(`Unknown Pi child ${handle.id}`);
		return child;
	}
	readPersistentEvents(handle: AgentHandle) {
		const child = this.getRunningChild(handle);
		return readPersistentTaskEvents(child.sessionFile).filter(
			(event) => event.generation === child.generationId,
		);
	}
	async getState(handle: AgentHandle): Promise<AgentState> {
		try {
			if (handle.harness !== this.name) return "unknown";
			if (this.evidence.has(this.runKey(handle))) return "done";
			const child = this.getRunningChild(handle);
			const read = readSubagentActivityFile(child.activityFile, child.id);
			let pane;
			try {
				pane = await this.options.surface.inspectSurface(child.surface);
			} catch {
				pane = { kind: "unavailable" as const };
			}
			child.lifecycle = observeActivity(
				observePaneInspection(child.lifecycle, pane, Date.now()),
				read,
				Date.now(),
			);
			this.options.onObservation?.(child, "state");
			if (pane.kind !== "present") return "unknown";
			switch (child.lifecycle.turn.kind) {
				case "active":
					return "working";
				case "blocked":
				case "waiting":
					return "blocked";
				case "starting":
					return "idle";
				default:
					return "unknown";
			}
		} catch {
			return "unknown";
		}
	}
	async interrupt(handle: AgentHandle): Promise<void> {
		const child = this.getRunningChild(handle);
		await this.options.surface.sendKeys(child.surface, "Escape");
		child.lifecycle = markInterruptRequested(child.lifecycle, Date.now());
		this.options.onObservation?.(child, "interrupt");
	}
	/** Resolves only with termination evidence; otherwise rejects (unconfirmed). */
	async kill(handle: AgentHandle): Promise<void> {
		const child = this.getRunningChild(handle);
		// A worktree root pane is the retained review workspace (Herdr refuses to
		// close it): stop only the owned Pi process and keep pane and checkout.
		if (child.worktree) return this.stopRetainedPi(child, child.worktree.path);
		let closeError: unknown;
		try {
			await this.options.surface.closeSurface(child.surface);
		} catch (error) {
			// Absence is still checked: a pane that is already gone is terminated.
			closeError = error;
		}
		try {
			await this.options.surface.waitForSurfaceAbsence(child.surface);
		} catch (error) {
			if (closeError === undefined) throw error;
			throw new Error(`${errorText(closeError)}; ${errorText(error)}`);
		}
	}
	private async stopRetainedPi(
		child: PiRunningChild,
		cwd: string,
	): Promise<void> {
		const owned = (info: SurfaceProcessInfo) =>
			info.foregroundProcesses.filter((candidate) =>
				isExpectedPiProcess(candidate, child.sessionFile, cwd),
			);
		// Confirmed by Herdr's pane being gone, or by Herdr showing no owned Pi in
		// the foreground and an idle retained shell AND this host's process table
		// holding no process with the child's session. Foreground absence alone is
		// never exit evidence: a suspended or backgrounded Pi is still alive.
		const stopped = async (): Promise<boolean | string> => {
			let info: SurfaceProcessInfo;
			try {
				info = await this.options.surface.getProcessInfo(child.surface);
			} catch (error) {
				const pane = await this.options.surface
					.inspectSurface(child.surface)
					.catch(() => undefined);
				return pane?.kind === "missing" || errorText(error);
			}
			if (
				owned(info).length > 0 ||
				info.shellPid === undefined ||
				info.foregroundProcessGroupId !== info.shellPid
			)
				return "owned Pi process is still in the pane foreground";
			let local: LocalProcessView;
			try {
				local = (this.options.localProcesses ?? inspectLocalProcesses)(
					child.sessionFile,
					info.shellPid,
				);
			} catch (error) {
				return `only foreground absence is known; this host's process table is unreadable: ${errorText(error)}`;
			}
			if (!local.shellVisible)
				return `only foreground absence is known; pane shell ${info.shellPid} is not visible in this host's process table`;
			if (local.owned.length > 0)
				return `owned Pi process ${local.owned.join(", ")} is still alive outside the pane foreground (suspended or backgrounded)`;
			return true;
		};
		// Providers may throw synchronously or reject; both mean "unknown".
		const info = await (async () =>
			this.options.surface.getProcessInfo(child.surface))().catch(
			() => undefined,
		);
		const targets = info ? owned(info) : [];
		if (targets.length === 0) {
			const state = await stopped();
			if (state === true) return;
			throw new Error(
				`Owned Pi process not identified in retained worktree pane ${child.surface}: ${state}`,
			);
		}
		const terminate = this.options.terminateProcess ?? terminateOwnedPiProcess;
		for (const target of targets) terminate(target.pid, child.sessionFile);
		const timeoutMs = this.options.killTimeoutMs ?? 5_000;
		const deadline = Date.now() + timeoutMs;
		let state: boolean | string;
		do {
			await new Promise((resolve) => setTimeout(resolve, 50));
			state = await stopped();
			if (state === true) return;
		} while (Date.now() < deadline);
		throw new Error(
			`Owned Pi process exit unconfirmed after ${timeoutMs}ms in retained worktree pane ${child.surface}: ${state}`,
		);
	}
	async readOutput(handle: AgentHandle, lines?: number): Promise<string> {
		return this.options.surface.readScreen(
			this.getRunningChild(handle).surface,
			lines,
		);
	}
	exitCode(handle: AgentHandle): number | undefined {
		return this.evidence.get(this.runKey(handle))?.exitCode;
	}
	async sendInput(handle: AgentHandle, text: string): Promise<void> {
		const child = this.getRunningChild(handle);
		if (!child.persistent)
			throw new Error("child is not a persistent specialist");
		const task = randomUUID();
		const facts = {
			task,
			generation: child.generationId!,
			logicalId: child.logicalId!,
			policyHash: child.policyHash!,
		};
		if (
			this.evidence.has(this.runKey(handle)) ||
			child.stopState ||
			child.taskId != null ||
			child.tasksCompleted == null
		) {
			appendPersistentDeliveryLedger(child.sessionFile, {
				...facts,
				outcome: "rejected-busy",
			});
			throw new Error(
				`Persistent specialist "${child.name}" is busy or stopped; task ${task} was rejected-busy. Resend after the pending result.`,
			);
		}
		writePersistentTaskInbox(
			child.sessionFile,
			(child.inboxSequence = (child.inboxSequence ?? 0) + 1),
			{ task, message: text },
		);
		child.taskId = task;
		appendPersistentDeliveryLedger(child.sessionFile, {
			...facts,
			outcome: "dispatched",
		});
	}
	async awaitCompletion(
		handle: AgentHandle,
		signal: AbortSignal,
	): Promise<CompletionEvidence> {
		if (signal.aborted)
			throw new Error("Aborted while waiting for subagent to finish");
		const key = this.runKey(handle);
		const recorded = this.evidence.get(key);
		if (recorded) return recorded;
		const child = this.getRunningChild(handle);
		let wait = this.waits.get(key);
		if (!wait || wait.controller.signal.aborted) {
			const controller = new AbortController();
			const registration = this.options.supervision.register(
				child.sessionFile,
				child.surface,
			);
			const next: CompletionWait = {
				controller,
				waiters: 0,
				promise: waitForCompletion(controller.signal, {
					intervalMs: 1000,
					sessionFile: child.sessionFile,
					waitForNextCheck: registration.wait,
					readTerminalTail: async () =>
						this.options.surface.readScreen(child.surface, 5),
					inspectPane: registration.inspectPane,
					onLocalEvidence: () =>
						this.options.onObservation?.(child, "local-evidence"),
					onPaneInspection: (pane, at) => {
						child.lifecycle = observePaneInspection(child.lifecycle, pane, at);
						this.options.onObservation?.(child, "pane");
					},
					onTick: () => {
						this.options.onObservation?.(child, "tick");
					},
				})
					.then((result) => {
						const final = existsSync(child.sessionFile)
							? inspectFinalAssistantMessage(
									getNewEntries(child.sessionFile, 0),
								)
							: undefined;
						const evidence: CompletionEvidence = {
							...result,
							sessionRef: child.sessionFile,
						};
						if (final && (final.text != null || final.stopReason)) {
							evidence.finalMessage = {
								text: final.text ?? "",
								stopReason: final.stopReason,
							};
							if (final.stopReason === "error" && result.errorMessage)
								evidence.finalMessage.errorMessage = result.errorMessage;
						}
						if (child.worktree)
							evidence.worktree =
								this.worktreeOperations().captureWorktreeHandoff(
									child.worktree,
								);
						this.evidence.set(key, evidence);
						child.lifecycle = markCompletionDetected(
							child.lifecycle,
							result,
							Date.now(),
						);
						this.options.onObservation?.(child, "completion");
						return evidence;
					})
					.finally(() => {
						registration.unregister();
						if (this.waits.get(key) === next) this.waits.delete(key);
					}),
			};
			this.waits.set(key, next);
			wait = next;
		}
		return this.joinWait(wait, signal);
	}
	private worktreeOperations(): WorktreeOperations {
		const operations = this.operations.worktree;
		if (!operations) throw new Error("Worktree operations are unavailable");
		return operations;
	}
	private joinWait(
		wait: CompletionWait,
		signal: AbortSignal,
	): Promise<CompletionEvidence> {
		wait.waiters++;
		const abort = () =>
			rejectWait(new Error("Aborted while waiting for subagent to finish"));
		let rejectWait!: (error: Error) => void;
		return new Promise<CompletionEvidence>((resolve, reject) => {
			rejectWait = reject;
			signal.addEventListener("abort", abort, { once: true });
			wait.promise.then(resolve, reject);
		}).finally(() => {
			// Each consumer owns only its cancellation, never another consumer's wait.
			signal.removeEventListener("abort", abort);
			wait.waiters--;
			if (wait.waiters === 0) wait.controller.abort();
		});
	}
	private runKey(handle: Pick<AgentHandle, "id" | "sessionId">): string {
		// Legacy fallback retries reuse the opaque child ID, but create a new Pi session.
		return JSON.stringify([handle.id, handle.sessionId]);
	}
	private track(child: PiRunningChild, cwd: string): AgentHandle {
		this.children.set(child.id, child);
		const handle: AgentHandle = {
			id: child.id,
			name: child.name,
			role: child.agent ?? "",
			harness: this.name,
			cwd: child.worktree?.path ?? cwd,
			startedAt: child.startTime,
			sessionId: child.sessionFile,
			surfaceId: child.surface,
		};
		if (child.worktree)
			handle.worktree = {
				id: child.id,
				owner: "maestro",
				branch: child.worktree.branch,
				baseRef: child.worktree.baseRef,
				baseSha: child.worktree.baseSha,
				createdAt: child.startTime,
				path: child.worktree.path,
				state: "running",
				manifestFile: child.worktree.manifestFile,
			};
		return handle;
	}
	private parentRuntime(opts: SpawnOptions): ParentRuntime {
		if (this.options.parentRuntime) return this.options.parentRuntime;
		const observed = existsSync(this.options.parent.sessionFile)
			? findObservedSessionRuntime(
					getNewEntries(this.options.parent.sessionFile, 0),
				)
			: {};
		if (
			observed.provider &&
			observed.modelId &&
			observed.thinking &&
			isThinkingLevel(observed.thinking)
		)
			return {
				provider: observed.provider,
				modelId: observed.modelId,
				thinking: observed.thinking,
			};
		const model = parseExactModelRef(
			opts.runtime?.model ?? opts.role.defaults?.model ?? "",
		);
		const thinking = opts.runtime?.thinking ?? opts.role.defaults?.thinking;
		if (model && thinking) return { ...model, thinking };
		throw new Error(
			"Pi launch requires the active parent runtime or explicit model and thinking",
		);
	}
	private rejectEnvironment(env: Record<string, string> | undefined): void {
		if (env && Object.keys(env).length)
			throw new Error(
				"The existing Pi launch protocol does not support per-child environment overrides",
			);
	}
}

function errorText(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

// Herdr reports the PID; on Linux, signal it only if this host's process table
// names the same owned session, so a PID namespace mismatch never misfires.
function terminateOwnedPiProcess(pid: number, sessionFile: string): void {
	try {
		if (process.platform === "linux") {
			const argv = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0");
			const index = argv.indexOf("--session");
			if (index < 0 || argv[index + 1] !== sessionFile)
				throw new Error(
					`Process ${pid} on this host is not the owned Pi session; not signalled`,
				);
		}
		process.kill(pid, "SIGTERM");
	} catch (error) {
		// SAFETY: fs and process.kill failures are Node errors with an optional code.
		const code = (error as NodeJS.ErrnoException).code;
		// Already gone: the exit evidence check decides, never this exception.
		if (code === "ENOENT" || code === "ESRCH") return;
		throw error;
	}
}

function ownsSession(argv: readonly string[], sessionFile: string): boolean {
	const index = argv.indexOf("--session");
	return index >= 0 && argv[index + 1] === sessionFile;
}

// Linux reads exact NUL-separated argv from /proc; zombies have an empty
// cmdline and count as exited. Elsewhere `ps` lists space-joined commands.
export function inspectLocalProcesses(
	sessionFile: string,
	shellPid: number,
): LocalProcessView {
	if (process.platform === "linux") {
		const owned: number[] = [];
		for (const name of readdirSync("/proc")) {
			if (!/^\d+$/.test(name)) continue;
			let argv: string[];
			try {
				argv = readFileSync(`/proc/${name}/cmdline`, "utf8").split("\0");
			} catch (error) {
				// SAFETY: fs failures are Node errors with an optional code.
				const code = (error as NodeJS.ErrnoException).code;
				// Exited mid-scan, or another user's process (never the owned child).
				if (code === "ENOENT" || code === "ESRCH" || code === "EACCES")
					continue;
				throw error;
			}
			if (ownsSession(argv, sessionFile)) owned.push(Number(name));
		}
		return { owned, shellVisible: existsSync(`/proc/${shellPid}`) };
	}
	const rows = execFileSync("ps", ["-A", "-o", "pid=", "-o", "command="], {
		encoding: "utf8",
		timeout: 5_000,
	});
	const owned: number[] = [];
	let shellVisible = false;
	const marker = ` --session ${sessionFile}`;
	for (const row of rows.split("\n")) {
		const match = /^\s*(\d+)\s(.*)$/.exec(row);
		if (!match) continue;
		const pid = Number(match[1]);
		if (pid === shellPid) shellVisible = true;
		const command = match[2]!;
		const at = command.indexOf(marker);
		const next = command[at + marker.length];
		if (at >= 0 && (next === undefined || next === " ")) owned.push(pid);
	}
	return { owned, shellVisible };
}
