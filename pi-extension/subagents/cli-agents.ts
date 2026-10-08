import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
	accessSync,
	constants,
	existsSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	renameSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { getSubagentsConfigPath } from "./config-path.ts";
import {
	closePane,
	buildScriptLaunchCommand,
	createSubagentPane,
	isTerminalAvailable,
	runScriptInPane,
	shellQuote,
	waitForShellReady,
} from "../../maestro/surfaces/herdr/terminal.ts";

const ids = ["agy", "cursor", "claude", "codex"] as const;
type Cli = (typeof ids)[number];
type Run = {
	id: string;
	name: string;
	cli: Cli;
	cwd: string;
	paneId: string;
	requestedModel: string;
	dir: string;
	parentSessionId: string;
	dispatchedAt?: number;
	retired?: boolean;
	startupNotice?: boolean;
	cancel?: string;
	delivered?: boolean;
	closed?: boolean;
	launching: boolean;
};
type Final = {
	id: string;
	state: string;
	exitCode: number | null;
	observedModel: string;
	output: string;
	error?: string;
	errorType?: string;
	stderr?: string;
	terminationConfirmed: boolean;
};
type Owner = {
	runs: Map<string, Run>;
	api?: ExtensionAPI;
	currentSessionId?: string;
	timer?: ReturnType<typeof setInterval>;
	quitting: boolean;
};
// One registry per parent process, including across jiti reload generations.
// SAFETY: this extension owns this process-global key and only inserts an Owner.
const globals = globalThis as typeof globalThis & {
	__herdrNativeCliOwner?: Owner;
};
const owner: Owner = (globals.__herdrNativeCliOwner ??= {
	runs: new Map<string, Run>(),
	quitting: false,
});
const runner = fileURLToPath(
	new URL("./cli-agent-runner.mjs", import.meta.url),
);
function readJson<T extends TSchema>(
	path: string,
	schema: T,
): Static<T> | undefined {
	try {
		const value = JSON.parse(readFileSync(path, "utf8"));
		return Value.Check(schema, value) ? value : undefined;
	} catch {
		return undefined;
	}
}
const timeoutSchema = Type.Integer({ minimum: 1, maximum: 600 });
const configSchema = Type.Object({
	platform: Type.Union([
		Type.Literal("win32"),
		Type.Literal("linux"),
		Type.Literal("darwin"),
	]),
	allowed: Type.Array(Type.Union(ids.map((id) => Type.Literal(id))), {
		uniqueItems: true,
	}),
	commands: Type.Record(Type.String(), Type.String()),
	timeoutSeconds: Type.Optional(timeoutSchema),
});
function config() {
	const c = readJson(
		getSubagentsConfigPath(),
		Type.Object({ externalCli: configSchema }),
	)?.externalCli;
	if (!Value.Check(configSchema, c) || c.platform !== process.platform)
		throw new Error(
			"externalCli is missing, malformed, or configured for another platform; launches denied",
		);
	return { ...c, timeoutSeconds: c.timeoutSeconds ?? 180 };
}
function nativePowerShell(command: string): string | undefined {
	if (process.platform !== "win32" || !/\.ps1$/i.test(command))
		return undefined;
	const systemRoot = process.env.SystemRoot;
	if (!systemRoot || !/^[A-Za-z]:[\\/]/.test(systemRoot))
		throw new Error("Native Windows SystemRoot is unavailable");
	const where = join(systemRoot, "System32/where.exe");
	const result = spawnSync(where, ["$PATH:pwsh.exe"], {
		shell: false,
		windowsHide: true,
		timeout: 5000,
		maxBuffer: 64 * 1024,
		encoding: "utf8",
	});
	if (!result.error && result.status === 0) {
		for (const candidate of result.stdout.split(/\r?\n/)) {
			const path = candidate.trim();
			if (
				/^[A-Za-z]:[\\/]/.test(path) &&
				!/[\r\n\0]/.test(path) &&
				basename(path).toLowerCase() === "pwsh.exe" &&
				!/[\\/](wsl|msys|cygwin)[\\/]/i.test(path)
			) {
				try {
					// Keep app-execution aliases intact as well as desktop/Store paths.
					if (statSync(path).isFile()) return path;
				} catch {
					// Skip stale PATH entries; never fall back to Windows PowerShell 5.
				}
			}
		}
	}
	throw new Error("Native PowerShell 7 (pwsh.exe) is unavailable on PATH");
}
function commandPath(value: string | undefined, cli: Cli): string {
	if (!value || !isAbsolute(value) || /[\r\n\0]/.test(value))
		throw new Error(
			"Native command must be one absolute executable path, not a shell command",
		);
	const path = realpathSync(value);
	if (!statSync(path).isFile()) throw new Error("Native command is not a file");
	if (
		/(^|[\\/])(wsl|ssh|bash|sh|cmd|powershell|pwsh|.*-yolo)(\.[^\\/]*)?$/i.test(
			path,
		) ||
		/[\\/](wsl|msys|cygwin)[\\/]/i.test(path)
	)
		throw new Error(
			"Cross-environment transports and command wrappers are not supported",
		);
	if (process.platform === "win32") {
		if (cli === "codex" && !/\.exe$/i.test(path))
			throw new Error("Native Windows Codex requires an .exe, not a shell shim");
		if (!/\.(exe|ps1)$/i.test(path))
			throw new Error("Windows native commands require .exe or .ps1");
		if (
			/\.ps1$/i.test(path) &&
			basename(path).toLowerCase() !== "cursor-agent.ps1"
		)
			throw new Error(
				"Only Cursor's native cursor-agent.ps1 launcher is supported",
			);
		if (/\.ps1$/i.test(path)) {
			if (/\b(wsl|ssh|Invoke-Expression)\b/i.test(readFileSync(path, "utf8")))
				throw new Error("Cursor launcher contains an unsupported transport");
		}
	} else {
		if (/\.(exe|cmd|bat|ps1)$/i.test(path))
			throw new Error("Foreign Windows executable on POSIX is not supported");
		accessSync(path, constants.X_OK);
	}
	return path;
}
function cancel(run: Run, reason = "cancelled") {
	run.cancel ??= reason;
	writeFileSync(join(run.dir, "cancel"), run.cancel, { mode: 0o600 });
}
const finalSchema = Type.Object({
	id: Type.String(),
	state: Type.Union(
		["completed", "failed", "cancelled", "timeout"].map((s) => Type.Literal(s)),
	),
	exitCode: Type.Union([Type.Integer(), Type.Null()]),
	observedModel: Type.String(),
	output: Type.String({ maxLength: 16000 }),
	error: Type.Optional(Type.String()),
	errorType: Type.Optional(Type.String()),
	stderr: Type.Optional(Type.String()),
	terminationConfirmed: Type.Literal(true),
});
function final(run: Run): Final | undefined {
	const value = readJson(join(run.dir, "final.json"), finalSchema);
	if (!Value.Check(finalSchema, value) || value.id !== run.id) return undefined;
	return value;
}
const startedSchema = Type.Object({
	id: Type.String(),
	runnerPid: Type.Integer({ minimum: 1 }),
	childPid: Type.Integer({ minimum: 1 }),
	spawnedAt: Type.Number(),
});
function started(run: Run): boolean {
	return readJson(join(run.dir, "started.json"), startedSchema)?.id === run.id;
}
function runState(run: Run): string {
	const result = final(run);
	if (result) return result.state;
	if (run.cancel) return "cancel unconfirmed";
	if (started(run)) return "CLI spawned";
	return "accepted/launching";
}
function reconcile() {
	for (const run of owner.runs.values()) {
		if (run.launching) continue;
		const result = final(run);
		const matching =
			!run.retired && run.parentSessionId === owner.currentSessionId;
		if (!result) {
			if (
				run.dispatchedAt !== undefined &&
				Date.now() - run.dispatchedAt > 25000 &&
				!started(run)
			) {
				if (!run.cancel) cancel(run, "startup timeout");
				if (!run.startupNotice && matching && owner.api && !owner.quitting) {
					const details = {
						id: run.id,
						name: run.name,
						cli: run.cli,
						paneId: run.paneId,
						parentSessionId: run.parentSessionId,
						paths: run.dir,
						state: "startup not confirmed",
						cancellation: "requested",
						termination: "unknown",
					};
					owner.api.sendMessage(
						{
							customType: "cli_agent_notice",
							content: JSON.stringify(details),
							display: true,
							details,
						},
						{ triggerTurn: true, deliverAs: "steer" },
					);
					run.startupNotice = true;
				}
			}
			continue;
		}
		if (!run.delivered && matching && owner.api && !owner.quitting) {
			const details = {
				...result,
				name: run.name,
				parentSessionId: run.parentSessionId,
				cli: run.cli,
				cwd: run.cwd,
				paneId: run.paneId,
				requestedModel: run.requestedModel,
				paths: {
					directory: run.dir,
					stdout: join(run.dir, "stdout.jsonl"),
					stderr: join(run.dir, "stderr.txt"),
					final: join(run.dir, "final.json"),
				},
			};
			try {
				owner.api.sendMessage(
					{
						customType: "cli_agent_result",
						content: JSON.stringify(details),
						display: true,
						details,
					},
					{ triggerTurn: true, deliverAs: "steer" },
				);
				run.delivered = true;
			} catch {
				continue;
			}
		}
		if (run.delivered || run.retired || owner.quitting) {
			try {
				closePane(run.paneId);
				run.closed = true;
			} catch {
				/* Retain ownership until closure succeeds. */
			}
			if (run.closed) owner.runs.delete(run.id);
		}
	}
	if (!owner.runs.size && owner.timer) {
		clearInterval(owner.timer);
		owner.timer = undefined;
	}
}
function watch() {
	if (!owner.timer)
		owner.timer = setInterval(() => {
			try {
				reconcile();
			} catch {
				/* Keep ownership on transient I/O failure. */
			}
		}, 500);
}
const receipt = <T>(details: T) => ({
	content: [{ type: "text" as const, text: JSON.stringify(details) }],
	details,
});

