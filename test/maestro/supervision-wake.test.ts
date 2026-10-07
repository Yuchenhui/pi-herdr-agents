import assert from "node:assert/strict";
import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { SupervisionCoordinator } from "../../maestro/core/supervision.ts";

test("parked wake wait observes a sidecar written after the registration reconcile", async () => {
	const dir = mkdtempSync(join(tmpdir(), "wake-parked-"));
	const supervisor = new SupervisionCoordinator(
		async () => ({
			complete: true,
			panes: [{ paneId: "child", workspaceId: "workspace" }],
		}),
		async () => ({
			kind: "present",
			agentStatus: "idle",
			observedAt: Date.now(),
		}),
	);
	try {
		const sessionFile = join(dir, "child.jsonl");
		const registration = supervisor.register(sessionFile, "child");
		assert.equal(supervisor.diagnostics().mode, "wake+batch");
		assert.equal(supervisor.diagnostics().watcherCount, 1);
		// Registration queues one reconcile. Consuming it leaves the next wait
		// parked on the directory watch, with no timer of its own.
		assert.equal(
			await registration.wait(new AbortController().signal),
			"reconcile",
		);
		const aborted = new AbortController();
		const early = registration.wait(aborted.signal);
		aborted.abort();
		await assert.rejects(early, /Aborted while waiting for subagent to finish/);
		const parked = registration.wait(new AbortController().signal);
		const temporary = `${sessionFile}.exit.tmp`;
		writeFileSync(temporary, "{}");
		renameSync(temporary, `${sessionFile}.exit`);
		assert.equal(await parked, "wake");
		registration.unregister();
		assert.equal(supervisor.diagnostics().watcherCount, 0);
	} finally {
		supervisor.close();
		rmSync(dir, { recursive: true, force: true });
	}
});
