# Maestro Seams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put maestro's `HarnessAdapter`, `SurfaceProvider`, and `RunSession` seams into this repository under `maestro/`, with the existing Pi and Herdr code as the implementations and `pi-extension/subagents/index.ts` reduced to a composition root, with no public behavior change.

**Architecture:** A top-level `maestro/` directory with `core` (declarations and harness-neutral modules), `adapters/pi`, `surfaces/herdr`, and `runtime`. Existing function modules move by `git mv` and become the internals of `PiHarnessAdapter`, `HerdrSurfaceProvider`, and `createRunSession()`. In-memory fakes plus conformance suites make each seam testable without Herdr; a dependency-rule test enforces import direction.

**Tech Stack:** TypeScript run by Node with `--experimental-strip-types`, `node:test`, Biome, oxlint, Pi 1.0.0 host packages, Herdr CLI.

**Spec:** `docs/superpowers/specs/2026-10-02-maestro-seams-design.md`

**Stage 4 checkpoint:** Accepted at signed/tested
`e9f803992894d304c4eb5b7608ab6cce4464ee16`. Tasks 12/13 retain the corrected
contract; this documentation synchronization claims no new test result or full
migration completion. Ruling 26 approves the bounded Task 15 corrections below.
Task 14 is accepted locally after independent review and parent checks; Task 15
code waits for refreshed prerequisite evidence. The six-stage structure is
unchanged; Stages 5–6 remain. The final empty-allowlist/no-host-adapter-import
gate is Task 18, not Task 13.

## Global Constraints

- Branch `feat/maestro-seams`; one reviewed unit of work per task. Commit only when explicitly authorized by the user or parent coordinator. The Herdr integration suite runs at the end of every stage (tasks 5, 8, 11, 13, 18, 19) when the executor is inside Herdr and that suite is authorized.
- No public tool, command, role-pack, lifecycle, worktree, or persistent-specialist behavior changes. `test/integration/*.test.ts` must pass unmodified except for import paths.
- Every maestro declaration keeps its name and type; every added member carries the comment `// pi-herdr-agents extension`.
- Move commits contain `git mv` plus import-path updates only. Function bodies do not change in a move commit except for relocation-required resource paths such as the child `subagent-done.ts` path; those exceptions must be named in the task and verified immediately.
- `maestro/core` never imports `@earendil-works/*`, `node:child_process`, or any other `maestro/` directory or `pi-extension/`.
- Only `maestro/adapters/pi/**` and `pi-extension/subagents/**` may import `@earendil-works/*`.
- No non-test file imports a `fake` directory.
- `maestro/` ships in the npm tarball; `pi.extensions` in `package.json` is unchanged.
- Verification per task: `npm test`, `npm run lint`, `npm run format:check`, `git diff --check`, and LSP diagnostics on every changed `.ts` file. Report unrelated pre-existing diagnostics instead of fixing them. Per stage additionally `npm pack --dry-run` and, when authorized from inside Herdr, `npm run test:integration`.
- Do not bump `package.json` `version`.

## Review Focus

1. Grouped placement reached through the provider: the Agents tab pane cap and overflow-tab creation must behave exactly as `createHerdrGroupedSurface` does today when more than `maxPerTab` children launch. Pinned by Task 7's integration conformance case `grouped placement overflows to a new tab at the cap`.
2. Pane disappears before the `.exit` sidecar is written: `awaitCompletion` must still return `done` evidence within the 500 ms grace, never `unknown` clean. Pinned by Task 10's conformance case `late sidecar after pane absence`.
3. Persistent `send` while the specialist is busy must reject with the existing busy message and not enqueue. Pinned by Task 12's `send rejects when busy`.
4. Public Pi resume refuses managed-worktree and persistent policies before pane creation, while ordinary resume restores its saved policy. The fake's detached-resume case does not override real Pi safety; keep the explicit real-policy fixture cases from Task 10.
5. `/btw` runs `pi --no-extensions` in an interactive, replaceable background tab. Answering does not close it or steer the parent. Preserve the existing integration case `opens, replaces, and closes a context-aware BTW pane without steering the parent`, including explicit `/btw-close`.

---

## Stage 1: declarations, fakes, conformance, dependency rule

### Task 1: Core types and seam interfaces

**Files:**
- Create: `maestro/core/types.ts`
- Create: `maestro/core/harness-adapter.ts`
- Create: `maestro/core/surface-provider.ts`
- Create: `maestro/core/index.ts` (re-exports the three files)

**Interfaces:**
- Produces: everything in spec sections 4.1 to 4.3, including the extensions `Task.runtime.fallbacks`, `SpawnOptions.worktreeRequest?: WorktreeSpec` (upstream `worktree?: Worktree` remains unchanged), required `CompletionEvidence.exitCode`, `SurfaceInfo.group`, `SurfaceProvider.setupHint`, and `SurfaceProvider.runScript`. `ThinkingLevel` is re-declared in `types.ts` as the union from `runtime-routing.ts:9`. `PaneInspection` and `HerdrAgentStatus` (renamed `SurfaceAgentStatus`) are re-declared in `types.ts` from `lifecycle.ts:4-19`. `SurfaceProcessInfo` preserves the process identity fields currently exposed by `HerdrPaneProcessInfo`: `pids`, `shellPid`, `foregroundProcessGroupId`, and foreground process `pid`, `name`, `argv0`, `argv`, and `cwd`. `WorktreeHandoff` is re-declared from `launch.ts:70` without `paneId` and `workspaceId`, which stay on `WorktreeLaunch` in the adapter. Do not add a parameterless generic readiness method; Pi readiness is matched later by the Pi adapter using session and cwd from process info.

- [ ] **Step 1: Copy maestro's declarations**

Copy `AgentState`, `WorktreeSpec`, `Task`, `Role`, `WorktreeState`, `WorktreeOwnership`, `Worktree`, `SurfaceHandle`, `AgentHandle`, `RunOutcome`, `RunResult` from `/tmp/maestro-inspect/packages/core/src/types.ts:1-135` into `maestro/core/types.ts`; `SpawnOptions` and `HarnessAdapter` from `packages/adapters/src/harness-adapter.ts` into `maestro/core/harness-adapter.ts`; `SurfaceInfo`, `CreateSurfaceOptions`, `CreateWorktreeSurfaceOptions`, `WorktreeSurface`, `SurfaceProvider` from `packages/surfaces/src/surface-provider.ts` into `maestro/core/surface-provider.ts`. Change package imports to relative `./types.ts` imports. Keep maestro's doc comments.

- [ ] **Step 2: Add the extensions from spec 4.1 to 4.3**

Each added member gets `// pi-herdr-agents extension` on the line above.

- [ ] **Step 3: Verify**

Run: LSP diagnostics on the four new files. Expected: no new errors in those files.
Run: `npm run format:check && npm run lint`. Expected: pass, or report unrelated baseline failures. Scripts are updated in Task 5; until then run `npx biome format maestro && npx oxlint maestro` directly.

- [ ] **Step 4: Commit if explicitly authorized**

```bash
git add maestro/core
git commit -m "feat(maestro): add core types and seam interfaces"
```

### Task 2: Dependency-rule test

**Files:**
- Create: `test/maestro/dependency-rule.test.ts`
- Create: `test/maestro/dependency-rule-allowlist.ts`

**Interfaces:**
- Produces: `export const ALLOWLIST: readonly string[]` in the allowlist file, repo-relative file paths that may violate the `pi-extension/subagents` row. Starts empty.

- [ ] **Step 1: Write the test**

```ts
// test/maestro/dependency-rule.test.ts
describe("maestro dependency rule", () => {
  it("core imports only node builtins and core", ...);          // no node:child_process, no @earendil-works, no ../adapters|surfaces|runtime|pi-extension
  it("adapters/pi imports core, node, pi host packages", ...);   // never surfaces, runtime, pi-extension
  it("surfaces/herdr imports core and node only", ...);          // never adapters, runtime, pi-extension, @earendil-works
  it("runtime imports core, adapters, surfaces", ...);           // never pi-extension, @earendil-works
  it("fakes import core and node only and nothing imports fakes", ...);
  it("pi-extension never imports adapters or surfaces directly", ...); // except files in ALLOWLIST
  it("allowlist entries exist and still violate", ...);          // stale entries fail the test
});
```

Each failing assertion message is `"<file>: forbidden import <specifier>"`. Scan with `fs.readdirSync` recursively over `maestro/` and `pi-extension/`, parse TypeScript module references with the TypeScript compiler API (or an equivalently structured parser), and include static imports, `import type`, multiline imports, re-exports, dynamic `import()`, and `require()` calls. Resolve relative specifiers with `path.resolve` against the importing file, and classify by the first directory under `maestro/` or `pi-extension/`.

- [ ] **Step 2: Run it**

Run: `node --experimental-strip-types --test test/maestro/dependency-rule.test.ts`
Expected: PASS (only `maestro/core` exists and it imports nothing).

- [ ] **Step 3: Prove it detects a violation**

Temporarily add each mutation and then revert it: `import "node:child_process";`, a multiline `import { execFileSync } from "node:child_process";`, `export * from "../adapters/pi/x.ts";`, `await import("../surfaces/herdr/x.ts")`, and `require("@earendil-works/pi-ai")`. Rerun after each mutation and expect FAIL naming the file and specifier.

- [ ] **Step 4: Commit if explicitly authorized**

```bash
git add test/maestro/dependency-rule.test.ts test/maestro/dependency-rule-allowlist.ts
git commit -m "test(maestro): enforce import direction between core, adapters, surfaces, runtime"
```

### Task 3: FakeSurfaceProvider and surface conformance suite

**Files:**
- Create: `maestro/surfaces/fake/fake-surface-provider.ts`
- Create: `test/maestro/surface-provider.conformance.ts`
- Create: `test/maestro/fake-surface-provider.test.ts`

**Interfaces:**
- Produces: `export class FakeSurfaceProvider implements SurfaceProvider` with test controls `scriptInspection(surfaceId: string, inspection: PaneInspection): void`, `appendScreen(surfaceId: string, text: string): void`, `commands(surfaceId: string): string[]`, `removeSurface(surfaceId: string): void`, and constructor option `{ maxPerTab?: number }` (default 4) for grouped placement.
- Produces: `export function registerSurfaceProviderConformance(runner: { describe: typeof describe; it: typeof it }, name: string, factory: () => Promise<{ provider: SurfaceProvider; cwd: string; dispose(): Promise<void> }>): void`.

