import type {
	HarnessAdapter,
	ResumeOptions,
	SpawnOptions,
} from "../core/harness-adapter.ts";
import type { SurfaceProvider } from "../core/surface-provider.ts";
import type {
	ActivityReadResult,
	AgentHandle,
	CompletionEvidence,
	LifecycleProjection,
	Role,
	RunResult,
	SubagentActivityState,
	SubagentLifecycle,
	Task,
	ThinkingLevel,
} from "../core/types.ts";
import { defaultRetainSurface } from "./surface-retention.ts";

// pi-herdr-agents extension
export interface RuntimeCandidate {
	model: string;
	thinking: ThinkingLevel;
}
// pi-herdr-agents extension
export type DeliveryDecision = "delivered" | "suppressed";
// pi-herdr-agents extension
export interface RunObservation {
	kind:
		| "local-evidence"
		| "pane"
		| "tick"
		| "completion"
		| "state"
		| "interrupt"
		| "refresh";
	observedAt: number;
	lifecycle: SubagentLifecycle;
	projection: LifecycleProjection;
	activity?: SubagentActivityState;
	activityRead?: ActivityReadResult;
}
// pi-herdr-agents extension
export interface RunSessionHooks {
	/** Ownership is registered first; a rejected hook leaves it recoverable. */
	onSpawned?(handle: AgentHandle, task: Task): void | Promise<void>;
	onObserved?(
		handle: AgentHandle,
		projection: LifecycleProjection,
		observation: RunObservation,
	): void;
	/** Successful void/delivered/suppressed permits cleanup; rejection retains panes. */
	onSettled?(
		result: RunResult,
		task: Task,
	): void | DeliveryDecision | Promise<void | DeliveryDecision>;
}
// pi-herdr-agents extension
export interface OwnedRunAttempt {
	handle: AgentHandle;
	adapter: HarnessAdapter;
	/** Actual effective policy, when reported by the owner. */
	persistent?: boolean;
	/** Surface-only release, never kill or an absence/process-exit wait. */
	closeTemporarySurface?(): Promise<void>;
	/** Supplied cheap hydration; no getState or extra pane inspection. */
	observe?(at: number): RunObservation;
	/** Evidence/transcript/manifest finalization precedes parent delivery. */
	finalize?(result: RunResult, task: Task): Promise<RunResult>;
}
// pi-herdr-agents extension
export interface PreparedRun {
	/** Captured role and fully validated, stable candidate list. */
	role: Role;
	persistent: boolean;
	candidates: readonly RuntimeCandidate[];
	spawnAttempt(
		options: SpawnOptions,
		candidateIndex: number,
	): Promise<OwnedRunAttempt>;
}
// pi-herdr-agents extension
export interface RunSessionOperations {
	prepare(task: Task, role: Role): Promise<PreparedRun>;
	resume?(options: ResumeOptions, task: Task): Promise<OwnedRunAttempt>;
}
// pi-herdr-agents extension
export interface RunSessionOptions {
	adapter: HarnessAdapter;
	surfaceProvider?: SurfaceProvider;
	roles: Role[];
	cwd: string;
	sessionIdPrefix?: string;
	/** Accepted for compatibility; never schedules a deadline. */
	defaultTimeoutMs?: number;
	env?: Record<string, string>;
	hooks?: RunSessionHooks;
	operations?: RunSessionOperations;
	retainSurface?: (result: RunResult, task: Task) => boolean;
}
// pi-herdr-agents extension
export interface RunSession {
	spawn(task: Task, prepared?: PreparedRun): Promise<AgentHandle>;
	/** Joins one owned producer; caller cancellation affects only this wait. */
	supervise(
		handle: AgentHandle,
		task: Task,
		signal?: AbortSignal,
	): Promise<RunResult>;
	/** Live queries only; terminal retirement retains consumed IDs, not history. */
	getHandle(taskId: string): AgentHandle | undefined;
	getTask(taskId: string): Task | undefined;
	resume(options: ResumeOptions & { task: Task }): Promise<AgentHandle>;
	send(taskId: string, text: string): Promise<void>;
	kill(taskId: string): Promise<void>;
	interrupt(taskId: string): Promise<void>;
	observe(taskId: string, at?: number): RunObservation | undefined;
	/** Gates delivery before owned abort; a retired ID is an idempotent no-op. */
	suppress(taskId: string): void;
}
// pi-herdr-agents extension
interface RunEntry {
	task: Task;
	prepared?: PreparedRun;
	persistent: boolean;
	nextCandidate: number;
	attempts: OwnedRunAttempt[];
	active?: OwnedRunAttempt;
	controller: AbortController;
	producer?: Promise<RunResult>;
	suppressed: boolean;
	released: boolean;
}

