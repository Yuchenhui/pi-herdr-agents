# Maestro seams in pi-herdr-agents: design

**Status:** Approved design, awaiting written-spec review. Not shipped behavior.
**Branch:** `feat/maestro-seams`, from `main` at `a32e02f`.
**Date:** 2026-10-02

## 1. Purpose

Build maestro's seams inside this repository so that pi-herdr-agents becomes a
Pi host over a harness-neutral core, without changing any public behavior.
When the branch is stable it merges to `main`. Later, the `maestro/` directory
moves to its own repository and this package depends on it; that move must be
a directory move plus a dependency, not a reconciliation of two
implementations.

Decisions already made in conversation:

- Work happens on a branch in this repository, in one npm package. No
  workspaces.
- This repository's existing modules are the implementations behind the
  seams. The maestro repository (`giuseppecrj/maestro`, HEAD `9992173`)
  contributes seam declarations, which are copied as close to verbatim as
  possible and extended only where this package's behavior cannot be
  expressed by them.
- Seams are explicit TypeScript interfaces implemented by objects. Existing
  function modules keep their bodies and become the internals those objects
  delegate to.
- Layout mirrors maestro's package map as directories under a top-level
  `maestro/` directory.

## 2. Goals and non-goals

Goals:

1. Every Pi host touchpoint lives in `maestro/adapters/pi/` or
   `pi-extension/subagents/`, and every Herdr touchpoint in
   `maestro/surfaces/herdr/`. A unit test enforces this.
2. `pi-extension/subagents/index.ts` is a composition root: Pi registration,
   widget rendering, and parent delivery. It no longer calls launch,
   completion, session, or Herdr modules directly.
3. Each seam has a conformance suite that an in-memory fake and the real
   implementation both pass.
4. The deterministic Herdr integration suite passes unmodified at the end of
   every stage.

Non-goals:

- A second real harness or surface in this repository.
- npm workspaces, package renames, or publishing changes.
- Porting maestro's `pi --print` adapter, `Supervisor` poll loop,
  `Dispatcher`, `ReviewSynthesizer`, or CLI.
- Any change to public tools, commands, role-pack format, lifecycle
  messages, worktree invariants, or persistent-specialist semantics.

## 3. Layout and dependency rule

```text
maestro/
  core/            seam declarations, domain types, harness-neutral modules
  adapters/pi/     PiHarnessAdapter and the Pi child protocol
  surfaces/herdr/  HerdrSurfaceProvider and the Herdr CLI driver
  runtime/         createRunSession(): worktree -> surface -> adapter -> supervision
pi-extension/subagents/
  index.ts         composition root: Pi registration, widget, delivery
  config-path.ts   host convention for $PI_CODING_AGENT_DIR
  plan-skill.md    unchanged
agents/, skills/   unchanged
```

Import rules, enforced by `test/maestro/dependency-rule.test.ts`, which
scans every `.ts` file under `maestro/` and `pi-extension/` for `import`
specifiers:

| Directory | May import | Must not import |
| --- | --- | --- |
| `maestro/core` | `node:*` except `node:child_process`; other `core` files | `adapters`, `surfaces`, `runtime`, `pi-extension`, `@earendil-works/*`, `node:child_process` |
| `maestro/adapters/pi` | `core`, `node:*`, `@earendil-works/*`, `@sinclair/typebox` | `surfaces`, `runtime`, `pi-extension` |
| `maestro/surfaces/herdr` | `core`, `node:*` | `adapters`, `runtime`, `pi-extension`, `@earendil-works/*` |
| `maestro/runtime` | `core`, `adapters`, `surfaces`, `node:*` | `pi-extension`, `@earendil-works/*` |
| `maestro/adapters/fake`, `maestro/surfaces/fake` | `core`, `node:*` | everything else; no non-test file may import a `fake` directory |
| `pi-extension/subagents` | `runtime`, `core` types, `@earendil-works/*`, `@sinclair/typebox` | `adapters`, `surfaces` directly |

The test fails with the offending file and specifier. Relative imports are
resolved to one of the directories above before the rule is applied. The
test carries a temporary allowlist of files that may violate the
`pi-extension` row while modules are mid-move (stages 2 and 3); stage 4
empties it and stage 5 removes the allowlist mechanism.