export function registerCliAgents(pi: ExtensionAPI): void {
	if (process.env.PI_SUBAGENT_ID) return;
	// Delivery resumes only with a fresh session_start context, never the old API.
	owner.api = undefined;
	pi.on("session_start", (_event, ctx) => {
		owner.currentSessionId = ctx.sessionManager.getSessionId();
		owner.api = pi;
		owner.quitting = false;
		for (const run of owner.runs.values()) {
			if (run.parentSessionId !== owner.currentSessionId) {
				run.retired = true;
				cancel(run, "parent session changed");
			}
		}
		if (owner.runs.size) watch();
	});
	pi.on("session_shutdown", async (event) => {
		owner.api = undefined;
		if (event.reason !== "quit") return;
		owner.quitting = true;
		for (const run of owner.runs.values()) cancel(run);
		const deadline = Date.now() + 5000;
		while (owner.runs.size && Date.now() < deadline) {
			reconcile();
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		// Unconfirmed cancellation keeps the producer and ownership record, not a false final.
		owner.timer?.unref();
	});
	pi.registerTool({
		name: "cli_agents_list",
		label: "Native CLI availability",
		description:
			"Passive configured native CLI availability only. Does not execute clients, authenticate, discover models, or authorize launches.",
		parameters: Type.Object({}),
		async execute() {
			let c: ReturnType<typeof config> | undefined;
			let error: string | undefined;
			try {
				c = config();
			} catch (e) {
				error = String(e);
			}
			return receipt({
				configPath: getSubagentsConfigPath(),
				platform: process.platform,
				error,
				agents: ids.map((cli) => {
					let command: string | undefined;
					let unavailable: string | undefined;
					try {
						const path = commandPath(c?.commands[cli], cli);
						nativePowerShell(path);
						command = path;
					} catch (e) {
						unavailable = String(e);
					}
					return {
						cli,
						allowed: c?.allowed.includes(cli) ?? false,
						command,
						available: Boolean(command),
						unavailable,
						authentication: "unknown",
						models: "not probed",
					};
				}),
				runs: [...owner.runs.values()].map((run) => ({
					id: run.id,
					name: run.name,
					cli: run.cli,
					paneId: run.paneId,
					paths: run.dir,
					parentSessionId: run.parentSessionId,
					state: runState(run),
				})),
			});
		},
	});
	pi.registerTool({
		name: "cli_agent_cancel",
		label: "Cancel native CLI",
		description:
			"Request cancellation of one owned native CLI run. One automatic result follows confirmed termination; an unconfirmed request remains controllable.",
		parameters: Type.Object({ id: Type.String() }),
		async execute(_id, p) {
			const run = owner.runs.get(p.id);
			if (!run) throw new Error("Unknown or no longer owned native CLI run");
			cancel(run);
			return receipt({
				id: run.id,
				state: "cancellation requested",
				paths: run.dir,
			});
		},
	});
	pi.registerTool({
		name: "cli_agent",
		label: "Launch native CLI",
		description:
			"Launch one agy, Cursor, Claude, or Codex native one-shot client in this parent's environment in an owned Herdr pane. Returns an accepted receipt, then one automatic cli_agent_result. Native model strings only; no Pi sessions, routing, retries, worktrees or polling needed. autonomous defaults false; true explicitly enables agy/Claude dangerous permissions or Cursor force, and is rejected for Codex. Codex uses codexSandbox (read-only by default; workspace-write requires explicit user approval), with approval_policy never and no sandbox bypass. Codex effort supports low/medium/high/xhigh, not max. trustWorkspace is a separate Cursor-only opt-in and requires explicit user approval for both cwd/workspace and the host-created extra task directory; it does not imply autonomous permission. On native Windows, Cursor's unsupported sandbox requires per-call allowUnsandboxed: true with explicit user approval; this uses the CLI allowlist, not OS isolation.",
		parameters: Type.Object({
			name: Type.String({ minLength: 1, maxLength: 100 }),
			cli: Type.Union(ids.map((id) => Type.Literal(id))),
			task: Type.String({ minLength: 1, maxLength: 200000 }),
			cwd: Type.Optional(Type.String()),
			model: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
			effort: Type.Optional(
				Type.Union(
					["low", "medium", "high", "xhigh", "max"].map((id) =>
						Type.Literal(id),
					),
				),
			),
			autonomous: Type.Optional(Type.Boolean()),
			codexSandbox: Type.Optional(
				Type.Union([Type.Literal("read-only"), Type.Literal("workspace-write")]),
			),
			trustWorkspace: Type.Optional(Type.Boolean()),
			allowUnsandboxed: Type.Optional(Type.Boolean()),
			timeoutSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 600 })),
		}),
		async execute(_id, p, _signal, _update, ctx) {
			const parentSessionId = ctx.sessionManager.getSessionId();
			const c = config();
			if (!c.allowed.includes(p.cli))
				throw new Error(`Native CLI ${p.cli} is not whitelisted`);
			if (p.codexSandbox !== undefined && p.cli !== "codex")
				throw new Error("codexSandbox is supported only for Codex");
			if (p.cli === "codex" && p.autonomous === true)
				throw new Error("Codex autonomous is unsupported; use explicit codexSandbox instead");
			if (p.cli === "codex" && p.effort === "max")
				throw new Error("Codex effort supports only low, medium, high, or xhigh in this adapter");
			if (p.trustWorkspace === true && p.cli !== "cursor")
				throw new Error("trustWorkspace is supported only for Cursor");
			if (p.allowUnsandboxed === true && p.cli !== "cursor")
				throw new Error("allowUnsandboxed is supported only for Cursor");
			if (p.allowUnsandboxed === true && process.platform !== "win32")
				throw new Error("allowUnsandboxed is supported only for native Windows Cursor");
			if (process.platform === "win32" && p.cli === "cursor" && p.allowUnsandboxed !== true)
				throw new Error("Native Windows Cursor sandbox is unsupported; launch requires explicit per-call allowUnsandboxed approval (CLI allowlist mode, not OS isolation)");
			if (p.cli === "cursor" && p.effort !== undefined)
				throw new Error(
					"Cursor effort is unsupported; no verified native effort flag",
				);
			if (
				p.model !== undefined &&
				!/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(p.model)
			)
				throw new Error("Invalid native model string");
			if (
				!p.name.trim() ||
				Array.from(p.name).some(
					(char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
				) ||
				!p.task.trim() ||
				p.task.includes("\0")
			)
				throw new Error("Invalid name or task");
			if (p.cli === "agy" && p.task.length > 8000)
				throw new Error(
					"agy's native prompt argv is limited to 8000 characters; provide a bounded task referencing local context files",
				);
			const command = commandPath(c.commands[p.cli], p.cli);
			const powershell = nativePowerShell(command);
			const cwd = realpathSync(resolve(ctx.cwd, p.cwd ?? "."));
			if (!statSync(cwd).isDirectory())
				throw new Error("cwd is not a directory");
			const timeoutSeconds = p.timeoutSeconds ?? c.timeoutSeconds;
			if (!isTerminalAvailable())
				throw new Error(
					"Native CLI tools require this parent to be inside Herdr",
				);
			if (!existsSync(runner)) throw new Error("Native CLI runner is missing");
			const dir = mkdtempSync(join(tmpdir(), "pi-herdr-native-"));
			const id = randomUUID();
			const manifest = join(dir, "launch.json");
			writeFileSync(join(dir, "task.txt"), p.task, { mode: 0o600 });
			writeFileSync(
				`${manifest}.tmp`,
				JSON.stringify({
					...p,
					id,
					command,
					powershell,
					cwd,
					platform: process.platform,
					timeoutSeconds,
				}),
				{ mode: 0o600 },
			);
			renameSync(`${manifest}.tmp`, manifest);
			// Validate the existing native terminal trampoline before creating Herdr resources.
			buildScriptLaunchCommand(join(dir, "launch.sh"));
			const paneId = createSubagentPane(`${p.cli}: ${p.name}`, cwd);
			const run: Run = {
				id,
				name: p.name,
				cli: p.cli,
				cwd,
				paneId,
				dir,
				requestedModel: p.model ?? "client default",
				parentSessionId,
				launching: true,
			};
			owner.runs.set(id, run);
			watch();
			let submitted = false;
			try {
				await waitForShellReady(paneId, { timeoutMs: 15000 });
				if (owner.quitting || run.retired) cancel(run);
				const native = (path: string) => shellQuote(path.replaceAll("\\", "/"));
				// Once command submission is attempted, absence of started evidence is unknown.
				submitted = true;
				run.dispatchedAt = Date.now();
				runScriptInPane(
					paneId,
					`${native(process.execPath)} ${native(runner)} ${native(manifest)}`,
					{ scriptPath: join(dir, "launch.sh") },
				);
				run.launching = false;
				return receipt({
					id,
					name: p.name,
					cli: p.cli,
					cwd,
					paneId,
					state: "accepted/launching",
					requestedModel: run.requestedModel,
					paths: dir,
					startupBoundSeconds: 25,
					completion: "Automatic cli_agent_result; do not poll",
				});
			} catch (e) {
				run.launching = false;
				if (!submitted) {
					try {
						closePane(paneId);
						owner.runs.delete(id);
					} catch {
						// No producer was submitted; retain pane ownership for explicit inspection.
						run.cancel = "launch failed before submission";
					}
				} else cancel(run, "launch failed");
				throw e;
			}
		},
	});
}