const ABORT_MESSAGE = "Aborted while waiting for subagent to finish";

// pi-herdr-agents extension
export function createRunSession(options: RunSessionOptions): RunSession {
	const entries = new Map<string, RunEntry>();
	// Identity only, never a historical owner/result registry.
	const consumed = new Set<string>();
	const sessionBase = options.sessionIdPrefix ?? Date.now().toString(36);
	const retainSurface = options.retainSurface ?? defaultRetainSurface;

	function reserve(task: Task): RunEntry {
		if (entries.has(task.id) || consumed.has(task.id)) {
			throw new Error(`Task ID "${task.id}" is already reserved or consumed.`);
		}
		const entry: RunEntry = {
			task,
			persistent: false,
			nextCandidate: 0,
			attempts: [],
			controller: new AbortController(),
			suppressed: false,
			released: false,
		};
		entries.set(task.id, entry);
		return entry;
	}

	function resolveRole(task: Task): Role {
		const role = options.roles.find(
			(candidate) => candidate.name === task.role,
		);
		if (!role) throw new Error(`Role "${task.role}" was not found.`);
		return role;
	}

	function wrap(handle: AgentHandle): OwnedRunAttempt {
		const owner: OwnedRunAttempt = { handle, adapter: options.adapter };
		const surfaceId = handle.surfaceId;
		const provider = options.surfaceProvider;
		if (surfaceId !== undefined && provider) {
			owner.closeTemporarySurface = async () => {
				await provider.closeSurface(surfaceId);
			};
		}
		return owner;
	}

	function defaultPreparation(task: Task, role: Role): PreparedRun {
		return {
			role,
			persistent:
				task.behavior?.persistent ?? role.defaults?.persistent ?? false,
			candidates: task.runtime
				? [
						{ model: task.runtime.model, thinking: task.runtime.thinking },
						...(task.runtime.fallbacks ?? []),
					]
				: [],
			spawnAttempt: async (spawnOptions) =>
				wrap(await options.adapter.spawn(spawnOptions)),
		};
	}

	function spawnOptions(
		entry: RunEntry,
		prepared: PreparedRun,
		index: number,
	): SpawnOptions {
		const task = entry.task;
		const candidate = prepared.candidates[index];
		return {
			name: task.name,
			task: task.prompt,
			role: prepared.role,
			cwd: task.cwd,
			sessionId: `${sessionBase}-${task.id}`,
			env:
				options.env || task.env ? { ...options.env, ...task.env } : undefined,
			session: task.session,
			behavior: task.behavior,
			tools: task.tools,
			systemPrompt: task.systemPrompt,
			worktreeRequest: task.worktree,
			runtime: candidate
				? { model: candidate.model, thinking: candidate.thinking }
				: undefined,
		};
	}

	function register(entry: RunEntry, owner: OwnedRunAttempt) {
		consumed.add(entry.task.id);
		entry.attempts.push(owner);
		entry.active = owner;
	}

	function retire(entry: RunEntry) {
		if (entries.get(entry.task.id) === entry) entries.delete(entry.task.id);
		entry.active = undefined;
		entry.prepared = undefined;
		entry.attempts.length = 0;
		entry.producer = undefined;
	}

	function release(entry: RunEntry, result: RunResult) {
		if (
			entry.released ||
			entry.task.worktree ||
			retainSurface(result, entry.task)
		)
			return;
		entry.released = true;
		for (const attempt of entry.attempts) {
			const close = attempt.closeTemporarySurface;
			if (!close) continue;
			// Only the close's own capture survives retirement. No close round-trip
			// may delay process settlement or cause an unhandled rejection.
			try {
				void close.call(attempt).catch(() => {});
			} catch {
				/* best effort */
			}
		}
	}

	function suppressedBeforeSupervision(entry: RunEntry) {
		const owner = entry.active;
		if (!owner) return; // Pending acquisition still owns the reservation.
		try {
			release(entry, rejectedResult(owner.handle, new Error(ABORT_MESSAGE)));
		} finally {
			retire(entry);
		}
	}

	async function acquiredHook(entry: RunEntry, owner: OwnedRunAttempt) {
		// Acquisition is already registered. Hook failure is explicitly recoverable,
		// not a launch failure and never an excuse to acquire another candidate.
		await options.hooks?.onSpawned?.(owner.handle, entry.task);
	}

	async function acquireNext(entry: RunEntry) {
		const prepared = entry.prepared;
		if (!prepared)
			throw new Error(`Task "${entry.task.id}" has no prepared launch.`);
		const failures: { model: string; error: string }[] = [];
		const count = Math.max(1, prepared.candidates.length);
		while (!entry.suppressed && entry.nextCandidate < count) {
			const index = entry.nextCandidate++;
			let owner: OwnedRunAttempt;
			try {
				owner = await prepared.spawnAttempt(
					spawnOptions(entry, prepared, index),
					index,
				);
			} catch (error) {
				failures.push({
					model: prepared.candidates[index]?.model ?? "adapter default",
					error: errorText(error),
				});
				continue;
			}
			// Even a suppressed in-flight acquisition must transfer its real owner.
			register(entry, owner);
			return { owner, failures };
		}
		return { owner: undefined, failures };
	}

	function refresh(entry: RunEntry, at: number): RunObservation | undefined {
		const owner = entry.active;
		const observation = owner?.observe?.(at);
		if (owner && observation)
			options.hooks?.onObserved?.(
				owner.handle,
				observation.projection,
				observation,
			);
		return observation;
	}

	async function deliver(
		entry: RunEntry,
		result: RunResult,
	): Promise<RunResult> {
		try {
			if (!entry.suppressed)
				await options.hooks?.onSettled?.(result, entry.task);
			release(entry, result);
			return result;
		} finally {
			// A rejected send retains panes but not full runtime ownership.
			retire(entry);
		}
	}

	async function produce(entry: RunEntry): Promise<RunResult> {
		for (;;) {
			const owner = entry.active;
			if (!owner)
				throw new Error(`Task "${entry.task.id}" has no active owner.`);
			let result: RunResult;
			try {
				const evidence = await owner.adapter.awaitCompletion(
					owner.handle,
					entry.controller.signal,
				);
				result = evidenceResult(owner.handle, evidence);
			} catch (error) {
				result = rejectedResult(owner.handle, error);
			}
			try {
				if (owner.finalize) result = await owner.finalize(result, entry.task);
			} catch (error) {
				retire(entry);
				throw error;
			}
			const prepared = entry.prepared;
			if (
				!entry.suppressed &&
				!(owner.persistent ?? entry.persistent) &&
				result.evidence?.errorMessage !== undefined &&
				prepared &&
				entry.nextCandidate < prepared.candidates.length
			) {
				const next = await acquireNext(entry);
				if (next.owner && !entry.suppressed) {
					try {
						await acquiredHook(entry, next.owner);
					} catch (error) {
						if (!entry.suppressed) throw error;
					}
					if (!entry.suppressed) continue;
				}
				if (!entry.suppressed && next.failures.length && result.evidence) {
					const message = `${result.evidence.errorMessage}\n\nFallback launch failures: ${formatFailures(next.failures)}`;
					result = {
						...result,
						error: message,
						evidence: { ...result.evidence, errorMessage: message },
					};
				}
			}
			return deliver(entry, result);
		}
	}

	function active(taskId: string): OwnedRunAttempt {
		const owner = entries.get(taskId)?.active;
		if (!owner)
			throw new Error(
				`Task "${taskId}" has no active owner${consumed.has(taskId) ? " (retired/consumed)" : ""}.`,
			);
		return owner;
	}

	return {
		async spawn(task, preparedOverride) {
			const entry = reserve(task);
			try {
				const prepared =
					preparedOverride ??
					(options.operations
						? await options.operations.prepare(task, resolveRole(task))
						: defaultPreparation(task, resolveRole(task)));
				if (entry.suppressed) throw new Error(ABORT_MESSAGE);
				if (task.worktree && prepared.candidates.length > 1) {
					throw new Error(
						"Model fallbacks are not supported for worktree subagents.",
					);
				}
				entry.prepared = prepared;
				entry.persistent = prepared.persistent;
				const acquired = await acquireNext(entry);
				if (entry.suppressed) {
					suppressedBeforeSupervision(entry);
					throw new Error(ABORT_MESSAGE);
				}
				if (!acquired.owner) {
					throw new Error(
						`Subagent could not launch with any configured model. Attempted: ${prepared.candidates.map((candidate) => candidate.model).join(", ")}. ${formatFailures(acquired.failures)}`,
					);
				}
				await acquiredHook(entry, acquired.owner);
				if (entry.suppressed) throw new Error(ABORT_MESSAGE);
				return acquired.owner.handle;
			} catch (error) {
				if (!consumed.has(task.id)) retire(entry);
				throw error;
			}
		},
		async resume({ task, ...resumeOptions }) {
			const entry = reserve(task);
			try {
				entry.persistent =
					task.behavior?.persistent ??
					options.roles.find((role) => role.name === task.role)?.defaults
						?.persistent ??
					false;
				const owner = options.operations?.resume
					? await options.operations.resume(resumeOptions, task)
					: wrap(await options.adapter.resume(resumeOptions));
				register(entry, owner);
				if (entry.suppressed) {
					suppressedBeforeSupervision(entry);
					throw new Error(ABORT_MESSAGE);
				}
				await acquiredHook(entry, owner);
				if (entry.suppressed) throw new Error(ABORT_MESSAGE);
				return owner.handle;
			} catch (error) {
				if (!consumed.has(task.id)) retire(entry);
				throw error;
			}
		},
		async supervise(handle, task, signal) {
			const entry = entries.get(task.id);
			if (!entry)
				throw new Error(
					`Task "${task.id}" ${consumed.has(task.id) ? "is retired/consumed" : "was not found"}.`,
				);
			if (entry.task !== task || entry.active?.handle !== handle) {
				throw new Error(
					`Task "${task.id}" does not match this active handle/owner.`,
				);
			}
			if (signal?.aborted) throw new Error(ABORT_MESSAGE);
			let producer = entry.producer;
			if (!producer) {
				// Publish and observe before either observation or adapter callbacks can
				// suppress/retire the entry or synchronously rejoin this shared outcome.
				let resolveProducer!: (result: RunResult) => void;
				let rejectProducer!: (cause: unknown) => void;
				producer = new Promise<RunResult>((resolve, reject) => {
					resolveProducer = resolve;
					rejectProducer = reject;
				});
				entry.producer = producer;
				// Keep the owned producer observed even if startup throws or all callers cancel.
				void producer
					.catch(() => {})
					.finally(() => {
						if (entry.producer === producer) entry.producer = undefined;
					});
				try {
					refresh(entry, Date.now());
				} catch (error) {
					// No adapter wait has started. Reject reentrant joins with the original
					// error; only unsuppressed ownership remains explicitly recoverable.
					entry.producer = undefined;
					rejectProducer(error);
					if (entry.suppressed) {
						try {
							suppressedBeforeSupervision(entry);
						} catch {
							// Retention failure must not mask the callback error. The helper
							// retires ownership in its finally even when release throws.
						}
					}
					throw error;
				}
				// Start synchronously: microtask deferral changes evidence-vs-abort ordering.
				void produce(entry).then(resolveProducer, rejectProducer);
			} else {
				refresh(entry, Date.now());
			}
			// Callbacks may already have retired entry.producer; never reread that slot.
			return join(producer, signal);
		},
		getHandle: (taskId) => entries.get(taskId)?.active?.handle,
		getTask: (taskId) => entries.get(taskId)?.task,
		async send(taskId, text) {
			const owner = active(taskId);
			await owner.adapter.sendInput(owner.handle, text);
		},
		async kill(taskId) {
			const owner = active(taskId);
			await owner.adapter.kill(owner.handle);
		},
		async interrupt(taskId) {
			const owner = active(taskId);
			await owner.adapter.interrupt(owner.handle);
		},
		observe(taskId, at = Date.now()) {
			const entry = entries.get(taskId);
			return entry ? refresh(entry, at) : undefined;
		},
		suppress(taskId) {
			const entry = entries.get(taskId);
			if (!entry || entry.suppressed) return;
			entry.suppressed = true;
			entry.controller.abort();
			if (!entry.producer) suppressedBeforeSupervision(entry);
		},
	};
}