Package changes: `format`, `format:check`, and `lint` scripts in
`package.json` add `maestro`. `pi.extensions` is unchanged. Stage 1 verifies
with `npm pack --dry-run` that `maestro/` ships in the tarball.

## 4. Seam declarations

Declarations live in `maestro/core/types.ts`, `maestro/core/harness-adapter.ts`,
`maestro/core/surface-provider.ts`, and `maestro/runtime/run-session.ts`.
Maestro keeps `HarnessAdapter` in its adapters package and `SurfaceProvider`
in its surfaces package; here both interfaces live in core so adapters and
surfaces depend only inward. On extraction they move back to maestro's
packages unchanged.

Every maestro member is kept with its name and type. Members this package
adds are marked `// pi-herdr-agents extension` in source and listed here.

### 4.1 Core types (`maestro/core/types.ts`)

Copied verbatim from maestro `packages/core/src/types.ts`: `AgentState`,
`WorktreeSpec`, `Task`, `Role`, `WorktreeState`, `WorktreeOwnership`,
`Worktree`, `SurfaceHandle`, `AgentHandle`, `RunOutcome`, `RunResult`.
Review types (`ReviewFinding` and later) are not copied; nothing here uses
them.

Extensions:

```ts
// Task
export interface Task {
  // ...maestro fields unchanged...
  // pi-herdr-agents extension
  runtime?: {
    model: string;
    thinking: ThinkingLevel;
    /** Ordered candidates tried after a launch failure or a running child's
     *  provider error; today's launchSubagentWithFallbacks (index.ts:2631). */
    fallbacks?: { model: string; thinking: ThinkingLevel }[];
  };
  session?: { mode: "standalone" | "lineage-only" | "fork"; parentSessionId?: string };
  behavior?: {
    persistent?: boolean;
    autoExit?: boolean;
    interactive?: boolean;
    systemPromptMode?: "replace" | "append";
    skills?: string[];
    denyTools?: string[];
  };
  /** Explicit tool allowlist; overrides Role.allowedTools when set. */
  tools?: string[];
  /** Explicit system prompt; overrides Role.systemPrompt when set. */
  systemPrompt?: string;
}

// Role: maestro's five fields plus the defaults the Pi adapter honors today
// (parsed by parseAgentDefinition in index.ts:521).
export interface Role {
  name: string;
  version: string;
  description: string;
  systemPrompt: string;
  allowedTools: string[];
  // pi-herdr-agents extension
  defaults?: {
    model?: string;
    thinking?: ThinkingLevel;
    sessionMode?: "standalone" | "lineage-only" | "fork";
    spawning?: boolean;
    autoExit?: boolean;
    interactive?: boolean;
    persistent?: boolean;
    systemPromptMode?: "replace" | "append";
    denyTools?: string[];
  };
  /** Where the definition came from: bundled, project, global, or role pack. */
  source?: string;
}

// RunOutcome gains "help": the child asked the parent through caller_ping.
export type RunOutcome = "completed" | "failed" | "timeout" | "killed" | "help";

// pi-herdr-agents extension
export interface CompletionEvidence {
  reason: "done" | "ping" | "sentinel" | "error";
  /** Required harness exit status from CompletionResult. */
  exitCode: number;
  ping?: { name: string; message: string };
  errorMessage?: string;
  finalMessage?: { text: string; stopReason?: string; errorMessage?: string };
  /** Harness session reference; for Pi, the session file path. */
  sessionRef?: string;
  worktree?: WorktreeHandoff;
}

export interface RunResult {
  // ...maestro fields unchanged...
  // pi-herdr-agents extension
  evidence?: CompletionEvidence;
}
```

`ThinkingLevel`, `WorktreeHandoff` (today `launch.ts:70`), `PaneInspection`,
`HerdrAgentStatus` (renamed `SurfaceAgentStatus`), `LifecycleProjection`, and
the activity state types from `activity.ts:17-68` move into core as plain
types. For the Pi adapter, `AgentHandle.sessionId` holds the session file
path; no field is added to `AgentHandle`.