- [ ] **Step 1: Write the conformance suite**

Cases, each `it(...)`:
- `isAvailable returns a boolean and never throws`
- `createSurface returns an id listed by listSurfaces` with `name` and `cwd`
- `runCommand then readScreen shows the command output` (command: `echo conformance-marker`; expect `readScreen` to contain `conformance-marker` within 5 s)
- `inspectSurface returns a PaneInspection for a live surface`
- `closeSurface then waitForSurfaceAbsence resolves` (timeout 5 s)
- `grouped placement overflows to a new tab at the cap`: create `maxPerTab + 1` grouped surfaces; assert `listSurfaces()` has all ids and that their `group` values form exactly two distinct groups.
- `setupHint returns a non-empty string`
- `attachSurface returns a handle with sendKeys and close`
- `createWorktreeSurface registers neutral worktree inventory and removeWorktreeSurface removes it`: assert the returned path, branch, workspace id, and linked-worktree flag are listed before removal without requiring a surface id in the listing; assert the created surface is absent after removal. Do not require filesystem side effects in the fake conformance case.

- [ ] **Step 2: Write the fake and its test file**

`test/maestro/fake-surface-provider.test.ts` calls `registerSurfaceProviderConformance({ describe, it }, "FakeSurfaceProvider", async () => ...)` with a temp dir and a fully in-memory fake. `createWorktreeSurface` records deterministic metadata under the temp dir but does not run Git or create a checkout. No shell is executed by `runCommand`; the fake appends `"$ " + command` and, for `echo <x>`, appends `<x>`.

- [ ] **Step 3: Run**

Run: `node --experimental-strip-types --test test/maestro/fake-surface-provider.test.ts test/maestro/dependency-rule.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit if explicitly authorized**

```bash
git add maestro/surfaces/fake test/maestro/surface-provider.conformance.ts test/maestro/fake-surface-provider.test.ts maestro/core/surface-provider.ts
git commit -m "test(maestro): surface provider conformance suite with in-memory fake"
```

### Task 4: FakeHarnessAdapter and harness conformance suite

**Files:**
- Create: `maestro/adapters/fake/fake-harness-adapter.ts`
- Create: `test/maestro/harness-adapter.conformance.ts`
- Create: `test/maestro/fake-harness-adapter.test.ts`

**Interfaces:**
- Produces: `export class FakeHarnessAdapter implements HarnessAdapter` with controls `complete(handleId: string, evidence: CompletionEvidence): void`, `fail(handleId: string, error: string): void`, `ping(handleId: string, message: string): void`, `spawned(): AgentHandle[]`, `inputs(handleId: string): string[]`. All scripted completion evidence includes required `exitCode`.
- Produces: `export function registerHarnessAdapterConformance(runner, name, factory: () => Promise<{ adapter: HarnessAdapter; spawnOptions: () => SpawnOptions; finish(handle: AgentHandle, kind: "done" | "ping" | "error"): Promise<void>; dispose(): Promise<void> }>): void`. `finish` is how each implementation makes the child end: the fake calls its controls; the Pi integration test (Task 10) drives the deterministic provider.

- [ ] **Step 1: Write the conformance suite**

Cases:
- `spawn returns a handle whose harness equals adapter.name and startedAt is recent`
- `getState never throws and returns one of the five states`
- `awaitCompletion resolves done evidence` (`finish(handle, "done")`; expect `reason === "done"` and `exitCode === 0`)
- `awaitCompletion resolves ping evidence with name and message`
- `awaitCompletion resolves error evidence with errorMessage`
- `awaitCompletion rejects when the signal aborts` (abort after 50 ms; expect rejection message `/abort/i`)
- `interrupt leaves getState not done`
- `kill then getState returns done or unknown`
- `resume of a known session returns a new handle with the same sessionId`
- `late sidecar after pane absence`: implementation-specific hook `factory().lateSidecar?: (handle) => Promise<void>`; when present, call it and expect `awaitCompletion` to resolve `done` rather than reject.
- `resume ignores worktree ownership`: spawn with `worktree` set, `finish` done, then `resume({ sessionId })`; expect the new handle has `worktree === undefined`.

- [ ] **Step 2: Write the fake and its test file**

`awaitCompletion` in the fake returns a promise settled by `complete`, `fail`, or `ping`, and rejects with `new Error("Aborted while waiting for subagent to finish")` on signal abort, the same text as `completion.ts:5`.

- [ ] **Step 3: Run**

Run: `node --experimental-strip-types --test test/maestro/fake-harness-adapter.test.ts test/maestro/dependency-rule.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit if explicitly authorized**

```bash
git add maestro/adapters/fake test/maestro/harness-adapter.conformance.ts test/maestro/fake-harness-adapter.test.ts
git commit -m "test(maestro): harness adapter conformance suite with in-memory fake"
```

### Task 5: Package scripts and stage 1 gate

**Files:**
- Modify: `package.json` scripts `format`, `format:check`, `lint`, `test`

- [ ] **Step 1: Update scripts**

Add `maestro` to `format`, `format:check`, and `lint` argument lists. Add `test/maestro/*.test.ts` to the `test` script's file list.

- [ ] **Step 2: Verify**

Run: `npm test && npm run lint && npm run format:check && git diff --check`
Expected: all pass; record the observed test count instead of hard-coding it.
Run: `npm pack --dry-run 2>&1 | grep -c '^npm notice .*maestro/'`
Expected: a number greater than 0.
Run: `npm run test:integration` from inside Herdr when authorized.
Expected: pass; record observed pass/fail/skip counts instead of hard-coding them.

- [ ] **Step 3: Commit if explicitly authorized**

```bash
git add package.json
git commit -m "chore: include maestro in lint, format, and test scripts"
```

---

## Stage 2: Herdr surface provider

### Task 6: Move the Herdr driver

**Files:**
- Move: `pi-extension/subagents/herdr.ts` to `maestro/surfaces/herdr/herdr.ts`
- Move: `pi-extension/subagents/terminal.ts` to `maestro/surfaces/herdr/terminal.ts`
- Modify: imports in `pi-extension/subagents/index.ts:38-39`, `pi-extension/subagents/launch.ts:16,37`, `pi-extension/subagents/worktree-cleanup.ts`, `test/test.ts`, `test/worktree-cleanup.test.ts`, `test/integration/harness.ts` if it imports either file
- Modify: `test/maestro/dependency-rule-allowlist.ts`

- [ ] **Step 1: `git mv` both files and fix imports**

`herdr.ts` imports `./lifecycle.ts` for `PaneInspection` and `HerdrAgentStatus`; change those to `../../core/types.ts` (`SurfaceAgentStatus`). Add `pi-extension/subagents/index.ts`, `pi-extension/subagents/launch.ts`, and `pi-extension/subagents/worktree-cleanup.ts` to `ALLOWLIST`.

- [ ] **Step 2: Verify**

Run: `npm test && npm run lint && npm run format:check`. Expected: pass.

- [ ] **Step 3: Commit if explicitly authorized**

```bash
git commit -am "refactor(maestro): move Herdr driver under maestro/surfaces/herdr"
```

### Task 7: HerdrSurfaceProvider

**Files:**
- Create: `maestro/surfaces/herdr/herdr-surface-provider.ts`
- Create: `test/integration/surface-conformance.test.ts`
- Test: `test/maestro/herdr-surface-provider.test.ts` (unit, with `__herdrTest__` fakes from `herdr.ts:987`)

**Interfaces:**
- Produces: `export class HerdrSurfaceProvider implements SurfaceProvider { constructor(options: { paneConfig: PaneConfig }) }`. Method mapping: `isAvailable` to `isHerdrAvailable`; `createSurface` with placement `grouped` to `createHerdrGroupedSurface(name, cwd, paneConfig.maxPerTab, paneConfig.direction)`, `split` to `createHerdrSurfaceSplit`, `tab` to `createHerdrSurface`; `runCommand` to `sendHerdrCommand`; `runScript` to `runScriptInPane`; `readScreen` to `readHerdrScreen`; `closeSurface` to `closeHerdrSurface`; `listSurfaces` to `listHerdrPanes` mapped to `SurfaceInfo` with `group` set to the pane's tab id and `workspaceId` set to the pane's workspace id; `attachSurface` returns `{ id, runCommand, readScreen, sendKeys: pane send-keys, close }`; `inspectSurface` to `inspectHerdrPane` normalized to `PaneInspection`; `sendKeys` to `herdr pane send-keys`; `getProcessInfo` to `getHerdrPaneProcessInfo` with all foreground process identity fields; `waitForShellReady` to `waitForHerdrShellReady`; `waitForSurfaceAbsence` to `waitForHerdrPaneAbsence`; `createWorktreeSurface` to `createHerdrWorktree`; `removeWorktreeSurface` to `removeHerdrWorktree`; `listWorktreeSurfaces({ cwd, timeoutMs })` to one `listHerdrWorktrees(cwd, timeoutMs)` call as neutral `WorktreeSurfaceInfo` records; `focusWorkspace` to `focusHerdrWorkspace`; `setTitle` to `renameHerdrTab` or `renameHerdrWorkspace`. Pi process readiness is not a provider method; Task 8 builds the current session/cwd check from `getProcessInfo`.

- [ ] **Step 1: Write the unit test**

`test/maestro/herdr-surface-provider.test.ts`: using `__herdrTest__` injection, assert `createSurface({ placement: { kind: "grouped" } })` calls the grouped path with the configured cap and direction, `createSurface({})` defaults to grouped, and `listSurfaces()` maps pane entries to `SurfaceInfo` with `group` and reported `workspaceId`.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --experimental-strip-types --test test/maestro/herdr-surface-provider.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement `HerdrSurfaceProvider`**

- [ ] **Step 4: Write the integration conformance test**

`test/integration/surface-conformance.test.ts` calls `registerSurfaceProviderConformance({ describe, it }, "HerdrSurfaceProvider", ...)` with `createTestEnv` from `test/integration/harness.ts:257` for the cwd and tracked cleanup via `cleanupTestEnv`. Skip-free: if `HERDR_ENV !== "1"` the test fails with the harness's existing message, matching the other integration tests.

- [ ] **Step 5: Run**

