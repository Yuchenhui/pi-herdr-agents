import assert from "node:assert/strict";
import {
	mkdtempSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { PiHarnessAdapter } from "../../maestro/adapters/pi/pi-harness-adapter.ts";
import { launchOperationsFromSurface } from "../../maestro/adapters/pi/launch.ts";
import {
	createWorktreeOperations,
	readWorktreeManifest,
} from "../../maestro/runtime/worktree-operations.ts";
import { FakeSurfaceProvider } from "../../maestro/surfaces/fake/fake-surface-provider.ts";
import { createSubagentActivityRecorder } from "../../maestro/adapters/pi/activity-file.ts";
import { FileWakeRegistry } from "../../maestro/core/wake.ts";
import { SupervisionCoordinator } from "../../maestro/core/supervision.ts";
import {
	readSubagentSessionPolicy,
	appendPersistentTaskEvent,
	consumePersistentTaskInbox,
	readPersistentDeliveryLedger,
} from "../../maestro/adapters/pi/session.ts";
import type { SpawnOptions } from "../../maestro/core/harness-adapter.ts";

const paneConfig = {
	mode: "grouped",
	direction: "right",
	maxPerTab: 4,
} as const;
function fixture() {
	const root = mkdtempSync(join(tmpdir(), "pi-adapter-test-"));
	const sessionDir = join(root, "parent");
	mkdirSync(sessionDir);
	const sessionFile = join(sessionDir, "parent.jsonl");
	writeFileSync(
		sessionFile,
		JSON.stringify({ type: "session", version: 3, id: "parent", cwd: root }) +
			"\n",
	);
	const surface = new FakeSurfaceProvider();
	// Fake only the process launch. Session policy, artifact creation and completion are real.
	const operations = launchOperationsFromSurface(surface, paneConfig);
	operations.runScript = (_surface, _command, options) => options.scriptPath;
	const wake = new FileWakeRegistry();
	const supervision = new SupervisionCoordinator(
		async () => ({
			complete: true,
			panes: surface
				.listSurfaces()
				.map((s) => ({ paneId: s.id, workspaceId: "fixture" })),
		}),
		(id) => surface.inspectSurface(id),
		false,
		wake,
	);
	const modelRegistry = {
		find: (provider: string, id: string) => ({ provider, id, reasoning: true }),
		available: () => [],
		hasConfiguredAuth: () => true,
		supportedThinkingLevels:
			(): import("../../maestro/core/types.ts").ThinkingLevel[] => [
				"off",
				"minimal",
				"low",
				"medium",
				"high",
			],
		clampThinkingLevel: (
			_model: import("../../maestro/core/routing.ts").RoutingModel,
			level: import("../../maestro/core/types.ts").ThinkingLevel,
		) => level,
	};
	const adapter = new PiHarnessAdapter({
		surface,
		paneConfig,
		operations,
		wake,
		supervision,
		modelRegistry,
		parent: {
			cwd: root,
			sessionFile,
			sessionId: "parent",
			sessionDir,
			agentDir: join(root, "agent"),
		},
		parentRuntime: { provider: "fake", modelId: "test", thinking: "off" },
	});
	const options: SpawnOptions = {
		name: "worker",
		task: "bounded task",
		cwd: root,
		sessionId: "logical-task",
		role: {
			name: "worker",
			version: "1",
			description: "test",
			systemPrompt: "Focused identity",
			allowedTools: ["read", "bash"],
			defaults: { autoExit: true, spawning: false },
		},
		runtime: { model: "fake/test", thinking: "off" },
	};
	return {
		root,
		modelRegistry,
		adapter,
		surface,
		options,
		operations,
		wake,
		supervision,
		dispose() {
			supervision.close();
			wake.close();
			rmSync(root, { recursive: true, force: true });
		},
	};
}
async function usingFixture(
	run: (f: ReturnType<typeof fixture>) => Promise<void>,
) {
	const f = fixture();
	try {
		await run(f);
	} finally {
		f.dispose();
	}
}

describe("PiHarnessAdapter", () => {
	it("standalone provider launch consumes injected worktree effects and refuses managed public resume before creating a pane", async () =>
		usingFixture(async (f) => {
			const effects = createWorktreeOperations();
			const probes: string[] = [];
			effects.resolveGitCommit = (_cwd, ref) => {
				probes.push(ref);
				return "base-sha";
			};
			effects.resolveWorktreeProvisionCwd = (cwd) => cwd;
			const adapter = new PiHarnessAdapter({
				surface: f.surface,
				paneConfig,
				worktreeOperations: effects,
				modelRegistry: f.modelRegistry,
				supervision: f.supervision,
				parent: {
					cwd: f.root,
					sessionFile: join(f.root, "parent", "parent.jsonl"),
					sessionId: "parent",
					sessionDir: join(f.root, "parent"),
					agentDir: join(f.root, "agent"),
				},
				parentRuntime: { provider: "fake", modelId: "test", thinking: "off" },
			});
			const handle = await adapter.spawn({
				...f.options,
				worktreeRequest: { branch: "task16" },
			});
			assert.deepEqual(probes, ["HEAD"]);
			assert.equal(handle.worktree?.baseSha, "base-sha");
			assert.equal(
				readWorktreeManifest(handle.worktree!.manifestFile)?.owner,
				"pi-herdr-subagents",
			);
			assert.equal(f.surface.listSurfaces().length, 1);
			await assert.rejects(
				adapter.resume({ name: "resume", sessionId: handle.sessionId! }),
				/Cannot resume managed-worktree session/,
			);
			assert.equal(f.surface.listSurfaces().length, 1);
			assert.equal(f.supervision.diagnostics().watcherCount, 0);
		}));
	it("preserves an already validated host plan without consulting the registry again", async () =>
		usingFixture(async (f) => {
			const plan = {
				provider: "fake",
				modelId: "no-reasoning",
				model: "fake/no-reasoning",
				thinking: "off" as const,
				modelSource: "agent" as const,
				thinkingSource: "parent" as const,
				requestedModel: "fake/no-reasoning",
				thinkingAdjustment: {
					from: "high" as const,
					to: "off" as const,
					reason: "non-reasoning" as const,
				},
			};
			f.modelRegistry.find = () => {
				throw new Error("host plan must not be revalidated");
			};
			const h = await f.adapter.spawn({
				...f.options,
				resolvedLaunch: {
					runtimePlan: plan,
					agent: undefined,
					cwd: undefined,
					tools: undefined,
				},
			});
			const child = f.adapter.getRunningChild(h);
			assert.equal(child.runtimePlan, plan);
			assert.equal(child.agent, undefined);
			assert.equal(readSubagentSessionPolicy(h.sessionId).tools, null);
		}));
	it("keeps absent, explicit and role cwd configuration origins distinct", async () =>
		usingFixture(async (f) => {
			mkdirSync(join(f.root, ".pi", "agent"), { recursive: true });
			const roleCwd = join(f.root, "agent", "role-folder");
			mkdirSync(join(roleCwd, ".pi", "agent"), { recursive: true });
			const commands: string[] = [];
			f.operations.runScript = (_surface, command, options) => {
				commands.push(command);
				return options.scriptPath;
			};
			const plan = {
				provider: "fake",
				modelId: "test",
				model: "fake/test",
				thinking: "off" as const,
				modelSource: "parent" as const,
				thinkingSource: "parent" as const,
			};
			for (const origin of [{}, { cwd: f.root }, { roleCwd: "role-folder" }]) {
				const h = await f.adapter.spawn({
					...f.options,
					resolvedLaunch: { runtimePlan: plan, ...origin },
				});
				assert.equal(h.cwd, "roleCwd" in origin ? roleCwd : f.root);
				if (!("cwd" in origin) && !("roleCwd" in origin))
					assert.ok(h.sessionId.startsWith(join(f.root, "agent", "sessions")));
			}
			assert.ok(
				!commands[0].includes(
					`PI_CODING_AGENT_DIR='${join(f.root, ".pi", "agent")}'`,
				),
			);
			assert.match(
				commands[1],
				new RegExp(`PI_CODING_AGENT_DIR='${join(f.root, ".pi", "agent")}'`),
			);
			assert.match(
				commands[2],
				new RegExp(`PI_CODING_AGENT_DIR='${join(roleCwd, ".pi", "agent")}'`),
			);
		}));
	it("launches the relocated protocol and maps the session handle", async () =>
		usingFixture(async (f) => {
			const h = await f.adapter.spawn(f.options);
			assert.equal(h.harness, "pi");
			assert.match(h.sessionId, /\.jsonl$/);
			assert.equal(h.cwd, f.root);
			assert.equal(h.role, "worker");
			const policy = readSubagentSessionPolicy(h.sessionId);
			assert.deepEqual(policy.tools, ["read", "bash"]);
			assert.deepEqual(policy.deniedTools, [
				"subagent",
				"subagent_interrupt",
				"subagent_send",
				"subagent_stop",
				"subagents_list",
				"subagent_resume",
			]);
		}));
	it("maps relative cwd to the same directory as the launch transaction", async () =>
		usingFixture(async (f) => {
			const h = await f.adapter.spawn({ ...f.options, cwd: "nested" });
			assert.equal(h.cwd, join(f.root, "nested"));
			assert.equal(
				f.surface.listSurfaces().find((surface) => surface.id === h.surfaceId)
					?.cwd,
				h.cwd,
			);
		}));
	it("launches one ordinary candidate and rejects worktree fallback lists before acquisition", async () =>
		usingFixture(async (f) => {
			const runtime = {
				model: "fake/test",
				thinking: "off" as const,
				fallbacks: [{ model: "fake/alternative", thinking: "off" as const }],
			};
			const h = await f.adapter.spawn({ ...f.options, runtime });
			assert.equal(
				f.adapter.getRunningChild(h).runtimePlan?.model,
				"fake/test",
			);
			assert.equal(f.surface.listSurfaces().length, 1);
			await assert.rejects(
				f.adapter.spawn({
					...f.options,
					runtime,
					worktreeRequest: { branch: "unsafe-fallback" },
				}),
				/Model fallbacks are not supported for worktree subagents/,
			);
			assert.equal(f.surface.listSurfaces().length, 1);
		}));
	it("keeps legacy fallback IDs opaque without reusing prior session evidence", async () =>
		usingFixture(async (f) => {
			const launchIdentity = { id: "legacy-fallback-id" };
			const first = await f.adapter.spawn({ ...f.options, launchIdentity });
			writeFileSync(
				`${first.sessionId}.exit`,
				JSON.stringify({
					type: "error",
					errorMessage: "first provider rejected",
				}),
			);
			await f.adapter.awaitCompletion(first, new AbortController().signal);
			const next = await f.adapter.spawn({
				...f.options,
				launchIdentity,
				runtime: { model: "fake/alternative", thinking: "off" },
			});
			assert.equal(next.id, first.id);
			assert.notEqual(next.sessionId, first.sessionId);
			assert.equal(f.adapter.exitCode(next), undefined);
			assert.notEqual(await f.adapter.getState(next), "done");
			await assert.rejects(f.adapter.interrupt(first), /Unknown Pi child/);
			writeFileSync(`${next.sessionId}.exit`, JSON.stringify({ type: "done" }));
			assert.equal(
				(await f.adapter.awaitCompletion(next, new AbortController().signal))
					.reason,
				"done",
			);
			assert.equal(f.adapter.exitCode(first), 1);
			assert.equal(f.adapter.exitCode(next), 0);
			assert.equal(
				(await f.adapter.awaitCompletion(first, new AbortController().signal))
					.reason,
				"error",
			);
		}));
	it("consumes prewritten completion and keeps the first terminal evidence", async () =>
		usingFixture(async (f) => {
			const h = await f.adapter.spawn(f.options);
			writeFileSync(
				h.sessionId,
				JSON.stringify({
					type: "message",
					message: {
						role: "assistant",
						content: [{ type: "text", text: "finished" }],
						stopReason: "stop",
					},
				}) + "\n",
			);
			writeFileSync(
				`${h.sessionId}.exit`,
				JSON.stringify({ type: "done", exitCode: 0 }),
			);
			const e = await f.adapter.awaitCompletion(
				h,
				new AbortController().signal,
			);
			assert.equal(e.reason, "done");
			assert.equal(e.exitCode, 0);
			assert.equal(e.finalMessage?.text, "finished");
			assert.equal(e.sessionRef, h.sessionId);
			assert.equal(f.adapter.exitCode(h), 0);
			writeFileSync(
				`${h.sessionId}.exit`,
				JSON.stringify({ type: "error", errorMessage: "later" }),
			);
			assert.deepEqual(
				await f.adapter.awaitCompletion(h, new AbortController().signal),
				e,
			);
			assert.equal(await f.adapter.getState(h), "done");
		}));
	it("accepts a late sidecar 200ms after confirmed pane absence", async () =>
		usingFixture(async (f) => {
			const h = await f.adapter.spawn(f.options);
			await f.adapter.kill(h);
			assert.equal(
				(await f.surface.inspectSurface(h.surfaceId!)).kind,
				"missing",
			);
			const wait = f.adapter.awaitCompletion(h, new AbortController().signal);
			const timer = setTimeout(
				() =>
					writeFileSync(
						`${h.sessionId}.exit`,
						JSON.stringify({ type: "done" }),
					),
				200,
			);
			try {
				const e = await wait;
				assert.equal(e.reason, "done");
				assert.equal(e.exitCode, 0);
			} finally {
				clearTimeout(timer);
			}
		}));
	it("rejects already-aborted waits and cancellation does not cancel another waiter", async () =>
		usingFixture(async (f) => {
			const h = await f.adapter.spawn(f.options);
			const a = new AbortController();
			a.abort();
			await assert.rejects(f.adapter.awaitCompletion(h, a.signal), /abort/i);
			const b = new AbortController();
			const one = f.adapter.awaitCompletion(h, b.signal);
			const rejected = assert.rejects(one, /abort/i);
			const two = f.adapter.awaitCompletion(h, new AbortController().signal);
			b.abort();
			await rejected;
			writeFileSync(
				`${h.sessionId}.exit`,
				JSON.stringify({ type: "ping", name: h.name, message: "help" }),
			);
			assert.equal((await two).reason, "ping");
		}));
	it("restores saved public policy after termination and refuses persistent policy", async () =>
		usingFixture(async (f) => {
			const h = await f.adapter.spawn(f.options);
			writeFileSync(
				h.sessionId,
				JSON.stringify({ type: "session", version: 3, id: h.id, cwd: f.root }) +
					"\n",
			);
			await f.adapter.kill(h);
			const resumed = await f.adapter.resume({
				name: "resumed",
				sessionId: h.sessionId,
			});
			assert.notEqual(resumed.id, h.id);
			assert.equal(resumed.sessionId, h.sessionId);
			assert.equal(resumed.cwd, f.root);
			assert.equal(resumed.worktree, undefined);
			const p = await f.adapter.spawn({
				...f.options,
				behavior: { persistent: true },
			});
			await assert.rejects(
				f.adapter.resume({ name: "unsafe", sessionId: p.sessionId }),
				/Cannot resume persistent specialist/,
			);
		}));
	it("persistent sends use task evidence, not coarse idle; busy tasks are not queued", async () =>
		usingFixture(async (f) => {
			const h = await f.adapter.spawn({
				...f.options,
				behavior: { persistent: true },
				launchIdentity: {
					id: "opaque-logical",
					generationId: "opaque-generation",
					taskId: "opaque-task",
				},
			});
			const child = f.adapter.getRunningChild(h);
			assert.equal(child.id, "opaque-logical");
			assert.equal(child.generationId, "opaque-generation");
			assert.equal(child.taskId, "opaque-task");
			await assert.rejects(f.adapter.sendInput(h, "busy"), /rejected-busy/);
			assert.equal(consumePersistentTaskInbox(h.sessionId), null);
			appendPersistentTaskEvent(h.sessionId, {
				type: "task-done",
				task: "opaque-task",
				generation: "opaque-generation",
			});
			// Delivery remains the host's explicit responsibility, never inferred by getState.
			assert.equal(child.taskId, "opaque-task");
			assert.equal(f.adapter.readPersistentEvents(h)[0].type, "task-done");
			child.taskId = undefined;
			child.tasksCompleted = 1;
			await f.adapter.sendInput(h, "next task");
			assert.equal(
				consumePersistentTaskInbox(h.sessionId)?.message,
				"next task",
			);
			assert.equal(
				readPersistentDeliveryLedger(h.sessionId).at(-1)?.outcome,
				"dispatched",
			);
			await assert.rejects(f.adapter.sendInput(h, "no queue"), /rejected-busy/);
			assert.equal(consumePersistentTaskInbox(h.sessionId), null);
			assert.equal(f.adapter.exitCode(h), undefined);
			const ordinary = await f.adapter.spawn(f.options);
			await assert.rejects(
				f.adapter.sendInput(ordinary, "text"),
				/child is not a persistent specialist/,
			);
		}));
	it("preserves a textless final error and its raw message", async () =>
		usingFixture(async (f) => {
			const h = await f.adapter.spawn(f.options);
			writeFileSync(
				h.sessionId,
				JSON.stringify({
					type: "message",
					message: {
						role: "assistant",
						content: [],
						stopReason: "error",
						errorMessage: "provider account refused",
					},
				}) + "\n",
			);
			writeFileSync(
				`${h.sessionId}.exit`,
				JSON.stringify({
					type: "error",
					errorMessage: "provider account refused",
				}),
			);
			const evidence = await f.adapter.awaitCompletion(
				h,
				new AbortController().signal,
			);
			assert.equal(evidence.exitCode, 1);
			assert.equal(evidence.errorMessage, "provider account refused");
			assert.deepEqual(evidence.finalMessage, {
				text: "",
				stopReason: "error",
				errorMessage: "provider account refused",
			});
		}));
	it("preserves lineage-only defaults, explicit system prompt, and tool overrides", async () =>
		usingFixture(async (f) => {
			let command = "";
			f.operations.runScript = (_surface, value, options) => {
				command = value;
				return options.scriptPath;
			};
			const h = await f.adapter.spawn({
				...f.options,
				tools: ["read"],
				systemPrompt: "Override identity",
				role: {
					...f.options.role,
					defaults: {
						...f.options.role.defaults,
						sessionMode: "lineage-only",
						systemPromptMode: "replace",
					},
				},
			});
			const header = JSON.parse(
				readFileSync(h.sessionId, "utf8").split("\n")[0],
			);
			assert.match(header.parentSession, /parent\.jsonl$/);
			assert.deepEqual(readSubagentSessionPolicy(h.sessionId).tools, ["read"]);
			const promptPath = command.match(/--system-prompt '([^']+)'/)?.[1];
			assert.ok(promptPath);
			assert.equal(readFileSync(promptPath, "utf8"), "Override identity");
		}));
	it("projects activity and preserves interrupted-turn precedence without inferring process completion", async () =>
		usingFixture(async (f) => {
			const h = await f.adapter.spawn(f.options);
			const child = f.adapter.getRunningChild(h);
			let now = Date.now() - 10000;
			const recorder = createSubagentActivityRecorder({
				activityFile: child.activityFile,
				runningChildId: child.id,
				now: () => (now += 1000),
			});
			recorder.sessionStart();
			assert.equal(await f.adapter.getState(h), "idle");
			recorder.agentStart();
			f.surface.scriptInspection(child.surface, {
				kind: "present",
				agentStatus: "working",
				observedAt: Date.now(),
			});
			assert.equal(await f.adapter.getState(h), "working");
			await f.adapter.interrupt(h);
			assert.equal(await f.adapter.getState(h), "unknown");
			assert.equal(f.adapter.exitCode(h), undefined);
			now = Date.now();
			recorder.agentStart();
			assert.equal(await f.adapter.getState(h), "working");
			recorder.agentEndWaiting();
			f.surface.scriptInspection(child.surface, {
				kind: "present",
				agentStatus: "idle",
				observedAt: Date.now(),
			});
			assert.equal(await f.adapter.getState(h), "blocked");
			recorder.agentEndDone();
			assert.notEqual(await f.adapter.getState(h), "done");
			recorder.sessionShutdown("quit");
		}));
	it("awaits Escape delivery and propagates synchronous and asynchronous failures", async () =>
		usingFixture(async (f) => {
			const h = await f.adapter.spawn(f.options);
			const entered = deferred();
			const release = deferred();
			let settled = false;
			f.surface.sendKeys = async (_surface, key) => {
				assert.equal(key, "Escape");
				entered.resolve();
				await release.promise;
			};
			const operation = f.adapter.interrupt(h);
			operation.then(
				() => {
					settled = true;
				},
				() => {
					settled = true;
				},
			);
			try {
				await entered.promise;
				await new Promise((resolve) => setImmediate(resolve));
				assert.equal(
					settled,
					false,
					"interrupt settled before Escape delivery",
				);
			} finally {
				release.resolve();
			}
			await operation;
			assert.equal(
				f.adapter.getRunningChild(h).lifecycle.turn.kind,
				"interrupted",
			);
			f.surface.sendKeys = () => {
				throw new Error("synchronous send failure");
			};
			await assert.rejects(f.adapter.interrupt(h), /synchronous send failure/);
			f.surface.sendKeys = async () => {
				throw new Error("asynchronous send failure");
			};
			await assert.rejects(f.adapter.interrupt(h), /asynchronous send failure/);
			assert.equal(f.adapter.exitCode(h), undefined);
		}));
	for (const stage of ["close", "absence"] as const)
		it(`kill awaits ${stage} settlement`, async () =>
			usingFixture(async (f) => {
				const h = await f.adapter.spawn(f.options);
				const entered = deferred();
				const release = deferred();
				let settled = false;
				if (stage === "close")
					f.surface.closeSurface = async (id) => {
						entered.resolve();
						await release.promise;
						f.surface.removeSurface(id);
					};
				else
					f.surface.waitForSurfaceAbsence = async () => {
						entered.resolve();
						await release.promise;
					};
				const operation = f.adapter.kill(h);
				operation.then(
					() => {
						settled = true;
					},
					() => {
						settled = true;
					},
				);
				try {
					await entered.promise;
					await new Promise((resolve) => setImmediate(resolve));
					assert.equal(settled, false, `kill settled before ${stage}`);
				} finally {
					release.resolve();
				}
				await operation;
				assert.equal(
					(await f.surface.inspectSurface(h.surfaceId!)).kind,
					"missing",
				);
				assert.equal(f.adapter.exitCode(h), undefined);
			}));
});

function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