`Worktree.owner` stays as copied from maestro in the in-memory declaration.
It is not the on-disk manifest owner. Manifests this package writes keep the
stable persisted `owner` value `"pi-herdr-subagents"` throughout this
behavior-preserving migration; no ownership-format migration is part of these
stages.

### 4.2 `HarnessAdapter` (`maestro/core/harness-adapter.ts`)

Copied verbatim from maestro `packages/adapters/src/harness-adapter.ts`:
`SpawnOptions` and `HarnessAdapter` with `name`, `isAvailable`, `spawn`,
`getState`, `interrupt`, `kill`, `sendInput`, `readOutput`, `exitCode?`.

Extensions:

```ts
export interface SpawnOptions {
  // ...maestro fields unchanged...
  // pi-herdr-agents extension
  /** Unprovisioned request; launch writes the ownership manifest before acquisition. */
  worktreeRequest?: WorktreeSpec;
  // pi-herdr-agents extension: carried from Task, see 4.1
  runtime?: Task["runtime"];
  session?: Task["session"];
  behavior?: Task["behavior"];
  tools?: string[];
  systemPrompt?: string;
}

// pi-herdr-agents extension
export interface ResumeOptions {
  name: string;
  /** Harness session reference to resume; for Pi, the session file path. */
  sessionId: string;
  message?: string;
  tools?: string[];
  autoExit?: boolean;
  surface?: SurfaceHandle;
  env?: Record<string, string>;
}

export interface HarnessAdapter {
  // ...maestro members unchanged...
  // pi-herdr-agents extension
  resume(opts: ResumeOptions): Promise<AgentHandle>;
  /**
   * Resolve when the agent's run has ended, with the evidence the harness
   * can observe. Driven by wake-ups and sidecar evidence, not polling.
   * Rejects on abort.
   */
  awaitCompletion(handle: AgentHandle, signal: AbortSignal): Promise<CompletionEvidence>;
}
```

`PiHarnessAdapter` (class, `maestro/adapters/pi/pi-harness-adapter.ts`):

| Member | Delegates to |
| --- | --- |
| `isAvailable` | `pi` on PATH |
| `spawn` | `launchPiSubagent()` with a `FreshPiLaunchRequest` (`launch.ts:80`) |
| `resume` | `launchPiSubagent()` with a `ResumePiLaunchRequest` (`launch.ts:117`) |
| `getState` | lifecycle projection of the activity file and surface inspection |
| `interrupt` | sends `Escape` through the handle's surface, preserving `interruptPane` |
| `kill` | close the surface, then wait for process exit |
| `sendInput` | persistent task inbox (`session.ts:500`) |
| `readOutput` | `readScreen` on the handle's surface |
| `exitCode` | last recorded `CompletionEvidence.exitCode` for the handle |
| `awaitCompletion` | `waitForCompletion()` (`completion.ts:130`) plus `inspectFinalAssistantMessage()` and `captureWorktreeHandoff()`; returned evidence includes the required exit code |

Adapter-private state (session file, sidecar paths, activity file, policy
file, persistent generation) is a `Map<string, PiAgentState>` keyed by
`AgentHandle.id`. The existing `PiLaunchOperations` interface
(`launch.ts:164`) remains the adapter's internal seam for tests.

`FakeHarnessAdapter` (`maestro/adapters/fake/fake-harness-adapter.ts`,
imported only by tests) implements the full interface in memory with scripted completions: `complete(handleId,
evidence)`, `fail(handleId, error)`, `ping(handleId, message)`.

### 4.3 `SurfaceProvider` (`maestro/core/surface-provider.ts`)

Copied verbatim from maestro `packages/surfaces/src/surface-provider.ts`:
`SurfaceInfo`, `CreateSurfaceOptions`, `CreateWorktreeSurfaceOptions`,
`WorktreeSurface`, and `SurfaceProvider` with `name`, `isAvailable`,
`createSurface`, `runCommand`, `readScreen`, `closeSurface`, `listSurfaces`,
`attachSurface`, `createWorktreeSurface`, `removeWorktreeSurface`.