function errorText(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

function formatFailures(failures: { model: string; error: string }[]): string {
	return failures.map(({ model, error }) => `${model}: ${error}`).join("; ");
}

function evidenceResult(
	handle: AgentHandle,
	evidence: CompletionEvidence,
): RunResult {
	return {
		handle,
		outcome:
			evidence.reason === "ping"
				? "help"
				: evidence.reason === "error" || evidence.exitCode !== 0
					? "failed"
					: "completed",
		exitCode: evidence.exitCode,
		error: evidence.errorMessage,
		output: evidence.finalMessage?.text,
		durationMs: Date.now() - handle.startedAt,
		evidence,
	};
}

function rejectedResult(handle: AgentHandle, cause: unknown): RunResult {
	const message = errorText(cause);
	return {
		handle,
		outcome: /abort/i.test(message) ? "killed" : "failed",
		error: message,
		durationMs: Date.now() - handle.startedAt,
	};
}

function join(
	producer: Promise<RunResult>,
	signal?: AbortSignal,
): Promise<RunResult> {
	if (!signal) return producer;
	return new Promise((resolve, reject) => {
		const onAbort = () => {
			signal.removeEventListener("abort", onAbort);
			reject(new Error(ABORT_MESSAGE));
		};
		signal.addEventListener("abort", onAbort, { once: true });
		if (signal.aborted) onAbort();
		void producer.then(
			(result) => {
				signal.removeEventListener("abort", onAbort);
				resolve(result);
			},
			(cause: unknown) => {
				signal.removeEventListener("abort", onAbort);
				reject(cause);
			},
		);
	});
}