Run: `node --experimental-strip-types --test test/maestro/herdr-surface-provider.test.ts`. Expected: PASS.
Run: `node --experimental-strip-types --test --test-concurrency=1 test/integration/surface-conformance.test.ts` inside Herdr. Expected: PASS.

- [ ] **Step 6: Commit if explicitly authorized**

```bash
git add maestro/surfaces/herdr/herdr-surface-provider.ts test/maestro/herdr-surface-provider.test.ts test/integration/surface-conformance.test.ts
git commit -m "feat(maestro): HerdrSurfaceProvider behind the SurfaceProvider seam"
```

### Task 8: Route launch and index through the provider

**Files:**
- Modify: `pi-extension/subagents/launch.ts:164-237` (`PiLaunchOperations`, `defaultOperations`)
- Modify: `pi-extension/subagents/index.ts` call sites: `isTerminalAvailable` (5), `terminalSetupHint` (4), `closePane` (3), `createSubagentPane` (1), `inspectPane` (1), `interruptPane` (1), `listPanes` (1), `readPaneAsync` (1), `runScriptInPane` (1), `waitForShellReady` (1), `listHerdrWorktrees` (1), `shellQuote` (6)
- Modify: `pi-extension/subagents/worktree-cleanup.ts` operations construction
- Modify: `test/launch.test.ts`, `test/test.ts` where they build `PiLaunchOperations`

**Interfaces:**
- Produces: `export function launchOperationsFromSurface(provider: SurfaceProvider, paneConfig: PaneConfig): PiLaunchOperations` in `launch.ts`; `defaultOperations` becomes `launchOperationsFromSurface(new HerdrSurfaceProvider({ paneConfig }), paneConfig)`. Its `waitForPiReady(surface, sessionFile, cwd)` polls `provider.getProcessInfo(surface)` and matches the expected Pi `--session` and cwd, preserving `waitForHerdrPiReady` semantics without a parameterless generic readiness hook.
- Produces: `index.ts` holds one `surfaceProvider: SurfaceProvider` in `createSubagentRuntime()` (`index.ts:1446`) and uses it for every call listed above. `shellQuote` moves to `maestro/core/shell.ts` (pure string function) and is imported from there. `terminalSetupHint` becomes `surfaceProvider.setupHint()`.

- [ ] **Step 1: Write the test**

In `test/launch.test.ts` add `it("launchOperationsFromSurface maps createPane to the provider's grouped placement")` using `FakeSurfaceProvider`: after `createPane("x", cwd)`, `provider.listSurfaces()` has one entry with `name === "x"`.

- [ ] **Step 2: Run it to verify it fails**. Expected: `launchOperationsFromSurface` is not exported.

- [ ] **Step 3: Implement the mapping and replace the index.ts call sites**

- [ ] **Step 4: Verify**

Run: `npm test && npm run lint && npm run format:check && git diff --check`. Expected: pass.
Run: `grep -n 'from "../../maestro/surfaces/herdr/terminal.ts"\|from "../../maestro/surfaces/herdr/herdr.ts"' pi-extension/subagents/index.ts`. Expected: no matches except the `HerdrSurfaceProvider` import in `createSubagentRuntime`.
Run: `npm run test:integration` inside Herdr when authorized. Expected: pass with the surface conformance included; record observed pass/fail/skip counts.

- [ ] **Step 5: Commit if explicitly authorized**

```bash
git commit -am "refactor(subagents): launch and index use the SurfaceProvider seam"
```

---

## Stage 3: Pi harness adapter

### Task 9: Move the Pi child protocol

**Files:**
- Move: `pi-extension/subagents/launch.ts`, `completion.ts`, `session.ts`, `task-model-init.ts` to `maestro/adapters/pi/`
- Move: `pi-extension/subagents/subagent-done.ts` to `maestro/adapters/pi/child/subagent-done.ts`
- Modify: imports in `index.ts`, `worktree-cleanup.ts`, `test/test.ts`, `test/launch.test.ts`, `test/worktree-cleanup.test.ts`, `test/integration/harness.ts`
- Modify: `test/maestro/dependency-rule-allowlist.ts` (remove `launch.ts`, keep `index.ts` and `worktree-cleanup.ts`)

- [ ] **Step 1: `git mv` and fix imports**

In `launch.ts`, confirm how the `-e` path for `subagent-done.ts` is computed (search `subagent-done`); if it is relative to `import.meta.url` of `launch.ts`, update the relative segment to `./child/subagent-done.ts`; if it is absolute from the package root, update the root-relative path. This relocation-required resource-path edit is the named exception to move-only body edits for this task. `launch.ts` imports of `./activity.ts`, `./lifecycle.ts`, `./runtime-routing.ts`, `./pane-config.ts`, `./type-guards.ts` become `../../../pi-extension/subagents/...` temporarily; these are the stage 5 moves and are allowed for `adapters/pi` only through explicit temporary allowlist entries. Add `maestro/adapters/pi/launch.ts` and `maestro/adapters/pi/session.ts` to `ALLOWLIST` with a comment `until stage 5`; do not hide these edges behind runtime re-exports.

- [ ] **Step 2: Verify**

Run: `npm test && npm run lint && npm run format:check`. Expected: pass.
Run: `node --experimental-strip-types --test --test-concurrency=1 test/integration/subagent-lifecycle.test.ts` inside Herdr. Expected: pass, which proves the child extension path still resolves.

- [ ] **Step 3: Commit if explicitly authorized**

```bash
git commit -am "refactor(maestro): move the Pi child protocol under maestro/adapters/pi"
```

### Task 10: PiHarnessAdapter

**Files:**
- Create: `maestro/adapters/pi/pi-harness-adapter.ts`
- Create: `test/maestro/pi-harness-adapter.test.ts` (unit, with `PiLaunchOperations` fakes as `test/launch.test.ts` does)
- Create: `test/integration/harness-conformance.test.ts`

**Interfaces:**
- Produces: `export class PiHarnessAdapter implements HarnessAdapter { constructor(options: { surface: SurfaceProvider; paneConfig: PaneConfig; modelRegistry: ModelRegistryAdapter; parent: FreshPiLaunchRequest["parent"]; wake: FileWakeRegistry; supervision: SupervisionCoordinator }) }`; `readonly name = "pi"`. Until Task 15, `ModelRegistryAdapter` and runtime-resolution helpers come from the existing `pi-extension/subagents/runtime-routing.ts` through an explicit temporary allowlist entry on `maestro/adapters/pi/pi-harness-adapter.ts`; do not launder this edge through a shallow runtime re-export. The adapter builds its `PiLaunchOperations` with `launchOperationsFromSurface(options.surface, options.paneConfig)` from Task 8.
- `interrupt` sends `Escape` through `surface.sendKeys`, preserving `interruptPane`; `kill` calls `surface.closeSurface` then `surface.waitForSurfaceAbsence`; `readOutput` calls `surface.readScreen`.
- `spawn(opts)` builds a `FreshPiLaunchRequest` from `SpawnOptions`: `name`, `task`, `agent: opts.role.name`, `cwd`, `worktree: opts.worktreeRequest`, `fork: opts.session?.mode === "fork"`, `surface: opts.surface?.id`, `parent` from the constructor, `runtimePlan` resolved from `opts.runtime` through `resolveRuntimePlan`, and `behavior` from `opts.behavior`, `opts.tools`, and `opts.role.defaults`. Returns `AgentHandle` with `id: child.id`, `sessionId: child.sessionFile`, `surfaceId: child.surface`, `worktree` mapped from `child.worktree`. Stores `PiRunningChild` in `private readonly children = new Map<string, PiRunningChild>()`.
- `resume(opts)` builds a `ResumePiLaunchRequest`.
- `awaitCompletion(handle, signal)` calls `waitForCompletion(signal, options)` with `readTerminalTail` from the surface, `inspectPane` from `surface.inspectSurface`, `sessionFile`, `waitForNextCheck` from the wake registry, then maps `CompletionResult` to `CompletionEvidence` preserving required `exitCode` and adding `finalMessage` from `inspectFinalAssistantMessage(sessionFile)`, `sessionRef: sessionFile`, and `worktree` from `captureWorktreeHandoff`.
- `getState` projects `readSubagentActivityFile` plus `inspectSurface` through `observeActivity` and `observePaneInspection` to `AgentState`: `done` when a completion was recorded, `working` while the activity phase is `active`, `blocked` when `waiting`, `idle` when `starting`, else `unknown`. Persistent inbox events, help requests, stop requests, and process exits remain explicit adapter observations; do not collapse them into `getState` inference.
- `exitCode(handle)` returns the recorded evidence's exit code or `undefined`.
- `sendInput` calls `writePersistentTaskInbox` for idle persistent children, preserves the existing busy rejection and no-queue behavior, and throws `"child is not a persistent specialist"` otherwise.

- [ ] **Step 1: Write the unit test**

`test/maestro/pi-harness-adapter.test.ts`: `spawn` with a fake `PiLaunchOperations` produces a handle with `harness === "pi"` and `sessionId` ending in `.jsonl`; `awaitCompletion` with a prewritten `.exit` sidecar `{ "type": "done", "exitCode": 0 }` resolves `reason === "done"` and `exitCode === 0`; `late sidecar after pane absence` writes the sidecar 200 ms after the fake pane disappears and expects `done`.

- [ ] **Step 2: Run it to verify it fails**. Expected: module not found.

- [ ] **Step 3: Implement the adapter**

- [ ] **Step 4: Write the integration conformance test**

`test/integration/harness-conformance.test.ts` registers the harness conformance suite with a factory that builds `HerdrSurfaceProvider`, `PiHarnessAdapter`, and the deterministic provider environment from `createTestEnv`, and whose `finish(handle, kind)` drives the child the way `subagent-lifecycle.test.ts` does for done, ping, and error.

- [ ] **Step 5: Run**

Run: unit test, expect PASS. Run the integration conformance test inside Herdr, expect PASS.

- [ ] **Step 6: Commit if explicitly authorized**

```bash
git add maestro/adapters/pi/pi-harness-adapter.ts test/maestro/pi-harness-adapter.test.ts test/integration/harness-conformance.test.ts
git commit -m "feat(maestro): PiHarnessAdapter behind the HarnessAdapter seam"
```

### Task 11: index.ts launches through the adapter