Extensions:

```ts
// pi-herdr-agents extension
export type SurfacePlacement =
  | { kind: "grouped" }                       // extension-owned Agents tab, capped, overflow tab
  | { kind: "split"; direction: "right" | "down" }
  | { kind: "tab" };                          // legacy tab creation in the caller workspace

export interface CreateSurfaceOptions {
  name: string;
  cwd: string;
  /** Default: { kind: "grouped" }. */
  placement?: SurfacePlacement;
}

export interface SurfaceForegroundProcess {
  pid: number;
  name?: string;
  argv0?: string;
  argv?: string[];
  cwd?: string;
}

export interface SurfaceProcessInfo {
  shellPid?: number;
  foregroundProcessGroupId?: number;
  pids: number[];
  foregroundProcesses: SurfaceForegroundProcess[];
}

export interface SurfaceInfo {
  id: string;
  name?: string;
  cwd?: string;
  // pi-herdr-agents extension: tab or window the surface belongs to
  group?: string;
  // pi-herdr-agents extension: provider-native workspace/container id when reported
  workspaceId?: string;
}

export interface WorktreeSurfaceInfo {
  /** Empty for detached HEAD. */
  branch: string;
  path: string;
  label?: string;
  workspaceId?: string;
  isLinkedWorktree: boolean;
}

export interface SurfaceProvider {
  // ...maestro members unchanged...
  // pi-herdr-agents extension
  /** Human-readable hint when isAvailable() is false; today's terminalSetupHint(). */
  setupHint(): string;
  /** Write a script file and run it in the surface; today's runScriptInPane (terminal.ts:115). */
  runScript(surfaceId: string, command: string, options: { scriptPath: string; scriptPreamble: string }): string;
  inspectSurface(surfaceId: string): Promise<PaneInspection>;
  sendKeys(surfaceId: string, keys: string): void | Promise<void>;
  getProcessInfo(surfaceId: string): SurfaceProcessInfo;
  waitForShellReady(surfaceId: string, opts?: { timeoutMs?: number }): Promise<void>;
  waitForSurfaceAbsence(surfaceId: string, opts?: { timeoutMs?: number }): Promise<void>;
  listWorktreeSurfaces(opts?: { cwd?: string; timeoutMs?: number }): Promise<WorktreeSurfaceInfo[]>;
  focusWorkspace(workspaceId: string): void;
  setTitle(target: "tab" | "workspace", title: string): void;
}
```

`HerdrSurfaceProvider` (class, `maestro/surfaces/herdr/herdr-surface-provider.ts`)
wraps `herdr.ts` and `terminal.ts`. Grouped placement keeps the ID-based
Agents tab ownership, pane cap, and overflow-tab behavior from `herdr.ts:296`.
`attachSurface(id)` returns a `SurfaceHandle` whose `sendKeys` and `close`
are present. Readiness for a Pi launch remains a Pi-adapter concern: the
adapter polls `getProcessInfo()` and matches the expected `--session` value
and cwd, preserving `waitForHerdrPiReady`'s identity check instead of accepting
an arbitrary process on the surface.

`FakeSurfaceProvider` (`maestro/surfaces/fake/fake-surface-provider.ts`)
records commands, screens, process info, and worktree-surface metadata in
memory and lets tests script inspections. It does not run Git or create real
checkouts; filesystem assertions belong to the real-provider integration
fixture.

### 4.4 `RunSession` (`maestro/runtime/run-session.ts`)

Copied from maestro `packages/runtime/src/run-session.ts`: `RunSessionHooks`
(`onSpawned`, `onSettled`), `RunSessionOptions`, `RunSession` with `spawn`,
`supervise`, `getHandle`, `kill`, `interrupt`, and `createRunSession()`.

Extensions:

