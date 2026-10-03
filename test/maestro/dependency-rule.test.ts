import assert from "node:assert/strict";
import { builtinModules } from "node:module";
import { describe, it } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as ts from "typescript";
import {
	ALLOWLIST,
	type DependencyRuleAllowlistEntry,
} from "./dependency-rule-allowlist.ts";

type RepoArea =
	| "core"
	| "adapters/pi"
	| "adapters/fake"
	| "surfaces/herdr"
	| "surfaces/fake"
	| "runtime"
	| "pi-extension"
	| "other";

interface ModuleReference {
	file: string;
	specifier: string;
}

interface Violation extends ModuleReference {
	message: string;
}

const repoRoot = path.resolve(import.meta.dirname, "../..");
const rootsToScan = ["maestro", "pi-extension"];
const nodeBuiltins = new Set(
	builtinModules.flatMap((name) => {
		const bare = name.startsWith("node:") ? name.slice("node:".length) : name;
		return [bare, `node:${bare}`];
	}),
);

function toRepoPath(root: string, file: string) {
	return path.relative(root, file).split(path.sep).join("/");
}

function tsFilesUnder(root: string, relativeRoots: readonly string[]) {
	const files: string[] = [];
	for (const relativeRoot of relativeRoots) {
		const absoluteRoot = path.join(root, relativeRoot);
		if (!fs.existsSync(absoluteRoot)) continue;
		walk(absoluteRoot);
	}
	files.sort();
	return files;

	function walk(dir: string) {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const absolute = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(absolute);
			} else if (entry.isFile() && entry.name.endsWith(".ts")) {
				files.push(absolute);
			}
		}
	}
}

function moduleReferences(file: string): ModuleReference[] {
	const source = ts.createSourceFile(
		file,
		fs.readFileSync(file, "utf8"),
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);
	const references: ModuleReference[] = [];
	const add = (node: ts.Node | undefined) => {
		if (node && ts.isStringLiteralLike(node)) {
			references.push({ file, specifier: node.text });
		}
	};

	function visit(node: ts.Node) {
		if (ts.isImportDeclaration(node)) {
			add(node.moduleSpecifier);
		} else if (ts.isExportDeclaration(node)) {
			add(node.moduleSpecifier);
		} else if (ts.isImportTypeNode(node)) {
			const argument = node.argument;
			if (
				ts.isLiteralTypeNode(argument) &&
				ts.isStringLiteralLike(argument.literal)
			) {
				add(argument.literal);
			}
		} else if (ts.isCallExpression(node)) {
			if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
				add(node.arguments[0]);
			} else if (
				ts.isIdentifier(node.expression) &&
				node.expression.text === "require"
			) {
				add(node.arguments[0]);
			}
		} else if (
			ts.isImportEqualsDeclaration(node) &&
			ts.isExternalModuleReference(node.moduleReference)
		) {
			add(node.moduleReference.expression);
		}
		ts.forEachChild(node, visit);
	}

	visit(source);
	return references;
}

function isRelativeSpecifier(specifier: string) {
	return specifier.startsWith("./") || specifier.startsWith("../");
}

function isNodeBuiltin(specifier: string) {
	return nodeBuiltins.has(specifier);
}

function isChildProcess(specifier: string) {
	return specifier === "child_process" || specifier === "node:child_process";
}

function isAllowedPiHostPackage(specifier: string) {
	return (
		specifier.startsWith("@earendil-works/") ||
		specifier === "@sinclair/typebox"
	);
}

function classifyRepoPath(repoPath: string): RepoArea {
	if (repoPath.startsWith("pi-extension/")) return "pi-extension";
	if (repoPath.startsWith("maestro/core/")) return "core";
	if (repoPath.startsWith("maestro/adapters/pi/")) return "adapters/pi";
	if (repoPath.startsWith("maestro/adapters/fake/")) return "adapters/fake";
	if (repoPath.startsWith("maestro/surfaces/herdr/")) return "surfaces/herdr";
	if (repoPath.startsWith("maestro/surfaces/fake/")) return "surfaces/fake";
	if (repoPath.startsWith("maestro/runtime/")) return "runtime";
	return "other";
}

