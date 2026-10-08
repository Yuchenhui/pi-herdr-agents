// Standalone native producer: no Pi SDK, shell interpolation, or model fallback.
import { spawn } from "node:child_process";
import {
	readFileSync,
	writeFileSync,
	renameSync,
	existsSync,
	openSync,
	writeSync,
	closeSync,
	statSync,
} from "node:fs";
import { join, dirname, basename, isAbsolute } from "node:path";

const manifestPath = process.argv[2];
let m;
try {
	m = JSON.parse(readFileSync(manifestPath, "utf8"));
} catch (e) {
	console.error(`Invalid native manifest: ${e.message}`);
	process.exit(1);
}
// These values come only from JSON: accept primitive strings, not coercions.
const text = (value) => (value === String(value) ? value : undefined);
const dir = dirname(manifestPath);
const atomic = (name, data) => {
	const path = join(dir, name);
	writeFileSync(`${path}.tmp`, JSON.stringify({ id: m.id, ...data }), {
		mode: 0o600,
	});
	renameSync(`${path}.tmp`, path);
};
let intent;
let child;
let exited = false;
let killPending;
let terminationConfirmed = false;
let error;
let terminal;
let codexThreadStarted = false;
let codexTurnStarted = false;
let codexAnswer;
let observedModel = "unknown";
let pending = "";
let malformed = false;
const logLimit = 4 * 1024 * 1024;
const lineLimit = 1024 * 1024;
let stderrTail = "";
const logs = ["stdout.jsonl", "stderr.txt"].map((name) => ({
	fd: openSync(join(dir, name), "wx", 0o600),
	bytes: 0,
}));
function log(index, chunk) {
	const item = logs[index];
	const bytes = Buffer.from(chunk);
	const remaining = logLimit - item.bytes;
	if (remaining > 0) {
		try {
			item.bytes += writeSync(item.fd, bytes.subarray(0, remaining));
		} catch (e) {
			error = e.message;
			requestCancel("cancelled");
		}
	}
}
// Codex 0.161.0 exec JSONL: one thread/turn and exactly one terminal event.
// Only completed agent_message text is an answer; tool output/reasoning are not.
function parseCodex(event) {
	if (terminal) throw new Error("Codex event after terminal completion");
	switch (event.type) {
		case "thread.started":
			if (codexThreadStarted || !text(event.thread_id)?.trim())
				throw new Error("Invalid Codex thread.started");
			codexThreadStarted = true;
			return;
		case "turn.started":
			if (!codexThreadStarted || codexTurnStarted)
				throw new Error("Invalid Codex turn.started");
			codexTurnStarted = true;
			return;
		case "turn.completed": {
			const usage = event.usage;
			const fields = [
				"input_tokens",
				"cached_input_tokens",
				"output_tokens",
				"reasoning_output_tokens",
			];
			if (
				!codexTurnStarted ||
				Object.prototype.toString.call(usage) !== "[object Object]" ||
				fields.some((key) => !Number.isSafeInteger(usage[key]) || usage[key] < 0) ||
				(usage.cache_write_input_tokens !== undefined &&
					(!Number.isSafeInteger(usage.cache_write_input_tokens) ||
						usage.cache_write_input_tokens < 0))
			)
				throw new Error("Invalid Codex turn.completed usage");
			terminal = event;
			return;
		}
		case "turn.failed":
		case "error": {
			const message =
				event.type === "turn.failed" ? event.error?.message : event.message;
			if (!text(message)?.trim() || (event.type === "turn.failed" && !codexTurnStarted))
				throw new Error("Invalid Codex error event");
			error ??= message.slice(0, 4096);
			terminal = event;
			return;
		}
		case "item.started":
		case "item.updated":
		case "item.completed": {
			const item = event.item;
			if (
				!codexThreadStarted ||
				!text(item?.id)?.trim() ||
				![
					"agent_message", "reasoning", "command_execution", "file_change",
					"mcp_tool_call", "collab_tool_call", "web_search", "todo_list", "error",
				].includes(item.type)
			)
				throw new Error("Invalid Codex item event");
			// Native warnings are completed error items, including before turn.started.
			// They are nonfatal diagnostics retained in stdout, not terminal errors.
			if (item.type === "error") {
				if (event.type !== "item.completed" || !text(item.message)?.trim())
					throw new Error("Invalid Codex warning item");
				return;
			}
			if (!codexTurnStarted) throw new Error("Codex item before turn.started");
			if (item.type === "agent_message" || item.type === "reasoning") {
				if (text(item.text) === undefined) throw new Error("Invalid Codex message text");
				if (item.type === "agent_message" && event.type === "item.completed")
					codexAnswer = item.text;
			}
			return;
		}
		default:
			throw new Error("Unknown Codex exec event");
	}
}
function parse(line) {
	if (!line.trim()) return;
	try {
		const event = JSON.parse(line);
		if (
			Object.prototype.toString.call(event) !== "[object Object]" ||
			!text(m.cli === "agy" ? event.event : event.type)
		)
			throw new Error("Invalid stream-json event");
		if (m.cli === "codex") {
			parseCodex(event);
			return; // Exec events do not report an observed model.
		}
		if (terminal && m.cli === "cursor") malformed = true;
		const model =
			m.cli === "agy"
				? event.init?.model
				: (event.model ?? event.message?.model);
		if (text(model)) observedModel = model.slice(0, 256);
		if (
			(m.cli === "agy" && event.event === "result") ||
			(m.cli !== "agy" && event.type === "result")
		) {
			if (terminal) malformed = true;
			terminal = m.cli === "agy" ? event.result : event;
		}
		if (event.type === "error") error = JSON.stringify(event).slice(0, 4096);
	} catch {
		malformed = true;
	}
}
async function terminate() {
	if (!child?.pid || terminationConfirmed || killPending) return;
	if (child.exitCode !== null || child.signalCode !== null) exited = true;
	// Never target a reused PID after observing the owned child exit.
	if (process.platform === "win32") {
		if (exited) return;
		killPending = new Promise((resolve) => {
			const killer = spawn(
				join(process.env.SystemRoot || "C:/Windows", "System32/taskkill.exe"),
				["/PID", String(child.pid), "/T", "/F"],
				{ shell: false, windowsHide: true, stdio: "ignore" },
			);
			killer.once("error", () => resolve(false));
			killer.once("close", (code) => resolve(code === 0));
		});
		terminationConfirmed = await killPending;
	} else {
		// After root exit, only observe group absence; never signal a potentially reused PGID.
		if (!exited) {
			try {
				process.kill(-child.pid, "SIGKILL");
			} catch (e) {
				if (e.code !== "ESRCH") return;
			}
		}
		try {
			process.kill(-child.pid, 0);
		} catch (e) {
			terminationConfirmed = e.code === "ESRCH";
		}
	}
	killPending = undefined;
}
function requestCancel(reason) {
	intent ??= reason;
	void terminate();
}
process.on("SIGTERM", () => requestCancel("cancelled"));
process.on("SIGINT", () => requestCancel("cancelled"));
let timer;
try {
	if (
		m.platform !== process.platform ||
		!["agy", "cursor", "claude", "codex"].includes(m.cli) ||
		(m.codexSandbox !== undefined && m.cli !== "codex")
	)
		throw new Error("Invalid native launch manifest");
	if (existsSync(join(dir, "cancel"))) {
		intent = "cancelled";
		terminationConfirmed = true;
	} else {
		let args = ["-p", "--output-format", "stream-json"];
		if (m.cli === "agy")
			args = [
				"-p",
				`Task:\n${m.task}`,
				"--output-format",
				"stream-json",
				"--disable-slash-commands",
				"--print-timeout",
				`${m.timeoutSeconds}s`,
				...(m.autonomous
					? ["--dangerously-skip-permissions"]
					: ["--mode", "plan"]),
			];
		if (m.cli === "claude")
			args.push(
				"--verbose",
				...(m.autonomous
					? ["--dangerously-skip-permissions"]
					: ["--permission-mode", "plan"]),
			);
		if (m.cli === "cursor")
			args.push(
				"--workspace",
				m.cwd,
				"--sandbox",
				process.platform === "win32" && m.allowUnsandboxed === true
					? "disabled"
					: "enabled",
				...(m.autonomous ? ["--force"] : ["--mode", "ask"]),
				...(m.trustWorkspace === true ? ["--trust"] : []),
				"--add-dir",
				dir,
			);
		if (m.cli === "codex") {
			if (
				!text(m.command) ||
				!isAbsolute(m.command) ||
				/[\r\n\0]/.test(m.command) ||
				(process.platform === "win32" && !/\.exe$/i.test(m.command)) ||
				!text(m.task)?.trim() ||
				m.autonomous === true ||
				m.trustWorkspace === true ||
				m.allowUnsandboxed === true ||
				(m.codexSandbox !== undefined &&
					!["read-only", "workspace-write"].includes(m.codexSandbox)) ||
				(m.effort !== undefined &&
					!["low", "medium", "high", "xhigh"].includes(m.effort))
			)
				throw new Error("Invalid Codex native command, sandbox, permissions, or effort");
			args = [
				"exec",
				"--json",
				"--color", "never",
				"--sandbox", m.codexSandbox ?? "read-only",
				"-c", 'approval_policy="never"',
			];
			if (m.effort) args.push("-c", `model_reasoning_effort="${m.effort}"`);
		}
		if (m.model) args.push("--model", m.model);
		if (m.effort && m.cli !== "codex") args.push("--effort", m.effort);
		if (m.cli === "codex") args.push("-");
		if (m.cli === "cursor")
			args.push(
				`Read the complete task from the private file at ${join(dir, "task.txt")}. Follow it and return the final answer.`,
			);
		let command = m.command;
		if (process.platform === "win32" && /\.ps1$/i.test(command)) {
			if (
				m.cli !== "cursor" ||
				!text(command) ||
				!isAbsolute(command) ||
				basename(command).toLowerCase() !== "cursor-agent.ps1" ||
				!text(m.powershell) ||
				!/^[A-Za-z]:[\\/]/.test(m.powershell) ||
				/[\r\n\0]/.test(m.powershell) ||
				basename(m.powershell).toLowerCase() !== "pwsh.exe" ||
				/[\\/](wsl|msys|cygwin)[\\/]/i.test(m.powershell) ||
				!statSync(m.powershell).isFile()
			)
				throw new Error("Invalid native Cursor PowerShell 7 launcher");
			args = [
				"-NoLogo",
				"-NoProfile",
				"-NonInteractive",
				"-File",
				command,
				...args,
			];
			// Use exactly the absolute native executable validated by the parent.
			command = m.powershell;
		}
		// Keep normal OS context and saved native authentication, not Pi provider/session overrides.
		const env = Object.fromEntries(
			Object.entries(process.env).filter(([key]) =>
				/^(PATH|PATHEXT|SystemRoot|WINDIR|COMSPEC|HOME|USERPROFILE|USER|LOGNAME|APPDATA|LOCALAPPDATA|TEMP|TMP|TMPDIR|LANG|LC_.*|TERM|SSL_CERT_FILE|SSL_CERT_DIR|HTTP_PROXY|HTTPS_PROXY|NO_PROXY)$/i.test(
					key,
				),
			),
		);
		// Claude's native OAuth token/config directory are user auth, not Pi provider overrides.
		if (m.cli === "claude") {
			for (const key of ["CLAUDE_CONFIG_DIR", "CLAUDE_CODE_OAUTH_TOKEN"]) {
				if (process.env[key]) env[key] = process.env[key];
			}
		}
		// Codex-native directory selection only; never forward API keys or Pi provider secrets.
		if (m.cli === "codex") {
			for (const [key, value] of Object.entries(process.env)) {
				if (/^CODEX_HOME$/i.test(key)) env[key] = value;
			}
		}
		const deadline = Date.now() + m.timeoutSeconds * 1000;
		child = spawn(command, args, {
			cwd: m.cwd,
			env,
			shell: false,
			detached: process.platform !== "win32",
			windowsHide: true,
			stdio: ["pipe", "pipe", "pipe"],
		});
		// Root exit can precede stream close when descendants keep pipes open.
		child.once("exit", () => {
			exited = true;
		});
		child.once("spawn", () => {
			try {
				atomic("started.json", {
					runnerPid: process.pid,
					childPid: child.pid,
					spawnedAt: Date.now(),
				});
			} catch (e) {
				error = e.message;
				requestCancel("cancelled");
			}
		});
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			log(0, chunk);
			pending += chunk;
			let split;
			while ((split = pending.indexOf("\n")) >= 0) {
				const line = pending.slice(0, split);
				pending = pending.slice(split + 1);
				if (line.length > lineLimit) malformed = true;
				else parse(line);
			}
			if (pending.length > lineLimit) {
				malformed = true;
				pending = "";
			}
		});
		child.stderr.on("data", (chunk) => {
			log(1, chunk);
			stderrTail = (stderrTail + chunk).slice(-4096);
		});
		child.stdin.on("error", (e) => {
			error ??= e.message;
		});
		if (m.cli === "claude" || m.cli === "codex") child.stdin.end(m.task);
		else child.stdin.end();
		timer = setInterval(() => {
			if (existsSync(join(dir, "cancel"))) requestCancel("cancelled");
			if (Date.now() > deadline) requestCancel("timeout");
		}, 250);
		await new Promise((resolve) => {
			child.once("error", (e) => {
				error = e.message;
			});
			child.once("close", () => {
				exited = true;
				resolve();
			});
		});
		if (pending) parse(pending);
		if (killPending) await killPending;
		// Cancellation without confirmed tree termination stays controllable, never final.
		while (intent && child.pid && !terminationConfirmed) {
			atomic("control.json", { state: "cancel unconfirmed", reason: intent });
			await new Promise((resolve) => setTimeout(resolve, 1000));
			await terminate();
		}
	}
} catch (e) {
	error = e.message;
}
clearInterval(timer);
for (const item of logs) closeSync(item.fd);
let output = m.cli === "agy" ? terminal?.response : terminal?.result;
let semanticSuccess =
	m.cli === "agy"
		? terminal?.status === "SUCCESS"
		: terminal?.subtype === "success" && terminal?.is_error === false;