```ts
export interface RunSessionHooks {
  onSpawned?(handle: AgentHandle, task: Task): void | Promise<void>;
  onSettled?(result: RunResult, task: Task): void | Promise<void>;
  // pi-herdr-agents extension
  /** Fired on every supervision observation; drives the widget and status lines. */
  onObserved?(handle: AgentHandle, projection: LifecycleProjection): void;
}

export interface RunSessionOptions {
  // ...maestro fields unchanged...
  // pi-herdr-agents extension
  wake: FileWakeRegistry;
  supervision: SupervisionCoordinator;
  /** Decide whether a finished agent's surface stays open. */
  retainSurface?: (result: RunResult, task: Task) => boolean;
}

export interface RunSession {
  // ...maestro members unchanged...
  // pi-herdr-agents extension
  resume(opts: ResumeOptions & { taskId: string }): Promise<AgentHandle>;
  /** Deliver a follow-up task to an idle persistent specialist. */
  send(taskId: string, text: string): Promise<void>;
}
```

`spawn()` tries `task.runtime` and then each entry of `task.runtime.fallbacks`
in order when `adapter.spawn` throws, as `launchSubagentWithFallbacks` does
today; persistent specialists and worktree runs use the first candidate
only. `RunSession` does not acquire panes or worktrees before `adapter.spawn`.
`Task.worktree` becomes `SpawnOptions.worktreeRequest`; the upstream
`SpawnOptions.worktree?: Worktree` stays unchanged for provisioned handles.
The Pi adapter's launch transaction remains responsible for surface and
worktree manifest creation, resource acquisition, and failure cleanup in the
existing order. `supervise()`
registers the handle with the wake registry and supervision coordinator,
awaits `adapter.awaitCompletion()`, and re-spawns with the next fallback when
the existing fallback predicate is true: nonpersistent, completion result has
an `errorMessage`, and another plan remains. Worktree runs cannot currently
reach multiple running-child fallback candidates because launch validation
prevents that shape. Evidence maps to `RunOutcome` (`done` or `sentinel` with
exit code 0 to `completed`, `ping` to `help`, `error` or nonzero exit to
`failed`, abort to `killed`), applies `retainSurface` (default: retain only
for worktree runs, matching today's `shouldRetainSubagentSurface` at
`index.ts:1036`), transitions worktree state through existing manifest
helpers, and fires `onSettled`. Persistent inbox events, help requests, turn
cancellation, and process exit remain distinct events; hooks carry the
existing observations rather than inferring specialist completion solely from
`getState()`. Maestro's `Supervisor` poll loop and `timeoutMs` handling are
not ported; `Task.timeoutMs` is accepted and ignored by this runtime, which
matches today's behavior of no per-task timeout.

## 5. Where existing modules go

| Today (`pi-extension/subagents/`) | Destination | Stage |
| --- | --- | --- |
| `herdr.ts`, `terminal.ts` | `maestro/surfaces/herdr/` | 2 |
| `launch.ts`, `completion.ts`, `session.ts`, `task-model-init.ts` | `maestro/adapters/pi/` | 3 |
| `subagent-done.ts` (child-side extension) | `maestro/adapters/pi/child/subagent-done.ts`; `launch.ts` builds the `-e` path from its own location | 3 |
| `runtime-routing.ts` | `ModelRegistryAdapter`, `resolveRuntimePlan(s)`, catalog helpers to `maestro/core/routing.ts`; `wrapPiModelRegistry` and `@earendil-works/pi-ai` imports to `maestro/adapters/pi/model-registry.ts` | 5 |
| `activity.ts` | state types and `readSubagentActivityFile` projection to `maestro/core/activity.ts`; file paths, writer, and recorder to `maestro/adapters/pi/activity-file.ts` | 5 |
| `lifecycle.ts`, `status.ts`, `wake.ts`, `supervision.ts` | `maestro/core/` | 5 |
| `worktree-cleanup.ts` | eligibility and manifest-state rules to `maestro/core/worktree-cleanup.ts`; Git/process/Herdr operations stay behind injected runtime operations built in `maestro/runtime/` from the surface provider | 5 |
| `index.ts:414-890` role discovery, role packs, agent definition parsing | `maestro/core/roles/` producing `Role` values; `pi.events.emit` for role-pack discovery stays in `index.ts` via a callback | 5 |
| `role-config.ts`, `model-config.ts`, `persistent-config.ts`, `pane-config.ts`, `supervision-config.ts`, `type-guards.ts` | `maestro/core/config/`; loaders take the config directory as a parameter | 5 |
| `config-path.ts` | stays; resolves `$PI_CODING_AGENT_DIR` and passes it in | 5 |
| `index.ts:1072-1097` worktree finalize and `launch.ts` manifest read/write, `captureWorktreeHandoff`, `persistWorktreeResult` | `maestro/core/worktree.ts` | 5 |
| `index.ts` launch, watch, interrupt, resume, persistent send/stop, BTW launch | `maestro/runtime/` through `RunSession`; `index.ts` keeps the tool and command handlers that call it | 4 |
| `index.ts` widget rendering, status refresh, `sendSubagentResult`, result presentation | stays in `index.ts` (Pi UI and delivery) | 4 |