**Files:**
- Modify: `pi-extension/subagents/index.ts` functions `launchSubagent` (`:2461`), `launchSubagentWithFallbacks` (`:2631`), `watchSubagent` (`:2827`), `watchSubagentWithFallbacks` (`:2991`), the `subagent_resume` tool (`:3920`), `buildBtwLaunchCommand` (`:2378`)
- Modify: `test/maestro/dependency-rule-allowlist.ts`

- [ ] **Step 1: Replace `launchPiSubagent` calls with `adapter.spawn` and `adapter.resume`, and `waitForCompletion` with `adapter.awaitCompletion`**

Keep `RunningSubagent` in `index.ts` for this stage; store the `AgentHandle` on it and read `sessionFile` from `handle.sessionId`. The committed Stage 3 host shares the adapter's actual mutable child and preserves each owning adapter. BTW keeps provider-backed `runScript` and tracked script/snapshot cleanup (ruling 19), not runCommand.

- [ ] **Step 2: Verify**

Run: `grep -n 'launchPiSubagent\|waitForCompletion' pi-extension/subagents/index.ts`. Expected: no matches.
Run: `npm test && npm run lint && npm run format:check && git diff --check`. Expected: pass.
Run: `npm run test:integration` inside Herdr when authorized. Expected: pass; record observed pass/fail/skip counts.

- [ ] **Step 3: Commit if explicitly authorized**

```bash
git commit -am "refactor(subagents): index launches and watches through PiHarnessAdapter"
```

---

## Stage 4: Run session

### Task 12: generic createRunSession

**Files:**
- Create: `maestro/runtime/run-session.ts`, `surface-retention.ts`, `index.ts`
- Create: `test/maestro/run-session.test.ts`

**Contract:** Implement the complete generic declarations and semantics in spec
4.4, not upstream worktree pre-acquisition or Supervisor polling. Export
`createRunSession(options: RunSessionOptions): RunSession` and
`defaultRetainSurface(result: RunResult, task: Task): boolean`. Core/adapter/
surface ports remain unchanged. Pi-local composition is Task 13, not Task 12.

- Runtime owns logical Task/active owner/attempt cursor/controller/release state.
  `PreparedRun.role` supplies the captured role for Pi normalization; ordinary
  generic calls resolve from options.roles. Worktree requests pass as
  worktreeRequest, never invented Worktree objects.
- Reserve Task.id synchronously before async preparation/acquisition for spawn
  and resume. Conflicting reserved/active/previously acquired IDs reject before
  any preparation/resource call, including across adopted sessions. Release
  reservations only after failure with no acquired attempt; once acquired,
  prohibit reuse for the lifetime of the session, even after ordinary cleanup.
  Keep full entries only while pending, active, finalizing/delivering or acquired-
  but-unsettled after hook error. Terminal accepted/suppressed/failed delivery
  retires Task/attempts/adapter/controller/hooks/metadata ownership, retaining
  only the consumed-ID identity. Live getHandle/getTask return undefined then;
  already-joined promises retain their shared outcome/error, but new supervise
  calls reject clearly as retired/consumed without effects. Close promises may
  finish independently with only their needed capture. Handed-off worktrees/
  failed-delivery panes are not live registry history. No archive/cache,
  forget/eviction API or change to public opaque Pi IDs; the ID set grows with
  acquired runs, not constant-memory or allocation-free.
- Preparation validates the full candidate list before single-attempt options
  omit fallbacks. Explicit worktree lists are refused before acquisition.
- Without operations, wrap adapter-returned spawn/resume handles as owned
  attempts. Attach release only for an actual surfaceId plus supplied provider,
  closing that exact ID. A pid does not imply a surface; missing provider/ID
  means no release. Never acquire a surface, call kill/absence waits or invent
  observe via getState. Register ownership before awaiting onSpawned; propagate
  hook failure with the owner recoverable via getHandle/getTask and explicit
  supervise/controls/suppress, not fallback or silent cleanup. onSpawned runs
  once per acquired attempt. During a running fallback, hook failure rejects
  shared supervise waits and stops that producer without settling the logical
  run; explicit supervise restarts only on the registered new owner, with no
  re-acquisition, hook repetition or cursor advance.
- Launch failure iteration has no persistent exclusion. Running retry uses
  effective role-default persistence and evidence.errorMessage presence, not
  RunResult.error, error reason, exit status, truthiness or a provider classifier.
  Do not add a worktree guard to the running predicate.
- Owning adapter alone registers completion. Runtime consumes injected cheap
  observations; it neither adds a watcher nor polls getState for events/busy.
- Finalize attempts before parent hooks; suppress intermediate fallback
  settlement and retain all ordinary attempt panes until final delivery.
  Successful/explicitly suppressed hooks permit cleanup; rejected hooks retain
  panes. Ordinary help follows the same delivery gate. Process versus persistent
  task/help events stay separate. Default retention is worktree only. Issue
  authorized ordinary release best-effort, catching sync throws/async rejection;
  never back-pressure result delivery or process settlement on close promises.
- Resume requires a Task for hook identity; methods address the active owner.
  Supervision starts on the first valid non-aborted call. Callers join one
  runtime-owned producer with separate abort listeners; the adapter sees only
  the owned signal. An already-aborted caller starts nothing; one or last
  caller abort rejects only its wait with the existing wording, never settles,
  sends, retries, releases or cancels that producer/another caller. Later real
  completion still settles/delivers once. Only owned completion rejection maps
  abort to killed. Explicit suppression marks delivery first, aborts the owned
  wait, forbids fallbacks/hooks/drains/sends and authorizes ordinary cleanup,
  never managed-root release or implicit adapter.kill. With no producer, record
  killed/suppressed without registering, issue authorized cleanup and retire.
  After retirement, suppress is an idempotent no-op, not delayed cleanup of
  failed-delivery panes or re-delivery. Evidence winning the cancellation race
  retains its outcome but loses any undelivered parent hook.
- observe/refresh is supplied cheap presentation hydration only (undefined
  without an owner source); host timers and adapter events remain the consumers,
  not new runtime polling. Task.timeoutMs/defaultTimeoutMs are accepted but
  ignored; add no deadline, timer, timeout result or scheduler.

- [ ] **Step 1: Write independent seam tests**

Use both existing in-memory fakes plus small test-local observing/throwing/
owner fixtures where the fake lacks a production capability. Do not make fake
spawn acquire worktrees or fake send infer busy from coarse state. No temp-dir
argument to FileWakeRegistry: its optional constructor input is a watch
function. Coordinator tests inject the exact registry it owns.

Required cases:
- Role resolution, captured prepared role, env merge, tools/session/prompt/cwd
  forwarding, and worktreeRequest without any surface/worktree creation.
- Done/sentinel zero and nonzero, ping, error, owned abort and unexpected
  rejection mappings; evidence exitCode remains required. Caller-local abort
  rejects rather than mapping to a killed RunResult.
- Default operations path (not custom-owner fixtures): spawn and resume wrap
  the returned adapter owner; accepted/suppressed delivery closes the exact
  returned surface ID through the supplied provider once, after the gate, with
  no create/attach/kill/absence calls. Rejected delivery and worktree retention
  do not close it. Surface handle without provider and pid-only handle with
  provider both settle without release; getState/readOutput are not called and
  observe remains undefined.
- Use deferred preparation/acquisition to prove concurrent duplicate
  spawn/spawn, spawn/resume and resume/resume reject before those calls. Failed
  preparation/all-launch failure before acquisition permits explicit reuse;
  active and hook-failed entries reject reuse, as do consumed IDs after terminal
  ordinary/managed retirement. Assert getHandle/getTask disappear on accepted,
  suppressed and failed delivery, new supervise rejects as retired/consumed with
  no effects, joined callers still receive the shared outcome/error, and full
  entries/attempts/adapter owners/controllers/hooks are not retained. Deferred
  authorized closes must not keep those full owners alive.
- Deferred/throwing onSpawned after acquisition proves getHandle/getTask already
  expose ownership, original hook error reaches caller, no fallback acquisition,
  no onSettled or surface close (ordinary or managed). Cover initial spawn,
  resume and a running fallback acquisition: the latter rejects shared waits
  without a terminal RunResult. Explicit subsequent supervise completes once
  through the registered owner, with no new spawn/onSpawned/cursor advance;
  controls still reach it.
- Initial/ongoing/completion observation order, including activity health/detail,
  and a fixture that proves runtime never adds a completion registration.
  Explicit observe/refresh uses only the supplied source; no source means
  undefined, no getState or inspection. Accepted Task.timeoutMs and
  defaultTimeoutMs do not install runtime timers or settle a deferred producer;
  complete it explicitly to prove no synthesized deadline outcome.
- Launch throws advance ordinary **and persistent** candidates; all-launch
  failure order/message; a selected fallback followed by later running retry.
- Running evidence errorMessage absent/empty/nonempty; RunResult.error alone,
  nonzero exit alone and completed negative summary do not retry.
- Role.defaults.persistent blocks running retry unless explicitly overridden;
  worktree multi-candidate preparation refuses before calling any adapter;
  category worktree selection is covered in the Pi host tests, not a new
  synthetic worktree retry exclusion.
- Finalize-before-settlement and observe-before-settlement; accepted/suppressed
  delivery releases every ordinary attempt pane; rejected delivery releases
  none; worktree retention and ordinary help are tested separately. Defer an
  authorized ordinary close: settlement finishes while it remains unresolved;
  settle/reject it afterward and assert no unhandled rejection, repeated close
  or late parent send. Include synchronous close throws; no close/absence/exit
  wait is added to production settlement.
- New resume handle under logical task ID; active adapter owns send/interrupt/
  kill after retries. Missing target and mismatched supervise task fail clearly.
- Already-aborted caller: exact existing abort text, no registration/observation/
  settlement/retry/release. One of two callers aborting: only that wait rejects,
  owned adapter signal remains live, other caller receives later actual result.
  Last caller aborting: producer/registration remain live, no onSettled/fallback/
  cleanup, a new caller can join while live and later actual completion delivers
  once to joined callers; a new post-retirement caller rejects without effects.
  Assert registration/unregistration and hook/resource call counts, not only
  absence of kill. Explicit suppress: suppression precedes owned abort, yields
  shared killed/suppressed result, skips onSettled/retry and issues ordinary
  releases once while retaining managed roots. Cover suppression before
  producer creation, repeated live suppression and post-retirement no-op
  (including failed delivery: panes retained, no delayed close/re-delivery).
  Joined results/errors remain unchanged, and evidence winning an abort race
  never causes an unsuppressed late send.