function isScannedSource(repoPath: string) {
	return rootsToScan.some(
		(relativeRoot) =>
			repoPath === relativeRoot || repoPath.startsWith(`${relativeRoot}/`),
	);
}

function importedArea(
	root: string,
	reference: ModuleReference,
): RepoArea | "external" {
	if (!isRelativeSpecifier(reference.specifier)) return "external";
	const resolved = path.resolve(
		path.dirname(reference.file),
		reference.specifier,
	);
	const repoPath = toRepoPath(root, resolved);
	return classifyRepoPath(repoPath);
}

function edgeKey(
	edge: Pick<ModuleReference, "file" | "specifier">,
	root: string,
) {
	return `${toRepoPath(root, edge.file)}\u0000${edge.specifier}`;
}

function isForbiddenEdge(root: string, reference: ModuleReference) {
	const importer = classifyRepoPath(toRepoPath(root, reference.file));
	const target = importedArea(root, reference);
	const specifier = reference.specifier;

	if (importer === "other") return false;
	if (target === "adapters/fake" || target === "surfaces/fake") {
		return true;
	}

	switch (importer) {
		case "core":
			return !(
				(target === "core" && isRelativeSpecifier(specifier)) ||
				(isNodeBuiltin(specifier) && !isChildProcess(specifier))
			);
		case "adapters/pi":
			return !(
				["core", "adapters/pi"].includes(target) ||
				isNodeBuiltin(specifier) ||
				isAllowedPiHostPackage(specifier)
			);
		case "surfaces/herdr":
			return !(
				["core", "surfaces/herdr"].includes(target) ||
				(isNodeBuiltin(specifier) && !specifier.startsWith("@earendil-works/"))
			);
		case "runtime":
			return !(
				["core", "adapters/pi", "surfaces/herdr", "runtime"].includes(target) ||
				isNodeBuiltin(specifier)
			);
		case "adapters/fake":
		case "surfaces/fake":
			return !(target === "core" || isNodeBuiltin(specifier));
		case "pi-extension":
			return target === "adapters/pi" || target === "surfaces/herdr";
		default:
			return false;
	}
}

function collectViolations(
	root = repoRoot,
	relativeRoots: readonly string[] = rootsToScan,
) {
	const violations: Violation[] = [];
	for (const file of tsFilesUnder(root, relativeRoots)) {
		const repoPath = toRepoPath(root, file);
		if (
			repoPath.startsWith("maestro/") &&
			classifyRepoPath(repoPath) === "other"
		) {
			violations.push({
				file,
				specifier: "",
				message: `${repoPath}: unsupported maestro source location`,
			});
			continue;
		}
		for (const reference of moduleReferences(file)) {
			if (isForbiddenEdge(root, reference)) {
				violations.push({
					...reference,
					message: `${repoPath}: forbidden import ${reference.specifier}`,
				});
			}
		}
	}
	return violations;
}

function filterAllowedViolations(
	violations: readonly Violation[],
	root = repoRoot,
	allowlist = ALLOWLIST,
) {
	const allowed = new Set(
		allowlist.map((entry) => `${entry.importer}\u0000${entry.specifier}`),
	);
	return violations.filter(
		(violation) => !allowed.has(edgeKey(violation, root)),
	);
}

function isCanonicalRepoPath(repoPath: string) {
	return (
		repoPath.length > 0 &&
		!path.isAbsolute(repoPath) &&
		repoPath === repoPath.split(path.sep).join("/") &&
		repoPath === path.posix.normalize(repoPath) &&
		!repoPath.startsWith("../") &&
		repoPath !== ".."
	);
}