Moves are `git mv` with import updates only. Function bodies do not change
in a move commit; behavior changes, if any, are separate commits with their
own tests.

## 6. Composition root

After stage 4, `pi-extension/subagents/index.ts` does the following and
nothing else:

1. Builds `HerdrSurfaceProvider`, `PiHarnessAdapter`, `FileWakeRegistry`,
   `SupervisionCoordinator`, and `createRunSession()` once per Pi session,
   in `session_start`.
2. Registers the public tools and commands. Each handler translates its
   parameters into a `Task`, `ResumeOptions`, or a `RunSession` call.
3. Implements the hooks: `onSpawned` updates the widget; `onObserved`
   updates status lines; `onSettled` renders the result and calls
   `pi.sendMessage` with `deliverAs: "steer"`, as `sendSubagentResult`
   does today at `index.ts:1232`.
4. Owns the persistent-specialist registry, delivery ledger reads, and the
   `/btw` pane bookkeeping, calling `RunSession` for every launch.
5. Tears down in `session_shutdown`.

Host-call accounting: the 93 `pi.*` and `ctx.*` call sites in `index.ts`
reduce to registration, `ctx.ui`, `ctx.sessionManager` reads for the parent
session, `ctx.modelRegistry` handed to the adapter, and `pi.sendMessage` and
`pi.sendUserMessage` for delivery. The dependency-rule test is the check.

## 7. Error handling

- `isAvailable()` false on either seam makes `spawn` return the existing
  `muxUnavailableResult()` text from the tool handler. No change.
- A throw from `adapter.spawn` is reported by the tool handler exactly as
  today's launch failure path, including runtime-plan fallback retries,
  which stay in `index.ts` until stage 4 and move into `RunSession.spawn`
  there with the same candidate order. The adapter preserves the single
  launch transaction, including manifest-before-resource creation for
  worktrees.
- `awaitCompletion` rejecting with abort maps to `killed`; any other
  rejection maps to `failed` with `error` set to the message. Unknown Git
  state in `WorktreeHandoff` stays unknown; nothing guesses clean.
- Conformance suites assert these mappings for both fakes and real
  implementations.

## 8. Testing

Location `test/maestro/`.

- `harness-adapter.conformance.ts` exports
  `registerHarnessAdapterConformance(runner, name, factory)`; cases cover
  spawn returns a handle with `harness === adapter.name`, `getState` never
  throws, `awaitCompletion` resolves `done`, `ping`, and `error` evidence,
  rejects on abort, `interrupt` leaves the session resumable, `kill` makes
  `getState` return `done` or `unknown`, `resume` of a known session
  returns a new handle. Runs against `FakeHarnessAdapter` in `npm test` and
  against `PiHarnessAdapter` in `test/integration/` with the deterministic
  provider.
- `surface-provider.conformance.ts` likewise: create, run, read, inspect,
  list, close, absence wait, grouped placement cap and overflow, worktree
  surface create and remove. Runs against `FakeSurfaceProvider` in
  `npm test` and `HerdrSurfaceProvider` in integration.
- `run-session.test.ts` uses both fakes to test outcome mapping, hook
  order, `retainSurface`, `resume`, and `send`. This is new leverage: the
  runtime is unit-testable without Herdr.
- `dependency-rule.test.ts` as in section 3.
- Existing `test/test.ts` and friends keep passing; tests that import moved
  modules update their import paths in the same move commit.