- [ ] **Step 2: Run the focused test and record the actual failing evidence**
- [ ] **Step 3: Implement only the generic runtime and its fixtures**
- [ ] **Step 4: Run mandatory task checks and inspect the diff**

Run `npm test`, lint, format, diff check and LSP diagnostics on changed TS.
Record observed results; do not claim a production registration test using only
FakeHarnessAdapter. No runtime-to-legacy import exceptions are needed in the
generic module, which consumes core declarations and injected operations.

- [ ] **Step 5: Commit only if explicitly authorized**

Suggested subject: `feat(maestro): compose generic run ownership and delivery-gated cleanup`.

### Task 13: typed Pi composition and host wiring

**Files:**
- Create: `maestro/runtime/pi-run-session.ts`
- Modify: `maestro/runtime/index.ts` to export actual runtime operations and the
  section 4.4 declarations they consume
- Modify: `pi-extension/subagents/index.ts`, `test/test.ts`
- Modify: `test/maestro/dependency-rule-allowlist.ts` with exact live edges
- Create: `test/maestro/pi-run-session.test.ts` for the production composition

**Contract:** Implement `createDefaultRunSession(options:
DefaultRunSessionOptions, previous?: PiRunSession): PiRunSession` exactly as
spec 4.4. It composes the generic session with Pi normalized launch snapshots,
rich started/completed metadata, fresh adapter owners, single coordinator,
persistent session I/O and unwatched BTW operations. No shallow re-export of
session/launch/provider helpers replaces an actual consuming operation.

- [ ] **Step 1: Preserve Stage 3 host-through-adapter coverage before rewiring**

Keep/migrate `test/test.ts`'s `host adapter migration` cases using the actual
PiHarnessAdapter and injected launch/surface/coordinator seams. Test fixtures
import their actual owner modules and inject `PiRunSessionInfrastructure`;
deleting host __test__ launch wrappers is not permission to replace these
cases with only generic fake tests. Preserve provenance/cwd/tools/deny/body,
same persistent record and raw cursor, retryable task delivery, reload owners,
all retry panes retained until send, rejected-delivery retention, pre-delivery
manifest, and actual resume ID/post-cursor/no-new-output behavior.

- [ ] **Step 2: Compose and rewire only the replaced operations**

Delete replaced launch/watch/fallback loops. Host uses spawnPi/resumePi,
getStarted/getCompleted/getRecord, observe, interrupt and suppression; factory
owns adapter/provider/coordinator construction. Host produces immutable
PiLaunchInput and getLaunchSnapshot outputs; no mutable ambient launch metadata
or re-resolution of a validated plan. Use the explicit prepareAttempt callback
to preserve current per-actual-launch role rereads against the original host
invocation context; candidate plans stay prevalidated. Actual attempt persistence
and fresh opaque generation/task identities come from the child/normalizer. All public return/presentation fields
come from real Pi metadata, not fabricated handle projections. Those getters
are live-run queries, not historical APIs: getRecord/getStarted/getCompleted/
getControlTaskId return undefined after terminal retirement. The settlement
hook receives rich metadata before retirement, and the parent result carries
handoff data; do not add a metadata archive/cache.

Host sends parent messages in typed hooks; ordinary completion keeps
mark-delivered/delete-before-send behavior and failed-send pane retention.
Pre-delivery finalization is implemented in composition using existing
worktree/session helpers. Preserve the separate resumed late-read boundary:
only resumed acquisitions supply `PiSettlementIO.readResumeResult` to onSettled,
with detached path/cursor/exitCode/errorMessage scalars, not functions in result
metadata or shared persistent I/O. Host calls it after the pending-delivery gate,
mark-delivered/map-delete/widget update and ping handling. Ping bypasses it;
ordinary/persistent settlements and explicit suppression never invoke it. A real
late-read rejection sends nothing and retains the manual pane through the
existing rejected-settlement path, retiring both registries without observers.
Delivered stays absorbing; do not suppress, resend, fabricate errors or change
generic ports. Transient read recovery uses fresh post-cursor output or the
exact resumed fallback; ordinary caught processing errors retain their normal
exit-one payload and full live-child/fallback host details.
Pure worktree rules and Git infrastructure extraction
remain Task 16; they are not moved to core early.

Keep the existing persistent policy handlers as injected send/stop/drain
operations with PiPersistentIO. Host owns cap/name resolution, task delivery
and in-flight/ledger deduplication, raw cursor, timer/advisory policy and
facts-only stop/crash presentation. The runtime owns session I/O and the
adapter's actual child reference. Replace eager PiPersistentSnapshot/snapshot
with explicit readEvents/readLedger/readTaskSummary methods; no magic getters
or placeholder snapshots. Read raw events first, ledger once lazily after
cursor/generation/in-flight filtering, transcript only after dedup for an
undelivered task-done send. No transcript for help/quiet/irrelevant/duplicate
wakes and no Git capture for any persistent task event. Keep accepted send ->
ledger append -> matching assignment release/tasksCompleted -> pending-stop
start ordering; advance raw cursor only after the whole drain succeeds.
No duplicate initial ledger row. No getState busy/delivery inference.
Stop returns requested/pending acknowledgement, preserves active task, starts its timer at the existing point, retries failed
confirmation explicitly, and confirms stopped only at process completion.
Generic send/kill must not replace these acknowledged public operations.

BTW uses openBtw/closeBtw: retain active-leaf context, same model/thinking,
provider runScript artifacts, background tab placement, open/replace/explicit
close, no parent delivery and no auto-close after an answer. Host still waits
for idle and chooses completed leaf/context. On reload/new/resume/fork, adopt
the old live session/owners and consumed IDs and rebind callbacks. Final exit
suppresses all live runs before async callbacks can send/drain and closes the
coordinator. Shipped cleanup interleaves per-record suppression and abort in a
synchronous loop; promise handlers run afterward. This is delivery safety, not
an assertion of shipped two-pass code or a requirement for a new batch API.
Skip hooks/persistent drains/sends; issue best-effort authorized ordinary close,
catching synchronous throws/async rejection without joining producers,
finalizers or ordinary close promises. Preserve the existing closeBtw await.
Failed persistent TASK delivery leaves the PROCESS live: shutdown suppresses
it and issues ordinary cleanup. Terminal failed PROCESS delivery retires the
entry; later suppression is a no-op, not cleanup of its manual panes. Ordinary
close can terminate the child process, as shipped; retain managed roots/
workspaces. Do not add direct HarnessAdapter.kill, surface-absence/process-exit
waits or worktree removal.
The single registry explicitly supplied at composition replaces the one Stage
3 currently constructs by default inside its coordinator; do not create both.

Do not mechanically reduce RunningSubagent to presentation-only fields:
PiRunRecord is the same adapter mutable record, with host presentation and
persistent timer/delivery augmentation. Runtime owns handles/adapters/attempts/
consumer controllers; host must not keep a second active-owner registry.

- [ ] **Step 3: Add bounded composition regressions**

In addition to preserved host cases, cover full candidate validation before
fallback stripping; persistent role-default launch and running predicates;
raw error preservation and exhausted running fallback launch failures; exactly
one adapter registration with ongoing cheap observations; task/help events
without process cleanup; send rejection acknowledgement/one ledger row;
unconfirmed-stop guidance and explicit retry; suppressed/failed ordinary
help/resume delivery; rich workspace/pane IDs and manifest warnings; fresh
launch snapshots with old owners surviving replacement; per-attempt role rereads
without candidate re-resolution and correct control-ID namespaces; and BTW
script/snapshot cleanup without process settlement.

Additional fix-round regressions (spec 4.4 clauses are authoritative):
- Actual public resume: prelaunch read rejection acquires nothing; stable adapter
  and post-evidence processing failures send/close nothing, retain the pane and
  delivered state, and eagerly retire both owners. Record delivered/map-delete
  at the actual late read. Compare original Stage3 source replay to the current
  host with the real adapter, including transient recovery, fresh/no-new output,
  ping bypass and rejected-send no-resend/manual retention. Accepted delivery
  allows detached close. Mutate removal/early invocation/swallowed rejection of
  the reader and require behavioral failure; inspect private Pi entries before
  getters can prune them, including after all caller waits cancel.
- Real Pi/injected coordinator: already-aborted caller registers nothing; one
  or last observer abort leaves the runtime producer's single adapter wait
  registered/live; later completion delivers once. Explicit suppression marks
  lifecycle first, aborts that owned wait, skips all rebound sends/drains and
  releases ordinary panes but not managed roots. Rebinding/reload preserves
  the same producer even with no remaining external caller.
- Acquired Pi record/started metadata visible before awaited onSpawned;
  hook rejection preserves owner/control mapping and original error, with no
  fallback or managed close. Existing getters and explicit supervision recover
  it. Adopted sessions reject duplicate reserved/acquired control IDs before
  preparation, while keeping public run/generation/inbox identity semantics.
  At terminal accepted/suppressed/failed delivery, assert all live Pi getters
  (record/started/completed/control-ID) disappear, rich completed metadata was
  available to the settlement hook, joined callers retain their outcome/error,
  late supervise rejects as retired/consumed and late suppress does nothing.
  Consumed IDs still reject reuse without retaining full entries/adapter owners/
  hook/metadata histories, including retained worktrees/failed-delivery panes.
- Call-count fixtures on readEvents/readLedger/readTaskSummary and Git capture:
  quiet, irrelevant-generation, in-flight and behind-cursor duplicate wakes
  are 1/0/0/0; new raw ledger-acknowledged duplicates 1/1/0/0; help 1/1/0/0;
  new-done 1/1/1/0. Multiple eligible events share one ledger read and append
  returned acknowledgement rows to that snapshot. No send/append for duplicates;
  help/done send once before append, assignment release only after append;
  send/ledger failure keeps the failing event's assignment/count unchanged and
  raw cursor unadvanced for retry. Earlier acknowledged events in a multi-event
  drain stay committed and deduplicate on retry; do not roll back them.