function validateAllowlist(
	root = repoRoot,
	allowlist = ALLOWLIST,
	relativeRoots: readonly string[] = rootsToScan,
) {
	const errors: string[] = [];
	const keys = new Set<string>();
	const violations = collectViolations(root, relativeRoots);
	const violationKeys = new Set(
		violations.map((violation) => edgeKey(violation, root)),
	);
	for (const entry of allowlist) {
		const key = `${entry.importer}\u0000${entry.specifier}`;
		if (keys.has(key)) {
			errors.push(`${entry.importer}: duplicate allowlist ${entry.specifier}`);
		}
		keys.add(key);

		if (!entry.specifier.trim()) {
			errors.push(`${entry.importer}: allowlist entry missing specifier`);
		}
		if (!isCanonicalRepoPath(entry.importer)) {
			errors.push(
				`${entry.importer}: allowlist importer must be a canonical repo-relative path`,
			);
		}
		if (!entry.reason.trim()) {
			errors.push(`${entry.importer}: allowlist entry missing reason`);
		}
		if (!entry.removalTask.trim()) {
			errors.push(`${entry.importer}: allowlist entry missing removal task`);
		} else if (entry.removalTask === "Task 18") {
			errors.push(
				`${entry.importer}: allowlist entry must name the task that removes this edge, not only Task 18`,
			);
		}

		const importerPath = path.join(root, entry.importer);
		if (!fs.existsSync(importerPath)) {
			errors.push(`${entry.importer}: allowlist file does not exist`);
		}
		if (!isScannedSource(entry.importer)) {
			errors.push(
				`${entry.importer}: allowlist importer is not in a scanned root`,
			);
		}
		if (!violationKeys.has(key)) {
			errors.push(`${entry.importer}: stale allowlist ${entry.specifier}`);
		}
	}
	return errors;
}

function unallowedViolationMessages(
	root = repoRoot,
	allowlist = ALLOWLIST,
	relativeRoots: readonly string[] = rootsToScan,
) {
	return filterAllowedViolations(
		collectViolations(root, relativeRoots),
		root,
		allowlist,
	).map((violation) => violation.message);
}

function assertNoForbiddenImports(
	label: string,
	predicate: (v: Violation) => boolean,
) {
	const messages = filterAllowedViolations(
		collectViolations().filter(predicate),
	).map((violation) => violation.message);
	assert.deepEqual(messages, [], label);
}

function withScratchFixture(
	files: Record<string, string>,
	test: (root: string) => void,
) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-deps-"));
	try {
		for (const [file, contents] of Object.entries(files)) {
			const absolute = path.join(root, file);
			fs.mkdirSync(path.dirname(absolute), { recursive: true });
			fs.writeFileSync(absolute, contents);
		}
		test(root);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
}

