import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { initializeTaskModels } from "../../maestro/runtime/task-model-init.ts";
import {
	buildTaskModelBrief,
	type TaskModelRegistryProjector,
	type TaskModelRegistrySnapshot,
} from "../../maestro/core/config/task-model-init.ts";

test("Task17 composes the complete active projection and preserves the exact accepted prompt", () => {
	const calls: string[] = [];
	const models = [
		{ provider: "z", id: "unknown", name: "Unknown", reasoning: false },
		{
			provider: "a",
			id: "zero",
			name: "Zero",
			reasoning: true,
			thinkingLevelMap: { max: "max", xhigh: null },
			input: ["text", "image", "secret"],
			contextWindow: 99,
			maxTokens: 12,
			cost: { input: 0, output: 2, cacheRead: 0 },
			baseUrl: "secret-url",
		},
	];
	const registry = {
		getRegisteredProviderIds() {
			assert.equal(this, registry);
			calls.push("extensions");
			return ["a"];
		},
		getAvailable() {
			assert.equal(this, registry);
			calls.push("available");
			return models;
		},
		getProviderAuthStatus(provider: string) {
			assert.equal(this, registry);
			calls.push(`auth:${provider}`);
			return {
				source: provider === "a" ? "stored" : "secret-source",
				token: "secret-token",
			};
		},
		getAll() {
			throw new Error("no unauthenticated query");
		},
		getApiKey() {
			throw new Error("no authentication resolution");
		},
		refresh() {
			throw new Error("no refresh/network");
		},
	};
	const current = {
		agents: { worker: "a/zero" },
		default: "z/unknown",
		tasks: { coding: ["a/zero"] },
	};
	let projected: TaskModelRegistrySnapshot | undefined;
	const prompt = initializeTaskModels({
		projectActiveRegistry: (project: TaskModelRegistryProjector) => {
			calls.push("projection");
			projected = project(registry);
			return projected;
		},
		current,
		preferences: "  keep existing\nchoices  ",
	});
	assert.deepEqual(calls, [
		"projection",
		"extensions",
		"available",
		"auth:z",
		"auth:a",
	]);
	assert.ok(projected);
	const brief = buildTaskModelBrief(
		projected,
		current,
		"  keep existing\nchoices  ",
	);
	assert.equal(brief.current, current);
	assert.equal(brief.operatorPreferences, "keep existing\nchoices");
	assert.deepEqual(
		brief.models.map((m) => m.ref),
		["a/zero", "z/unknown"],
	);
	assert.equal(brief.models[0].cost?.input, 0);
	assert.equal(brief.models[0].cost?.cacheWrite, undefined);
	assert.equal(brief.models[1].cost, undefined);
	assert.equal(brief.models[0].extensionRegistered, true);
	assert.equal(brief.models[1].extensionRegistered, false);
	assert.deepEqual(brief.models[0].supportedThinkingLevels, [
		"off",
		"minimal",
		"low",
		"medium",
		"high",
		"max",
	]);
	assert.doesNotMatch(prompt, /secret-/);
	// Golden SHA-256 captured from the accepted pre-migration formatter and these complete facts.
	assert.equal(
		createHash("sha256").update(prompt).digest("hex"),
		"97c790122e9385f2540bfab4deafb6d2abb3e39987809b29d8a456b1d13a4079",
	);
	const unknown = initializeTaskModels({
		projectActiveRegistry: (project: TaskModelRegistryProjector) =>
			project({ getAvailable: () => [models[0]] }),
		current: { agents: {} },
		preferences: "",
	});
	const json = JSON.parse(unknown.match(/```json\n([\s\S]*?)\n```/)![1]);
	assert.equal(Object.hasOwn(json.models[0], "extensionRegistered"), false);
	assert.deepEqual(json.models[0].auth, { configured: true });
});