- Shutdown reload/new/resume/fork retains live owners/registration and consumed
  IDs; quit/undefined suppresses all live delivery before async callbacks can
  send/drain (synchronous per-record suppress/abort interleaving is allowed).
  Ordinary live persistent pane closes even after failed TASK delivery, managed
  root stays open, no second drain/send or adapter.kill/absence/process-exit wait.
  Terminal failed PROCESS delivery instead retires, leaving manual panes; later
  suppress does not close them. Preserve both unmodified shipped
  `test/integration/placement.test.ts:587` cases: ordinary pane **and process**
  close, managed root retained. Integration assertions may poll the actual
  effect; production shutdown/settlement must not join ordinary close promises,
  producers or finalizers. A deferred-close fixture proves shutdown and normal
  settlement finish while ordinary close remains unresolved (existing BTW await
  preserved); afterward resolve/reject close and assert no unhandled rejection,
  repeated call or late parent send.

Use real Pi adapter/injected operations for registration, ledger and transcript
assertions. Manifest/Git fixture checks are not fake worktree conformance. Keep
real Pi resume policy refusal, and observe the original ordinary process before
resuming its session. Do not run concurrent integration suites.

- [ ] **Step 4: Apply the honest intermediate dependency gate**

Remove only host provider/adapter construction and session-consumption entries
that have actually disappeared. Retain host launch.ts (worktree handoff/test
helpers) until Task 16 and task-model-init.ts until Task 17. Keep the adapter's
compatibility launch.ts -> HerdrSurfaceProvider edge until Task 16, updating
its old Task 13 removal milestone. Production watched runs use explicit factory
launch operations; retained compatibility defaults serve staged handoff only.
Add exact runtime-to-legacy entries from the table below only when imported,
with reasons and removalTask. Type-only edges count. No broad directory/file
exemption and no stale entries.

Run `npm test`, lint, format, diff check, pack preview and changed-TS LSP
checks. Inspect host adapter/surface imports: expected remaining consumers are
exactly the Task 16 launch.ts and Task 17 task-model-init.ts edges, not zero.
Run the unchanged deterministic integration suite inside Herdr when authorized;
record real pass/fail/skip counts. Its BTW case tests explicit close, not normal
RunSession completion. Full strict/no-exception import verification is Task 18.

- [ ] **Step 5: Commit only if explicitly authorized**

Suggested subject: `refactor(subagents): consume typed Pi run-session composition`.

### Stage 4 producer–consumer and migration ledger

| Producer | Consumer | Concrete interface / ownership | Dependency milestone |
| --- | --- | --- | --- |
| Task 12 runtime | Task 13 composition and seam tests | RunSession, PreparedRun/OwnedRunAttempt, observations and delivery decisions in spec 4.4 | Generic module imports core only |
| Host role/routing normalization | Task 13 spawnPi | PiLaunchInput plus per-call PiLaunchSnapshot, complete ResolvedRuntimePlan provenance and raw omission semantics | Host role/config normalization Task 17; routing Task 15 |
| Task 13 factory | Host tools/hooks | PiRunSession, started/completed/record metadata; explicit prior-session adoption | Removes host direct adapter/provider construction in 13 |
| Pi adapter awaitCompletion/onObservation | Runtime supervise/host presentation | One adapter registration held by the owned producer despite caller cancellation; supplied cheap observe/refresh and demand-driven task drain | lifecycle/wake/supervision Task 14, activity Task 15 |
| Task 13 PiPersistentIO | Host persistent send/stop/drain/onSettled | Explicit raw readEvents, lazy readLedger, done-only readTaskSummary; no task-event Git capture; dispatch/reject/stop/ack/stopped mutations and typed acknowledgements | Session host import removed 13; host policy stays intentionally host-owned |
| Task 13 transcript/finalization | Host result rendering | Rich PiCompletedMetadata, run-scoped PiSettlementIO resume reader after delivery gate/mark/map-delete/ping, observed runtime, manifest finalized before delivery | Worktree state rules/Git infrastructure move in 16, not in 12 |
| Task 13 BTW operations | Host /btw and /btw-close | PiBtwInput/Metadata; open/replace/explicit close; no AgentHandle or settlement | Session/provider consumption removed 13 |
| Task 14 core lifecycle/status/wake/supervision and pure guards | Adapter/runtime/host | Core lifecycle types, existing coordinator/registry, explicit status config/example paths and early pure guard leaf | Removes all lifecycle/wake/supervision/type-guard transitional edges |
| Task 15 core routing, shared task-model types and Pi activity/SDK glue | Adapter/runtime/host | Validated-state projection + Pi-local detached activity observation; shared neutral registry construction with separate typed SDK glue; full ResolvedRuntimePlan/required capability port and core-local preference types | Removes all runtime-routing/activity legacy edges after accepted Task 14; no new exceptions |
| Task 16 core worktree rules + runtime worktree operations | Pi launch finalizer, host handoff/cleanup | Stable manifest owner and pure state rules; Git/manifest operations injected; meaningful handoff and cleanup builders below | Removes host launch.ts, legacy cleanup adapter/Herdr edges and compatibility launch provider default |
| Task 17 core roles/config + Pi init operation | Host/default composition/adapter/provider | Role defaults/source and configDir loaders; init consumes the complete sanitized active registry and returns existing prompt | Removes task-model-init host edge and remaining legacy config edges (guards ended in 14) |
| Task 18 dependency enforcement | All source | AST-parsed strict import rule, no exceptions or shallow-re-export laundering | Deletes allowlist and verifies zero host adapter/surface imports |

New transitional imports are pinned to `maestro/runtime/pi-run-session.ts`;
`maestro/runtime/index.ts` exports the implemented operation module, not legacy
modules. Record only imports actually needed:

| Exact specifier from pi-run-session.ts | Removal |
| --- | --- |
| `../../pi-extension/subagents/lifecycle.ts` | Task 14 |
| `../../pi-extension/subagents/wake.ts` | Task 14 |
| `../../pi-extension/subagents/supervision.ts` | Task 14 |
| `../../pi-extension/subagents/activity.ts` | Task 15 |
| `../../pi-extension/subagents/runtime-routing.ts` | Task 15 |
| `../../pi-extension/subagents/pane-config.ts` | Task 17 |

Core migration has two additional prerequisites visible in the actual source:
Task 14 moves the pure type-guards leaf earlier than the old Task 17 slot, and
makes status loader paths explicit; Task 15 moves shared task-preference types
before routing imports them. Do not create core-to-host exceptions to conceal
these sequencing corrections.

All existing Stage 3 exceptions not replaced in 13 keep their actual Task
14/15/16/17 lifetime. In particular host worktree-cleanup.ts imports launch.ts
and herdr.ts until 16; lifecycle.ts imports completion.ts until 14; adapter,
child and provider config edges remain until 17. Type-guard edges end in 14
under the explicit leaf-move correction below (update their old 17 milestones).
Do not assert an empty allowlist at the Stage 4 gate.

---

## Stage 5: core migration

### Task 14: Lifecycle, status, wake, supervision to core

**Files:**
- Move: `pi-extension/subagents/{lifecycle,status,wake,supervision}.ts` to `maestro/core/`
- Move: the pure leaf `pi-extension/subagents/type-guards.ts` to `maestro/core/config/type-guards.ts` (moved forward from Task 17)
- Modify: importers, host status loader call and `test/test.ts`

- [ ] **Step 1: Move with the named boundary adaptations**. `lifecycle.ts` types already duplicated in core/types.ts are imported from `./types.ts`, including ActivityReadResult, SubagentActivityScope and CompletionResult; core lifecycle must not import legacy activity.ts or adapter completion.ts. Move the pure type-guards leaf now so status and later routing/config imports remain inward. Update all exact type-guard edges' removalTask from 17 to 14 and remove them as their importers rewire. Status currently imports config-path.ts for default arguments: change the moved `loadStatusConfig` to `loadStatusConfig(configPath: string, examplePath: string): StatusConfig`, with host callers explicitly passing the same existing paths. This is a named path-injection adaptation, not a config behavior change or a pure git-mv claim. Do not put config-path.ts in core or add a core-to-host exception.
- [ ] **Step 2: Verify**: `npm test && npm run lint && npm run format:check`; dependency-rule test passes.
- [ ] **Step 3: Commit if explicitly authorized** `refactor(maestro): move lifecycle, status, wake, supervision into core`.

### Task 15: Split activity and routing

**Prerequisite:** Ruling 26 approves this bounded contract, not its source
implementation. Task 14 is accepted locally after independent review and parent
checks of its lifecycle/status/wake/supervision/guard moves, canonical types and
explicit status loader paths. Before dispatching Task 15 code, refresh affected
owners/consumers, literal imports, function-body comparisons, registry producer/
caller counts and baseline diagnostics. Copy only its parent-accepted prerequisite
delta; do not duplicate its moves or treat the Stage 4 snapshot alone as Task 14
acceptance. If refreshed evidence
cannot meet this contract, report the concrete gap rather than widen scope.

**Files:**
- Create: `maestro/core/activity.ts` with projectActivity wrapping validated state/absence and the existing pure scope predicate/set; activity declarations already live in `core/types.ts`. It is not a JSON/ID/error parser.
- Create: `maestro/adapters/pi/activity-file.ts` with the existing path helper, reader, writer and recorder. Retain private unknown-JSON/expected-ID validators and read/parse catch ordering/results; only missing and validated-success paths call projectActivity.
- Create: `maestro/core/config/task-model-types.ts` for TASK_CATEGORIES, TaskCategory, TASK_CATEGORY_DESCRIPTIONS, mutable TaskPreferences and TaskPreferencesMeta. Routing and legacy model-config consume that leaf until Task 17; no loader/I/O/SDK or core import back to host.
- Create: `maestro/core/routing.ts` with THINKING_LEVELS/isThinkingLevel, RuntimeRequest, ParentRuntime, RoutingModel, ModelRegistryAdapter, ResolvedRuntimePlan, RuntimeResolutionError, parsers, resolvers, authenticated preferences/catalog, private neutral normalization and shared registry construction. Routing calls the required capability port, not SDK functions.
- Create: `maestro/adapters/pi/model-registry.ts` and `pi-extension/subagents/model-registry.ts`. Each supplies typed SDK closures to the shared core constructor; only the pinned original 23-line private asPiModel conversion and thin SDK glue are duplicated identically. Preserve active registry/raw lookup/auth selection/query counts. No cross-owner import, host adapter import, runtime SDK import or wrapper re-export. Retain planned adapter boundary/test consumers without manufacturing a production caller or shared SDK layer.
- Modify: `maestro/runtime/pi-run-session.ts`, `maestro/runtime/index.ts`, `pi-extension/subagents/index.ts` for the implemented module-level observePiActivity and exact consumer rewiring below; preserve the owned paths.
- Modify: adapter `launch.ts`, `pi-harness-adapter.ts`, `child/subagent-done.ts`, host `model-config.ts`, adapter `task-model-init.ts`, and `test/maestro/dependency-rule-allowlist.ts` for their actual imports/declarations only.
- Modify: `test/runtime-routing.test.ts`, `test/test.ts`, `test/maestro/pi-harness-adapter.test.ts`, `test/maestro/pi-run-session.test.ts`, `test/integration/harness-conformance.test.ts` for actual owner imports and focused regressions.
- Delete: `pi-extension/subagents/activity.ts`, `runtime-routing.ts` only after their consumers rewire.