if (m.cli === "codex") {
	output = codexAnswer;
	semanticSuccess = terminal?.type === "turn.completed";
}
const success = Boolean(
	!intent &&
	!error &&
	!malformed &&
	child?.exitCode === 0 &&
	semanticSuccess &&
	text(output) &&
	output.trim().length > 0
);
const protocolFailure = m.cli === "codex"
	? "Malformed, duplicate, conflicting, or post-terminal Codex exec event"
	: "Malformed or duplicate stream-json result";
const failure = String(
	error ||
		terminal?.error ||
		(malformed
			? protocolFailure
			: intent || JSON.stringify(terminal || "Missing terminal result")),
).slice(0, 4096);
const diagnostic = `${failure}\n${stderrTail}`;
const scriptPolicyFailure =
	process.platform === "win32" &&
	m.cli === "cursor" &&
	/\.ps1$/i.test(m.command) &&
	/running scripts is disabled on this system|about_Execution_Policies/i.test(
		diagnostic,
	);
const errorType =
	intent ||
	(scriptPolicyFailure
		? "protocol_or_launch"
		: /quota|rate.?limit|usage.?limit|credit|subscription/i.test(diagnostic)
		? "quota"
			: /auth|login|credential|unauthori[sz]ed/i.test(diagnostic)
				? "authentication"
				: malformed || !terminal
					? "protocol_or_launch"
					: "client_error");
atomic("final.json", {
	state: intent || (success ? "completed" : "failed"),
	exitCode: child?.exitCode ?? null,
	observedModel,
	output: text(output) ? output.slice(0, 16000) : "",
	error: success ? undefined : failure,
	errorType: success ? undefined : errorType,
	stderr: stderrTail,
	terminationConfirmed:
		!child?.pid || (exited && (!intent || terminationConfirmed)),
});