- The deterministic integration suite is unchanged and is the behavior gate.

## 9. Stages and acceptance

Each stage ends with `npm test`, `npm run lint`, `npm run format:check`,
`npm pack --dry-run`, `git diff --check`, LSP diagnostics on changed
TypeScript, and `npm run test:integration` green from inside Herdr when that
suite is authorized. Commits are per task only when explicitly authorized;
every stage is mergeable on its own.

1. **Declarations.** `maestro/core/` types and interfaces, both fakes, both
   conformance suites running against the fakes, dependency-rule test,
   package scripts updated. Nothing wired.
   Acceptance: fakes pass conformance; `npm pack --dry-run` lists `maestro/`;
   dependency-rule test passes with an empty allowlist.
2. **Herdr surface.** `git mv` the Herdr driver, add `HerdrSurfaceProvider`,
   route `index.ts` and `launch.ts` calls through a provider instance;
   `launch.ts` and `index.ts` enter the temporary allowlist. Acceptance:
   surface conformance passes against the real provider in integration.
3. **Pi adapter.** `git mv` launch, completion, session, task-model-init,
   and the child extension; add `PiHarnessAdapter`; `index.ts` launches
   through the adapter; `launch.ts` leaves the allowlist. Acceptance:
   adapter conformance passes against the real adapter in integration.
4. **Run session.** `createRunSession()`; rewire launch, watch, interrupt,
   resume, persistent send and stop, and BTW onto it with hooks; remove the
   direct launch and completion imports from `index.ts`; allowlist empty.
   Acceptance: `index.ts` imports nothing from `adapters` or `surfaces`.
5. **Core migration.** Move the harness-neutral modules per section 5;
   dependency rule strict for `core`; allowlist mechanism removed.
   Acceptance: dependency-rule test passes with no exceptions.
6. **Documentation and merge.** ADR 0012, `CONTEXT.md`, README code map,
   `AGENTS.md` code map, `docs/README.md`; spec status set to shipped.
   Merge to `main` on explicit request.

## 10. Documentation and decision records

- **ADR 0012, "Adopt maestro seams in-repo".** Supersedes the clause of ADR
  0008 that forbids a runtime adapter seam without a second real execution
  path. Production execution stays Pi-only and Herdr-only. The seam is
  justified by the conformance fakes and the planned extraction of
  `maestro/` into the maestro repository. Registries and name-based
  dispatch remain out of scope.
- **`CONTEXT.md`.** New entries: harness adapter, surface provider, run
  session, composition root, dependency rule, conformance suite. The "Pi
  subagent runtime" entry is reworded so one adapter object behind one
  interface is allowed while "runtime dispatch" and "adapter registry" stay
  on the avoid list.
- **README and AGENTS.md code maps** list `maestro/` directories.
- **`docs/README.md`** adds ADR 0012 and this spec.

## 11. Extraction path

When `maestro/` moves to the maestro repository, `core` becomes
`@ephemeralabs/maestro-core`, `adapters/pi` and `surfaces/herdr` join
`maestro-adapters` and `maestro-surfaces`, and `runtime` becomes
`maestro-runtime`. `maestro/runtime/index.ts` also exports
`createDefaultRunSession()` so the composition root never imports an adapter
or surface directly. Runtime does not use shallow re-exports solely to hide
forbidden dependencies. The interface files are identical by construction except
for the marked extensions, which are upstreamed first. This package then
lists those packages as `dependencies` (they are not Pi host-provided
modules, so Pi's warning does not apply), keeps `pi-extension/subagents/`
and `agents/`, and `index.ts` does not change.

## 12. Resolved questions

- Source of truth: this repository's implementations. Maestro's `--print`
  adapter is not ported.
- Objects at seams, functions inside: see section 1.
- Layout: top-level `maestro/` directory, single package.
- Default placement for `createSurface`: grouped, preserving current
  behavior; legacy tab creation is reachable through
  `placement: { kind: "tab" }`. Dedicated workspaces remain part of
  worktree creation, not ordinary surface placement.
- `timeoutMs`: accepted on `Task` for shape compatibility, not enforced.