**Exact interfaces and adaptations (spec 4.1/4.4):**

```ts
// core/activity.ts; types imported from existing core/types.ts
export function projectActivity(state: SubagentActivityState | undefined): ActivityReadResult;
export function isSubagentActivityScope(value: any): value is SubagentActivityScope;
// adapters/pi/activity-file.ts; unchanged exported effectful signatures
export function getSubagentActivityFile(artifactDir: string, runningChildId: string): string;
export function readSubagentActivityFile(activityFile: string, expectedRunningChildId: string): ActivityReadResult;
export function writeSubagentActivityFile(activityFile: string, activity: SubagentActivityState): void;
export function createSubagentActivityRecorder(params: {
  runningChildId?: string; activityFile?: string; now?: () => number;
}): SubagentActivityRecorder;
// Private in activity-file.ts, not a new parser API:
function validateActivity(value: any, expectedRunningChildId: string): ActivityReadResult;
```

Projection is exactly missing for undefined, otherwise `{ ok: true, activity:
state }` by reference, with no validation/copy/policy. Reader keeps existsSync
outside readFileSync/JSON.parse catch; missing calls projectActivity(undefined),
read/parse errors stay invalid with the original message, and only private
validator success calls projectActivity(object). Do not cast parsed JSON to
state. Preserve object -> version -> child-ID string -> ID equality -> event ->
phase -> scope -> scalar/string order, wrong-id without error text, first-error
selection, accepted optional nulls and existing permissive guards. Only scope
set/predicate moves to core; other validators, phases/events and recorder/
shutdown types remain adapter-local. Writer/recorder filename/env, atomic I/O,
throttle/failure disabling and shutdown behavior remain unchanged.

```ts
// core/routing.ts; ThinkingLevel is core/types.ts's off-through-max union
export interface RoutingRegistrySource {
  find(provider: string, modelId: string): any;
  getAvailable?: () => any[];
  getAll?: () => any[];
  hasConfiguredAuth?: (model: any) => boolean;
}
export interface ModelRegistryAdapter {
  find(provider: string, modelId: string): RoutingModel | undefined;
  available(): RoutingModel[];
  hasConfiguredAuth(model: { provider: string; id: string }): boolean;
  supportedThinkingLevels(model: RoutingModel): ThinkingLevel[];
  clampThinkingLevel(model: RoutingModel, level: ThinkingLevel): ThinkingLevel;
}
export function createModelRegistryAdapter(
  registry: RoutingRegistrySource,
  capabilities: Pick<ModelRegistryAdapter, "supportedThinkingLevels" | "clampThinkingLevel">,
): ModelRegistryAdapter;
```