describe("maestro dependency rule", () => {
	it("overall enforcement has no unallowlisted violations", () => {
		assert.deepEqual(unallowedViolationMessages(), []);
	});

	it("core imports only node builtins and core", () => {
		assertNoForbiddenImports("core dependency violations", (violation) =>
			toRepoPath(repoRoot, violation.file).startsWith("maestro/core/"),
		);
	});

	it("adapters/pi imports core, node, pi host packages", () => {
		assertNoForbiddenImports("adapters/pi dependency violations", (violation) =>
			toRepoPath(repoRoot, violation.file).startsWith("maestro/adapters/pi/"),
		);
	});

	it("surfaces/herdr imports core and node only", () => {
		assertNoForbiddenImports(
			"surfaces/herdr dependency violations",
			(violation) =>
				toRepoPath(repoRoot, violation.file).startsWith(
					"maestro/surfaces/herdr/",
				),
		);
	});

	it("runtime imports core, adapters, surfaces", () => {
		assertNoForbiddenImports("runtime dependency violations", (violation) =>
			toRepoPath(repoRoot, violation.file).startsWith("maestro/runtime/"),
		);
	});

	it("fakes import core and node only and nothing imports fakes", () => {
		assertNoForbiddenImports("fake dependency violations", (violation) => {
			const file = toRepoPath(repoRoot, violation.file);
			return (
				file.startsWith("maestro/adapters/fake/") ||
				file.startsWith("maestro/surfaces/fake/") ||
				violation.specifier.includes("/fake/")
			);
		});
	});

	it("pi-extension never imports adapters or surfaces directly", () => {
		assertNoForbiddenImports(
			"pi-extension dependency violations",
			(violation) =>
				toRepoPath(repoRoot, violation.file).startsWith("pi-extension/"),
		);
	});

	it("allowlist entries exist and still violate", () => {
		assert.deepEqual(validateAllowlist(), []);
	});

	it("scratch fixtures prove parser catches forbidden import forms", () => {
		withScratchFixture(
			{
				"maestro/core/static.ts": 'import "node:child_process";\n',
				"maestro/core/multiline.ts":
					'import {\n\texecFileSync,\n} from "node:child_process";\n',
				"maestro/core/export.ts": 'export * from "../adapters/pi/x.ts";\n',
				"maestro/core/dynamic.ts": 'await import("../surfaces/herdr/x.ts");\n',
				"maestro/core/require.ts":
					'const pi = require("@earendil-works/pi-ai");\n',
				"maestro/core/import-type.ts":
					'type Pi = import("@earendil-works/pi-ai");\n',
				"maestro/core/import-type-binding.ts":
					'import type { PiHost } from "@earendil-works/pi-ai";\n',
				"maestro/core/import-equals.ts":
					'import cp = require("child_process");\n',
				"maestro/adapters/pi/x.ts": "export {};\n",
				"maestro/surfaces/herdr/x.ts": "export {};\n",
			},
			(root) => {
				assert.deepEqual(
					collectViolations(root, ["maestro"]).map(
						(violation) => violation.message,
					),
					[
						"maestro/core/dynamic.ts: forbidden import ../surfaces/herdr/x.ts",
						"maestro/core/export.ts: forbidden import ../adapters/pi/x.ts",
						"maestro/core/import-equals.ts: forbidden import child_process",
						"maestro/core/import-type-binding.ts: forbidden import @earendil-works/pi-ai",
						"maestro/core/import-type.ts: forbidden import @earendil-works/pi-ai",
						"maestro/core/multiline.ts: forbidden import node:child_process",
						"maestro/core/require.ts: forbidden import @earendil-works/pi-ai",
						"maestro/core/static.ts: forbidden import node:child_process",
					],
				);
			},
		);
	});

	it("scratch fixtures reject fake imports from production and other fakes", () => {
		withScratchFixture(
			{
				"maestro/core/from-core.ts": 'import "../adapters/fake/x.ts";\n',
				"maestro/adapters/fake/from-adapter-fake.ts":
					'import "../../surfaces/fake/x.ts";\n',
				"maestro/surfaces/fake/x.ts": "export {};\n",
				"maestro/adapters/fake/x.ts": "export {};\n",
			},
			(root) => {
				assert.deepEqual(
					collectViolations(root, ["maestro"]).map(
						(violation) => violation.message,
					),
					[
						"maestro/adapters/fake/from-adapter-fake.ts: forbidden import ../../surfaces/fake/x.ts",
						"maestro/core/from-core.ts: forbidden import ../adapters/fake/x.ts",
					],
				);
			},
		);
	});

	it("scratch fixtures apply exact-edge allowlist to any scanned source", () => {
		withScratchFixture(
			{
				"maestro/adapters/pi/adapter-bridge.ts":
					'import "../../../pi-extension/allowed.ts";\nimport "../../../pi-extension/blocked.ts";\n',
				"pi-extension/allowed.ts": "export {};\n",
				"pi-extension/blocked.ts": "export {};\n",
			},
			(root) => {
				const allowlist: DependencyRuleAllowlistEntry[] = [
					{
						importer: "maestro/adapters/pi/adapter-bridge.ts",
						specifier: "../../../pi-extension/allowed.ts",
						reason: "Temporary adapter-to-legacy bridge",
						removalTask: "Task 9",
					},
				];
				assert.deepEqual(validateAllowlist(root, allowlist), []);
				assert.deepEqual(unallowedViolationMessages(root, allowlist), [
					"maestro/adapters/pi/adapter-bridge.ts: forbidden import ../../../pi-extension/blocked.ts",
				]);
			},
		);
	});

	it("scratch fixtures validate bad allowlist entries", () => {
		withScratchFixture(
			{
				"pi-extension/bridge.ts":
					'import "../maestro/adapters/pi/allowed.ts";\n',
				"maestro/adapters/pi/allowed.ts": "export {};\n",
				"test/not-scanned.ts": 'import "../maestro/adapters/pi/allowed.ts";\n',
			},
			(root) => {
				const badEntries: DependencyRuleAllowlistEntry[] = [
					{
						importer: "pi-extension/bridge.ts",
						specifier: "../maestro/adapters/pi/allowed.ts",
						reason: "Temporary bridge",
						removalTask: "Task 9",
					},
					{
						importer: "pi-extension/bridge.ts",
						specifier: "../maestro/adapters/pi/allowed.ts",
						reason: "Temporary bridge",
						removalTask: "Task 9",
					},
					{
						importer: "pi-extension/bridge.ts",
						specifier: "../maestro/adapters/pi/stale.ts",
						reason: " ",
						removalTask: "",
					},
					{
						importer: "pi-extension/missing.ts",
						specifier: "../maestro/adapters/pi/allowed.ts",
						reason: "Temporary bridge",
						removalTask: "Task 18",
					},
					{
						importer: "./pi-extension/bridge.ts",
						specifier: "",
						reason: "Temporary bridge",
						removalTask: "Task 9",
					},
					{
						importer: "test/not-scanned.ts",
						specifier: "../maestro/adapters/pi/allowed.ts",
						reason: "Temporary bridge",
						removalTask: "Task 9",
					},
				];
				assert.deepEqual(validateAllowlist(root, badEntries), [
					"pi-extension/bridge.ts: duplicate allowlist ../maestro/adapters/pi/allowed.ts",
					"pi-extension/bridge.ts: allowlist entry missing reason",
					"pi-extension/bridge.ts: allowlist entry missing removal task",
					"pi-extension/bridge.ts: stale allowlist ../maestro/adapters/pi/stale.ts",
					"pi-extension/missing.ts: allowlist entry must name the task that removes this edge, not only Task 18",
					"pi-extension/missing.ts: allowlist file does not exist",
					"pi-extension/missing.ts: stale allowlist ../maestro/adapters/pi/allowed.ts",
					"./pi-extension/bridge.ts: allowlist entry missing specifier",
					"./pi-extension/bridge.ts: allowlist importer must be a canonical repo-relative path",
					"./pi-extension/bridge.ts: allowlist importer is not in a scanned root",
					"./pi-extension/bridge.ts: stale allowlist ",
					"test/not-scanned.ts: allowlist importer is not in a scanned root",
					"test/not-scanned.ts: stale allowlist ../maestro/adapters/pi/allowed.ts",
				]);
			},
		);
	});

	it("scratch fixtures fail overall enforcement for unclassified maestro locations", () => {
		withScratchFixture(
			{
				"maestro/tools/escape.ts": 'import "../adapters/pi/x.ts";\n',
				"maestro/adapters/pi/x.ts": "export {};\n",
			},
			(root) => {
				assert.deepEqual(unallowedViolationMessages(root), [
					"maestro/tools/escape.ts: unsupported maestro source location",
				]);
			},
		);
	});

	it("scratch fixtures fail closed for unclassified maestro locations", () => {
		withScratchFixture(
			{
				"maestro/tools/escape.ts": 'import "../adapters/pi/x.ts";\n',
				"maestro/adapters/pi/x.ts": "export {};\n",
			},
			(root) => {
				assert.deepEqual(
					collectViolations(root, ["maestro"]).map(
						(violation) => violation.message,
					),
					["maestro/tools/escape.ts: unsupported maestro source location"],
				);
			},
		);
	});

	it("scratch fixtures scan all pi-extension source", () => {
		withScratchFixture(
			{
				"pi-extension/feature/direct.ts":
					'import "../../maestro/adapters/pi/x.ts";\n',
				"maestro/adapters/pi/x.ts": "export {};\n",
			},
			(root) => {
				assert.deepEqual(
					collectViolations(root).map((violation) => violation.message),
					[
						"pi-extension/feature/direct.ts: forbidden import ../../maestro/adapters/pi/x.ts",
					],
				);
			},
		);
	});
});