RoutingModel's map becomes `thinkingLevelMap?: Partial<Record<ThinkingLevel,
string | null>>`; other fields/normalization remain unchanged (complete shape
in spec 4.4). The existing raw any boundary is intentional, not a new validation
schema. Constructor makes zero queries, keeps the three query bodies and
receiver binding, normalizes only on method calls and adds supplied capabilities
without invoking or memoizing them. Both SDK-permitted owners implement:

```ts
export function wrapPiModelRegistry(registry: RoutingRegistrySource): ModelRegistryAdapter {
  return createModelRegistryAdapter(registry, {
    supportedThinkingLevels: (model) => getSupportedThinkingLevels(asPiModel(model)),
    clampThinkingLevel: (model, level) => clampThinkingLevel(asPiModel(model), level),
  });
}
// Private in each owner; identical pinned SDK conversion, not a core helper:
function asPiModel(model: RoutingModel): Model<any>;
```

Keep typed full-Model conversion closures; SDK functions cannot be assigned
directly to the port or cast past missing SDK fields. Core switches explicit
validation, formatSupported(model, registry) with the same registry, inherited
clamp and catalog to supplied port calls. Preserve spec 4.4's exact query rules:
nonempty direct source wins even if all invalid; empty-only fallback; skip
invalid before fallback auth, auth before dedup including duplicates; first-seen
order; raw find/original-object auth; getAvailable exact-match auth without a
predicate, never getAll rescue. No guard hardening (empty string IDs remain),
extra queries, caches, eager snapshots, deep copies or new ModelRegistry.
Capabilities use only selected normalized models with zero raw registry queries.
Keep the original SDK fields/default/filter expressions, nullable/sparse maps,
nonreasoning off and upward-before-downward clamp. SDK defaults do not fill
unknown init/catalog costs. Exact required port calls:

| Routing path | supportedThinkingLevels | clampThinkingLevel |
| --- | ---: | ---: |
| Explicit supported | 1 | 0 |
| Explicit unsupported, including error formatting | 2 | 0 |
| Inherited with selected model | 0 | 1 |
| Inherited with parent model absent | 0 | 0 |
| Catalog, including nonreasoners | 1 per visible model | 0 |

Do not call supported before SDK clamp or memoize error formatting. Preserve
routing selection/auth order, fallback/worktree restrictions, provenance,
requested/observed fields and exact error/catalog prose. All five host wrapper
calls change only imports to the host-local owner: candidate prevalidation,
launchSnapshot, session_start preferences/catalog, task-model writer predicate,
/worktree inherited plan. Each closes over that call's active ctx.modelRegistry;
do not consolidate them. PiHarnessAdapter/PiLaunchSnapshot propagate the port;
task-model-init's independent raw SDK capability call stays adapter-local.

```ts
// Module-level pi-run-session.ts export, outside PiRunSession:
// pi-herdr-agents extension; re-export implemented operation from runtime/index.ts
export function observePiActivity(
  input: { id: string; activityFile?: string; lifecycle: SubagentLifecycle },
  observedAt: number,
): RunObservation & { activityRead: ActivityReadResult };
```

Truthy path reads the Pi file with input.id, absent/empty path projects missing;
apply observeActivity to supplied lifecycle/read/time and return refresh/time,
new lifecycle, projectLifecycle at that time, successful activity or undefined
and required activityRead. No input mutation, factory/launch-context/session/
latestCtx prerequisite, ownership/history/watcher/resource acquisition, pane/
transcript/ledger/Git read, hook or parent message. Do not adopt legacy rows or
initialize factory/provider/coordinator as a fallback. Host ensures legacy
lifecycle first, calls this operation only in the unowned fallback, retains its
compact `read.ok ? { ok: true } : { ok: false, reason: read.reason, error:
read.error }` shape (including error:undefined) and prior successful activity
on invalid/missing reads, then assigns returned lifecycle. Keep the owned
control-ID/session.observe/onObserved branch unchanged. Do not unify owned
hydrate, adapter getState or local-evidence paths; imports only there, no extra
read/hook/watcher or changed observation kind/callback order. Preserve existing
suppression/terminal/interrupt/stale-sequence rules, status/advisory policy and
timer cadence, plus rulings 21–25's producer/cancellation/retirement, resume/
scoped-I/O, demand-driven reads and nonblocking cleanup contracts.

**Producer–consumer import closure after accepted Task 14:**

| Consumer | Task 15 owner/import |
| --- | --- |
| adapter launch.ts | ./activity-file.ts path helper; ../../core/routing.ts plan type |
| adapter pi-harness-adapter.ts | ./activity-file.ts reader; ../../core/routing.ts resolver/parser/predicate/port/parent/plan |
| adapter child/subagent-done.ts | ../activity-file.ts recorder |
| runtime pi-run-session.ts | ../adapters/pi/activity-file.ts reader; ../core/activity.ts projectActivity; ../core/lifecycle.ts observation/projection; ../core/routing.ts values/types; implemented detached operation |
| runtime index.ts | Implemented observePiActivity export, no reader/wrapper compatibility export |
| host index.ts | Core routing values/types, ./model-registry.ts wrapper, core activity scope predicate, core/types.ts activity declarations, runtime observation |
| test/runtime-routing.test.ts | Core routing/constructor/injected fake; adapter wrapper and host equivalence controls |
| test/test.ts | Adapter reader/recorder/path/wrapper; canonical activity type; core catalog/projection; host/runtime operations |
| test/maestro/pi-harness-adapter.test.ts | Adapter recorder; preserve actual-file/prevalidated-plan controls |
| test/maestro/pi-run-session.test.ts | Detached operation and core lifecycle; preserve actual owned composition controls |
| test/integration/harness-conformance.test.ts | Adapter reader; preserve actual child sidecar fixtures |
| legacy model-config, host index, adapter task-model-init | Shared declarations from core/config/task-model-types.ts; retain legacy loader/writer/ModelConfig until 17 |

Task 14's prerequisite removes legacy lifecycle's activity type edge after
acceptance; do not redo that move here.
Four direct structural ports need **both required synchronous methods**, no
casts: test/maestro/pi-harness-adapter.test.ts, test/maestro/pi-run-session.test.ts,
test/test.ts capturePersistentIO, test/integration/harness-conformance.test.ts.
Keep the adapter's throwing find proving prevalidated plan bypass. Wrapper-based
fixtures receive methods from the wrapper; raw host/SDK registry suppliers stay
raw. No unrelated fake/API/TaskPreferences widening.

- [ ] **Step 1: Add distinguishing regressions before the split**. Inject custom capability answers unlike SDK defaults (explicit max acceptance, inherited medium clamped to low, exact catalog levels) and assert selected-model identity/level and the table's counts. Record observable red answer/count evidence against direct SDK calls; merely adding fake members is not runtime FAIL evidence under strip-types. Retain existing routing tests and update all four direct port fixtures.
- [ ] **Step 2: Apply only the named boundary adaptations**. Split validated projection/private file parsing, module-level detached observation, shared neutral registry construction and identical bounded SDK glue; rewire every actual consumer above. Do not fix unrelated baseline scope/recorder activity errors (ruling 12), readonly shortlist, timer-token, shutdown, persistent/UI or fixture diagnostics. Report remaining baseline errors; only a demonstrated changed-seam type obligation permits a targeted adaptation.
- [ ] **Step 3: Verify the future implementation** (these source gates are not authorization to run them for documentation synchronization):
  - Pure projection: exact missing and supplied-state reference identity. File reader: absent, malformed JSON, primitive, bad version/ID type, malformed matching fields, wrong ID before later malformed fields, version before ID mismatch, accepted null optional fields; retain recorder tests and exact invalid/wrong-ID/error assertions. Use a real directory/EISDIR read error and malformed JSON, not mocked throwing existsSync; preserve source catch ordering. Mutating validation/ID checks or invalid -> missing must fail distinct assertions.
  - Detached actual-file operation without createDefaultRunSession: refresh/time/projection, identity, missing/invalid/wrong-ID health, input nonmutation and durable interrupt/sequence precedence. Host direct observeRunningSubagent fixtures save/restore an absent runtime.session and a row without lifecycle; retain legacy active-tool/done-as-waiting/local-interrupt hydration and actual sequence7 pre-interrupt. Also cover a real session with no matching control ID and a retained retired row: getters stay undefined, no launch/control owner/command appears. Keep previous activity on failed reads, refreshed status/advisory detail and owned initial/explicit onObserved/read counts. Preserve local-evidence/tick and persistent demand-driven-I/O controls; no transcript read in detached observation. Removing/guarding the operation, fabricating ownership, clearing activity or adding local-evidence reads must fail distinct assertions.
  - Query spies around core constructor and both actual wrappers use fresh independent sources, zero constructor calls, raw receiver/order/count/object identity, all spec 4.4 direct/fallback/auth cases, changing find/source and missing optional methods, empty-string IDs and first-seen dedup. Compare answers/logs without re-querying capability models or normalizing expected answers through production. Core injected controls prove routing consumes the port. Real SDK sparse/null-map/upward-clamp/off fixtures and source/AST comparison against pinned original asPiModel prove both 23-line conversions/default/filter expressions unchanged, not just equal to each other. No SDK ESM-mocking/loader framework; targeted diagnostics cover full Model return and typed closures. Bypass injection, second-call memoization, extra capability queries, projected-object auth, nonempty-invalid fallback or conversion drift must each fail independently.
  - Remove only the seven vanished exact legacy activity/routing allowlist pairs: pi-harness-adapter (2), pi-run-session (2), launch (2), child (1). Conditional arithmetic is Stage 4's 31 - Task 14's 14 - Task 15's 7 = 10 remaining to 16/17; verify refreshed actual edges, do not assert pending acceptance. No new exception or re-export laundering; task-model-init -> legacy model-config remains until 17.
  - Run mandatory npm test/lint/format, git diff --check, dependency tests and changed-TS LSP checks after implementation. Core has no SDK type/value edge. Pack preview must include the five new maestro owners plus host-local model-registry.ts, remove the two old owners and exclude evidence. Preserve child -e/env anchors, ordinary/resume session artifact paths and public entrypoints. Existing parent-authorized task/stage deterministic integration gates remain unchanged; no skipped pass evidence, dependency/version/script changes or broad Task 19 rewrite.
- [ ] **Step 4: Commit only if explicitly authorized by the implementation task** `refactor(maestro): split activity and routing into core and Pi adapter halves`. Parent owns review/integration/checkpoint commits; this documentation-only pass does not stage or commit.

### Task 16: Worktree logic to core

**Files:**
- Move: the harness-neutral eligibility, manifest-state, and formatting portions of `pi-extension/subagents/worktree-cleanup.ts` to `maestro/core/worktree-cleanup.ts`
- Create: `maestro/core/worktree.ts` with manifest schema helpers and pure handoff/result types moved from `launch.ts:966-1092`, plus the pure state transition used by `finalizeSubagentWorktree` from `index.ts:1072`
- Create: `maestro/runtime/worktree-operations.ts` with `createWorktreeCleanupOperations(provider: SurfaceProvider, input: { manifestDir: string; liveHolders: () => { path: string; persistent?: boolean }[]; managedRoot?: string }): WorktreeCleanupOperations` and all Git/process/Herdr operations replacing the Herdr-specific construction in legacy cleanup
- Modify: `test/worktree-cleanup.test.ts`, `test/worktree-cleanup-fixture.ts`

- [ ] **Step 1: Move and rewire**; manifest `owner` continues to be written as `"pi-herdr-subagents"`. Keep core free of `node:child_process`; actual Git and process inspection are supplied through injected runtime operations. Consume those operations from Task 13's finalizer, preserving pre-delivery timing. Add a meaningful runtime `handoffWorktree(input: { name: string; task: string; branch: string; leafId: string; snapshot: PiLaunchSnapshot; runtimePlan: ResolvedRuntimePlan }): Promise<{ record: PiRunRecord; focusError?: string }>` operation: it uses the existing unobserved interactive handoff transaction with session/cwd readiness and focus-after-readiness, not watched spawn or a shallow launch re-export. Host cleanup uses the runtime operations builder; host handoff calls this operation. Remove the host launch.ts edge and compatibility provider/default construction in launch.ts; all production operations are now explicitly injected. Migrate remaining host test-only helper exports to owner-module fixtures, not runtime re-exports.
- [ ] **Step 2: Add test** in `test/worktree-cleanup.test.ts`: `continues writing the stable manifest owner value`.
- [ ] **Step 3: Verify**: tests, lint, format, dependency rule; `npm run test:integration` worktree cases inside Herdr.
- [ ] **Step 4: Commit if explicitly authorized** `refactor(maestro): move worktree manifests, handoff, and cleanup into core`.

### Task 17: Roles and config to core

**Files:**
- Create: `maestro/core/roles/discovery.ts` from `index.ts:414-890` (`parseAgentDefinition`, capability validation, `discoverRolePackPaths`, `discoverAgentCatalog`, `discoverAgentDefinitions`, diagnostics), producing `Role` values with `defaults` and `source`; role-pack discovery takes an `onRolePackDiscovered(event)` callback instead of calling `pi.events.emit`
- Move: `pi-extension/subagents/{role-config,model-config,persistent-config,pane-config,supervision-config}.ts` to `maestro/core/config/`; each `load*` takes `configDir: string`. type-guards already moved in Task 14; shared task-model declarations already moved in Task 15. Preserve status's explicit config/example-path injection from Task 14
- Modify: `pi-extension/subagents/config-path.ts` stays and is passed into the loaders from `index.ts`
- Modify: `test/test.ts`

- [ ] **Step 1: Move and rewire**; `index.ts` keeps the `pi.events.emit` call inside the callback. Task 13's snapshot/role/config inputs now use these core declarations/loaders. Preserve host persistent policy/timers; do not move the entire persistent host under this task. Supply a meaningful task-model init operation that consumes the complete sanitized active-registry brief (all fields from buildTaskModelBrief, including safe auth-source/extension metadata, unknown costs and current config/preferences) and returns the existing prompt. Pi SDK projection remains in adapters/pi; the host passes the active registry through a typed injected projection, never a fresh registry or shallow re-export. Remove the host task-model-init.ts edge and all remaining adapter/provider/runtime config exceptions; type-guard edges must already be gone after Task 14.
- [ ] **Step 2: Verify**: tests, lint, format, dependency rule.
- [ ] **Step 3: Commit if explicitly authorized** `refactor(maestro): move role discovery and config loaders into core`.

### Task 18: Strict dependency rule and stage 5 gate

**Files:**
- Modify: `test/maestro/dependency-rule.test.ts` (remove the allowlist mechanism), delete `test/maestro/dependency-rule-allowlist.ts`

- [ ] **Step 1: Verify actual edge removal before deleting the allowlist**. Check all former entries and imports/re-exports/import types/dynamic imports/require references; host imports no adapter/surface module, including type-only and test-helper compatibility edges. Remove the allowlist and run the strict dependency tests. Expected: PASS with no exceptions. This is the final composition-root gate deferred openly from Task 13, not permission to hide a remaining consumer behind a re-export.
- [ ] **Step 2: Stage gate**: `npm test && npm run lint && npm run format:check && npm pack --dry-run && git diff --check`, LSP diagnostics on all changed files, and `npm run test:integration` inside Herdr when authorized. Expected: pass; record observed pass/fail/skip counts.
- [ ] **Step 3: Commit if explicitly authorized** `test(maestro): dependency rule is strict`.

---

## Stage 6: documentation

### Task 19: ADR, glossary, code maps

**Files:**
- Create: `docs/adr/0012-adopt-maestro-seams-in-repo.md`
- Modify: `CONTEXT.md`, `README.md` code map, `AGENTS.md` code map, `docs/README.md`, `docs/superpowers/specs/2026-10-02-maestro-seams-design.md` status line

- [ ] **Step 1: Write ADR 0012** with the sections used by ADR 0008: Status, Date, Scope, Supersedes (the adapter-seam clause of ADR 0008), Decision, Why, Consequences. Decision text from spec section 10.
- [ ] **Step 2: Update `CONTEXT.md`**: add entries `Harness adapter`, `Surface provider`, `Run session`, `Composition root`, `Dependency rule`, `Conformance suite`, each with an `_Avoid_` line; reword `Pi subagent runtime` per spec section 10.
- [ ] **Step 3: Update code maps** in `README.md`, `AGENTS.md`, `docs/README.md` (ADR table row for 0012 and a link to the spec under shipped contracts once merged). Include the permanent host-local `pi-extension/subagents/model-registry.ts` SDK glue.
- [ ] **Step 4: Verify**: `npm run format:check`, `npm pack --dry-run` lists the ADR; `git diff --check`; `npm run test:integration` inside Herdr one final time when authorized.
- [ ] **Step 5: Commit if explicitly authorized** `docs: record maestro seams decision and update code maps`.

Merge to `main` only on explicit request.
