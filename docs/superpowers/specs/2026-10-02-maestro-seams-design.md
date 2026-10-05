# Maestro seams in pi-herdr-agents: design

**Status:** Maestro seams are implemented in `feat/maestro-seams`; local unit and deterministic integration gates passed. Not merged or released.
**Stage 5 checkpoint:** `2ae8ba57b07d2f77b01363fe175f3b9084ebf6eb`; signed implementation checkpoint.
**Stage 4 checkpoint:** `e9f803992894d304c4eb5b7608ab6cce4464ee16`; earlier signed checkpoint.
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
  runtime/         run ownership, retries, observation, delivery-gated cleanup; Pi composition
pi-extension/subagents/
  index.ts         composition root: Pi registration, widget, delivery
  config-path.ts   host convention for $PI_CODING_AGENT_DIR
  model-registry.ts host-local typed SDK capability glue over core routing
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
| `pi-extension/subagents` | `runtime`, `core` values and types, `@earendil-works/*`, `@sinclair/typebox` | `adapters`, `surfaces` directly |

The test fails with the offending file and specifier. Relative imports are
resolved to one of the directories above before the rule is applied. The
test carries exact `(importer, specifier, removalTask)` exceptions during
migration, including type-only imports. Stage 4 removes only edges it actually
replaces. Worktree and init consumers remain staged through Tasks 16 and 17;
Task 18 removes every exception and the mechanism. The plan names the exact
intermediate edges. No shallow runtime re-export hides a forbidden consumer.

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
     *  reported errorMessage; launch and running retry predicates differ. */
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
// (parsed by parseAgentDefinition in maestro/core/roles/discovery.ts).
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
    skills?: string[];
    cwd?: string;
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
the activity state types originally from `activity.ts:17-68` live in
`maestro/core/types.ts` as plain types. Do not redeclare them in activity
modules. For the Pi adapter, `AgentHandle.sessionId` holds the session file
path; no field is added to `AgentHandle`.

Task 15's `maestro/core/activity.ts` owns only validated-state/absence
projection and the existing pure scope predicate/set:

```ts
export function projectActivity(state: SubagentActivityState | undefined): ActivityReadResult;
export function isSubagentActivityScope(value: any): value is SubagentActivityScope;
```

Projection is exactly `state === undefined ? { ok: false, reason: "missing" } :
{ ok: true, activity: state }`, preserving the supplied state's identity. It
is not unknown-JSON, expected-ID or error validation, sanitization, copying,
age policy or lifecycle classification. The predicate moves unchanged using
Task 14's core guards; no second scope vocabulary or baseline diagnostic fix.

`maestro/adapters/pi/activity-file.ts` retains the existing path helper,
reader, atomic writer and recorder signatures/bodies except the named split.
Its private `validateActivity(value: any, expectedRunningChildId: string):
ActivityReadResult` preserves object, version, child-ID string, ID equality,
event, phase, scope, then scalar/string validation in that order, including
first-error selection and accepted optional nulls. Wrong ID stays
`{ ok: false, reason: "wrong-id" }` without invented error text. Unknown parsed
JSON goes through this validator, never a cast directly into projectActivity.
`existsSync` stays outside the try/catch: false calls projectActivity(undefined),
while an existence-probe exception still propagates. Only readFileSync/JSON.parse
are caught, returning invalid with `error instanceof Error ? error.message :
String(error)`. Only validated success calls projectActivity(object); invalid
and wrong-ID results pass through unchanged. Known phases/events and other
validators remain private; SubagentActivityRecorder/SubagentShutdownReason
remain adapter-local. Filename/env, temp naming, newline JSON, rename/unlink/
rethrow, throttle/failure disabling and shutdown behavior do not change.
Later file regressions use real directory/EISDIR and malformed-JSON failures,
not a patched throwing existsSync, while preserving source catch ordering.

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

Adapter-private children are keyed by opaque child ID; completion evidence and
shared waits are keyed by `[handle.id, handle.sessionId]`. Retried children can
reuse an ID with a new session. Runtime keeps the owning adapter for every
attempt, not only the latest ID. The existing `PiLaunchOperations` interface
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

### 4.4 `RunSession`: accepted Stage 4 contract and Task 15 correction

These complete declarations replace the incomplete runtime sketch. Core
`Task`, `Role`, `AgentHandle`, `RunResult`, `HarnessAdapter`, and
`SurfaceProvider` remain as committed in Stage 3. Pi metadata is not added to
those ports. Names and ordinary call shapes from maestro are retained;
`Supervisor` and `WorktreeManager` construction are deliberately not copied.
The upstream `supervisor` option is omitted because its polling/timeout and
pre-acquisition behavior conflict with this package. `defaultTimeoutMs` and
`Task.timeoutMs` remain accepted but ignored for upstream shape compatibility:
neither installs a deadline, timer, timeout result nor process action. This does
not disable existing launch-readiness or host persistent-stop budgets.
Added declarations/members must be marked `// pi-herdr-agents extension` when
implemented.

#### Generic runtime (Task 12)

Types below use the committed core declarations and `ResumeOptions`. Runtime
candidate records are single-attempt model/thinking values, not Pi plans.

```ts
export interface RuntimeCandidate {
  model: string;
  thinking: ThinkingLevel;
}

export type DeliveryDecision = "delivered" | "suppressed";

export interface RunObservation {
  /** Adapter events keep their existing kinds; refresh is caller-requested
   *  cheap hydration, not a new polling source. */
  kind: "local-evidence" | "pane" | "tick" | "completion" | "state" | "interrupt" | "refresh";
  observedAt: number;
  lifecycle: SubagentLifecycle;
  projection: LifecycleProjection;
  activity?: SubagentActivityState;
  activityRead?: ActivityReadResult;
}

export interface RunSessionHooks {
  onSpawned?(handle: AgentHandle, task: Task): void | Promise<void>;
  onObserved?(handle: AgentHandle, projection: LifecycleProjection, observation: RunObservation): void;
  onSettled?(result: RunResult, task: Task): void | DeliveryDecision | Promise<void | DeliveryDecision>;
}

export interface OwnedRunAttempt {
  handle: AgentHandle;
  adapter: HarnessAdapter;
  /** Actual effective policy for this attempt, when the adapter reports it. */
  persistent?: boolean;
  /** Surface-only release, not adapter.kill; absent for direct processes. */
  closeTemporarySurface?(): Promise<void>;
  /** Cheap local hydration; never getState or a second pane inspection. */
  observe?(at: number): RunObservation;
  /** Evidence/transcript/manifest finalization before the parent delivery hook. */
  finalize?(result: RunResult, task: Task): Promise<RunResult>;
}

export interface PreparedRun {
  /** Captured role; explicit Pi preparation also supports the bare empty name. */
  role: Role;
  /** Role defaults are included, not only Task.behavior. */
  persistent: boolean;
  /** Empty only when the adapter chooses its own runtime. */
  candidates: readonly RuntimeCandidate[];
  /** One attempt; runtime supplies options without runtime.fallbacks. */
  spawnAttempt(options: SpawnOptions, candidateIndex: number): Promise<OwnedRunAttempt>;
}

export interface RunSessionOperations {
  /** Validate the entire requested candidate list before constructing attempts. */
  prepare(task: Task, role: Role): Promise<PreparedRun>;
  resume?(options: ResumeOptions, task: Task): Promise<OwnedRunAttempt>;
}

export interface RunSessionOptions {
  adapter: HarnessAdapter;
  surfaceProvider?: SurfaceProvider;
  roles: Role[];
  cwd: string;
  sessionIdPrefix?: string;
  /** Accepted upstream field; ignored, never schedules a deadline. */
  defaultTimeoutMs?: number;
  env?: Record<string, string>;
  hooks?: RunSessionHooks;
  operations?: RunSessionOperations;
  retainSurface?: (result: RunResult, task: Task) => boolean;
}

export interface RunSession {
  /** Prepared override is immutable per invocation, never ambient launch state. */
  spawn(task: Task, prepared?: PreparedRun): Promise<AgentHandle>;
  /** Caller signal cancels only this wait, not the runtime-owned producer.
   *  A new call after retirement rejects as retired/consumed, without effects. */
  supervise(handle: AgentHandle, task: Task, signal?: AbortSignal): Promise<RunResult>;
  /** Live-run queries; undefined once the full entry retires. */
  getHandle(taskId: string): AgentHandle | undefined;
  getTask(taskId: string): Task | undefined;
  resume(options: ResumeOptions & { task: Task }): Promise<AgentHandle>;
  send(taskId: string, text: string): Promise<void>;
  kill(taskId: string): Promise<void>;
  interrupt(taskId: string): Promise<void>;
  /** Explicit presentation hydration only; absent if no owner observe source. */
  observe(taskId: string, at?: number): RunObservation | undefined;
  /** Suppress live delivery, abort the owned wait; idempotent no-op after retirement. */
  suppress(taskId: string): void;
}

export function createRunSession(options: RunSessionOptions): RunSession;
export function defaultRetainSurface(result: RunResult, task: Task): boolean;
```

Without `operations`, resolve the exact role from `roles` (missing role throws),
merge `env` under `task.env`, create a logical session argument
`${sessionIdPrefix ?? sessionBase}-${task.id}` (sessionBase captured once at
construction), and build candidates from `task.runtime` and its ordered
fallbacks. Validate a worktree request's full list before removing fallback
fields; more than one candidate throws the existing refusal. Use the supplied
adapter for single attempts. `sessionId` in generic spawn options is not an
assertion about the Pi child session path. `Task.cwd`, prompt, session, behavior,
tools, systemPrompt, env and `worktreeRequest: task.worktree` pass unchanged.
No `Worktree` path, base SHA, manifest, workspace or pane is fabricated, and
runtime does not create surfaces before calling the adapter. Pi rejects
nonempty env overrides as it does now.

**Default attempt owner:** without custom operations, wrap every successful
`adapter.spawn` or `adapter.resume` handle as `{ handle, adapter }` in an
`OwnedRunAttempt`. Only when that actual handle has `surfaceId` and options
supplies a `SurfaceProvider`, attach a surface-only release that calls that
provider's `closeSurface` with that exact captured ID. A pid alone does not
imply a surface. If either input is absent, omit the release; never fabricate
or acquire a surface, call `adapter.kill`, or add an absence/process-exit wait
to default cleanup. The delivery/retention gate still decides whether an
available release may run, including retaining worktree roots. Leave `observe`
and `finalize` absent unless explicitly supplied by an attempt operation;
`getState` is not a substitute observation source.

An explicit `PreparedRun` is the already-validated composition input and
supplies its captured role instead of a second role lookup. Its producer must
finish validation of all candidates before returning it. Runtime also checks
the complete prepared worktree candidate count before invoking spawnAttempt.
The runtime does not re-resolve a Pi plan from model/thinking or silently trim
an invalid worktree list. `operations.prepare` is called once per invocation;
the validated candidate order remains stable through retries. A Pi attempt
normalizer can refresh role/parent inputs at the same actual-launch boundary as
the existing host; it must not re-resolve or replace those validated plans.

**Registry identity and acquisition:** synchronously reserve `Task.id` as the
logical control identity at entry to spawn/resume, before any asynchronous
preparation or acquisition, including calls with an explicit PreparedRun.
Conflicting spawn/spawn, spawn/resume and resume/resume reject with an error
naming that ID, without calling preparation, adapter or resource operations.
Pi spawnPi/resumePi reserve through this same registry before their asynchronous
preparation/acquisition, not a second Pi reservation map. The reservation is
shared across adopted Pi sessions. Release it only when the invocation fails
before any OwnedRunAttempt was acquired (preparation refusal or all launches
throwing). Once any attempt is acquired, consume that ID for the lifetime of
the same/adopted RunSession; use a new control ID for another run. Full entries
stay only while pending, active, finalizing/delivering, or acquired-but-unsettled
after an onSpawned failure. Terminal accepted, suppressed, or failed delivery
retires the full entry; retain only the consumed-ID identity to reject reuse.
Retained worktrees and failed-delivery panes are handed-off/manual resources,
not settled live runs. No forget/eviction API, archive/cache, retry scheduler or
change to public Pi opaque ID generation is introduced. The consumed-ID set
grows with acquired runs; this is not constant-memory or allocation-free.

A live entry retains its Task, effective persistence, candidate cursor, attempt
list, active `(handle, adapter)` pair, owned completion producer/controller,
delivery disposition and temporary-surface releases. Retirement drops these
full entries, adapter owners, hooks and rich metadata histories from runtime/
composition ownership. Authorized close promises finish independently with
only the capture needed for that close, not a registry-owned history.
`getHandle`/`getTask` are live-run queries and return undefined after retirement.
Register every acquired attempt and its active owner **before** awaiting
`onSpawned` (once per acquired
attempt). If that hook throws/rejects, propagate its original error to the
spawn/resume caller, retain
the registered owner and releases, and do not advance a fallback, invoke
`onSettled`, or close any surface. This is a post-acquisition hook error, not an
adapter launch failure. `getHandle(id)` and `getTask(id)` expose the acquired
run for explicit recovery: the caller can supervise that pair, interrupt/kill
it, or suppress delivery. Supervision starts on the first valid non-aborted
supervise call, not as an implicit hook-error retry. Pi also registers its
actual record/started metadata before its awaited hook; recovery uses the
existing getters, not fabricated success acknowledgement. If a later running
fallback acquires an attempt whose onSpawned rejects, reject the current shared
supervise waits with that original hook error, stop the producer before waiting
on the new attempt, and leave the logical run unsettled with that active owner
registered. A subsequent explicit supervise starts supervision of that same
acquired attempt, without re-acquisition, re-running onSpawned or advancing the
candidate cursor. This is bounded explicit hook-error recovery, not automatic
retry. A retry reuses the reserved control ID/controller, but receives a new
Pi session/pane and owning
adapter. `getHandle`, interrupt, kill and send resolve the current pair; prior
attempts retain their own cleanup owners. A caller cannot supervise an
unrelated handle under another task.

**Caller waits and owned settlement:** runtime has at most one active owned
supervision producer for a logical run (explicit recovery from the above
post-acquisition hook error may start a successor). It calls the owning adapter's
`awaitCompletion` with the runtime-owned signal and runs finalization, retry
and settlement once. Each valid caller joins its shared promise with a separate
caller-local abort listener; no caller signal is forwarded to the adapter.
An already-aborted caller rejects with
`Aborted while waiting for subagent to finish` without starting a producer or
requesting an observation. A later caller abort rejects only that caller with
the same wording: it does not settle the run, invoke `onSettled`, advance
fallbacks, release surfaces, abort the owned signal or cancel another caller.
Even after the **last** caller aborts, the owned producer remains an adapter
consumer until actual settlement or explicit suppression/shutdown. A later
actual completion still finalizes/delivers once. Already-joined caller promises
receive that shared outcome/error even when the full entry retires. A new caller
may join only while the entry is live; after retirement supervise rejects
clearly as retired/consumed, without observation, registration or other effects.
It does not retrieve historical settlement. There is no observer-count
cancellation, new timer, queue, scheduler or implicit kill.

`suppress(id)` is a different, explicit gate: mark delivery suppressed first,
then abort the owned signal, prohibit further fallbacks and skip `onSettled`
and parent event drains/sends. Owned cancellation settles as killed and permits
best-effort ordinary releases while always retaining worktree roots. If no
producer has started, record killed/suppressed settlement without registering a
wait, issue authorized ordinary releases and retire the full entry. After
retirement (including failed delivery), suppress is an idempotent no-op: it
neither closes retained panes nor re-delivers or rewrites the terminal result/
error. Suppression of a live run is idempotent and late callbacks use the
suppression gate; it never calls adapter.kill. Non-aborted callers still follow
the shared producer outcome (killed on owned abort), not a caller-local abort
rejection. If actual evidence won the race, retain that outcome but suppress its
undelivered parent hook. Pi also marks the shared lifecycle suppressed before owned cancellation so
rebound hooks cannot send late results.

**Two retry paths:**

1. Launch failure: attempt every validated candidate whose acquisition call
   (`adapter.spawn` or `PreparedRun.spawnAttempt`) throws before returning an
   owner, including persistent launches. Catch only that acquisition call,
   never the subsequent registration/onSpawned hook. Preserve ordered failures
   and the existing exhausted-launch message. There is no persistent launch exclusion.
2. Running error: after attempt finalization, advance only when effective
   persistence for the active attempt (OwnedRunAttempt.persistent, otherwise
   PreparedRun.persistent) is false, `result.evidence?.errorMessage !== undefined`, and
   another candidate remains. An empty string is present. `RunResult.error`,
   exit status alone, `reason === "error"`, a negative summary and a classified
   provider message are not substitutes. Do not add a worktree predicate here;
   full request validation already prevents the production multi-candidate
   worktree shape. Pi sidecar normalization supplies nonempty error text, but
   generic seam tests must preserve absence versus empty/present.

Pi composition accumulates launched/failed candidates in the host's existing
attempt order, including initial launch failures and failed later launches.
The exhausted running-fallback result keeps the prior error and appends
`Fallback launch failures: <model>: <raw error>; ...`. Do not send parent-facing
settlement for an intermediate failed attempt or close its temporary pane.

Evidence with `done` or `sentinel` and exit 0 maps to `completed`; those reasons
with nonzero exit map to `failed`; `ping` maps to `help`; `error` maps to
`failed`. Rejection from the runtime-owned completion producer matching
`/abort/i` maps to `killed`; other owned rejection maps to `failed` with
`RunResult.error`. Caller-local abort rejection never enters this mapping or
the settlement/retry pipeline. Never invent evidence exit codes; Pi's existing cancellation/unexpected-error public presentation uses
exit 1 independently of missing evidence. Interruption sends Escape and does
not settle a process. Explicit kill is destructive; cancelling a wait is not.

**Supervision and observations:** the owning adapter alone calls its
coordinator's `register` in `awaitCompletion`. Runtime does not register a
second wait or wake watcher. Stage 3 currently omits the fourth argument and
the coordinator constructs its one default `FileWakeRegistry` internally.
Task 13 explicitly constructs one registry and injects that exact instance as
the coordinator's fourth argument: equivalent single ownership, not a claim
that Stage 3 already supplies that argument. The adapter's optional `wake`
compatibility argument creates no registration. Keep shared 4.8-second
reconciliation and existing one-second fallback; do not port maestro's Supervisor or add per-task polling. Fakes need
no production registration. Pi's existing constructor `onObservation` feeds
runtime hooks on local-evidence, pane, tick, completion, state and interrupt.
`observe(taskId, at)` explicitly performs only supplied activity-file hydration
and projection, including health/detail and durable interrupt precedence; the
existing host widget/status presentation timer can request a `refresh`.
Without an attempt's observe source it returns undefined. Unowned legacy/seeded
presentation records use the separate module-level Pi-local activity operation below; it confers no Task ownership and requires
no initialized session. The host consumes
onObserved for presentation/status and local-evidence persistent drain, not a
new completion/busy/deadline loop. No recursive `getState` call or runtime
refresh timer. Each non-aborted supervise caller requests an initial cheap
observation when available; Pi's adapter supplies ongoing events and completion observation before final
settlement. Local-evidence also invokes the host's persistent event drain,
catching delivery failure for retry on the next wake. A projection or `getState === idle` is not
proof that a persistent task result was delivered.

**Process settlement and delivery:** evidence -> finalizing/frozen elapsed ->
transcript/runtime reconciliation and worktree manifest finalization ->
terminal result -> parent hook -> permitted temporary-pane release. Duration
and Pi elapsed seconds are frozen for the final attempt, not summed across
fallback attempts, matching the existing watch path. Manifest
state is finalized before delivery, including failed/help outcomes and
manifest warning aggregation. Normal finalization never removes worktrees.
`defaultRetainSurface` returns `!!task.worktree`, at process completion only;
ordinary help closes after delivery, persistent task/help events do not close
the process, and worktree roots remain open.

Pi suppression also marks the shared record's lifecycle delivery suppressed;
late settlement cannot send through rebound host hooks or re-drain persistent
events. Explicit suppression of a live run authorizes ordinary release;
caller-local cancellation never does. Failed persistent TASK delivery leaves
the PROCESS active, so final shutdown still suppresses that live process and
issues ordinary cleanup. This differs from terminal process-delivery failure,
which retires the entry and leaves its panes for manual recovery. Generic result
output may use available evidence/finalization data; no unconditional terminal screen
read is added to settlement merely to fill optional RunResult.output.

A successful `onSettled` return of void or `"delivered"` means the host send
was accepted; `"suppressed"` explicitly permits ordinary temporary cleanup
without sending. No hook means explicit no-parent suppression. A throw/rejected
promise is a delivery failure: retain all temporary attempt panes, propagate
the delivery error without converting it into provider retry, and do not close
in an unconditional finally. Pi's ordinary hook preserves the existing
mark-delivered/delete-before-send timing: failure leaves panes retained but
does not promise automatic redelivery. Persistent task delivery instead
releases assignment only after send and ledger append both succeed. These
are different contracts, not a new uniform retry policy. After terminal
accepted, suppressed or failed delivery, retire the full live entry; joined
callers keep their shared result/error, not a new historical lookup. Surface
close is issued best-effort after authorization with synchronous throws and
async rejection observed/caught. Ordinary process settlement/result delivery
never waits for close round-trips: it can finish while close remains unresolved.
Normal cleanup calls surface close, not kill or absence-wait destruction of a
retained root.

#### Pi-local composition (Task 13)

`maestro/runtime/pi-run-session.ts` owns these typed production inputs and
outputs, consumed by real operations rather than shallow re-exports. Referenced
`ResolvedRuntimePlan`, `ParentRuntime`, `ModelRegistryAdapter` and `PaneConfig`
are the committed declarations in `runtime-routing.ts` and `pane-config.ts`,
with exact temporary edges until Tasks 15 and 17. They are not reduced plans.
`PiWorktreeLaunch` and `PiWorktreeHandoff` below preserve Pi resource IDs while
core worktree declarations stay unchanged.

```ts
export interface PiLaunchSnapshot {
  parent: {
    cwd: string;
    invocationCwd?: string;
    sessionFile: string;
    sessionId: string;
    sessionDir: string;
    agentDir?: string;
  };
  parentRuntime?: ParentRuntime;
  modelRegistry: ModelRegistryAdapter;
  paneConfig: PaneConfig;
}

export interface PiLaunchInput {
  task: Task;
  role: Role;
  plans: readonly [ResolvedRuntimePlan, ...ResolvedRuntimePlan[]];
  resolved: { agent?: string; cwd?: string; roleCwd?: string; tools?: string };
  identity: { id: string; logicalId: string; generationId: string; taskId: string };
  warning?: string;
  surface?: SurfaceHandle;
  /** Existing host normalization may re-read role files for each actual retry launch. */
  prepareAttempt?(candidateIndex: number): PiAttemptSnapshot;
}
export interface PiAttemptSnapshot {
  task: Task;
  role: Role;
  resolved: { agent?: string; cwd?: string; roleCwd?: string; tools?: string };
  identity: { id: string; logicalId: string; generationId: string; taskId: string };
  snapshot: PiLaunchSnapshot;
}

export interface PiResumeInput {
  taskId: string;
  name: string;
  sessionPath: string;
  message?: string;
  autoExit?: boolean;
}

export interface PiWorktreeLaunch extends WorktreeHandoffBase {
  workspaceId: string;
  paneId: string;
}
export interface WorktreeHandoffBase {
  path: string;
  branch: string;
  baseRef: string;
  baseSha: string;
  manifestFile: string;
  sessionFile?: string;
  sourceSessionFile?: string;
  handoffMessage?: string;
}
export interface PiWorktreeHandoff extends PiWorktreeLaunch {
  headSha: string | null;
  commitsAhead: number | null;
  clean: boolean | null;
  conflicted: boolean | null;
  changedFiles: string[] | null;
  untrackedFiles: string[] | null;
  gitError?: string;
}

/** Structural view of the adapter's actual mutable child, not a copied registry row. */
export interface PiRunRecord {
  id: string;
  name: string;
  task: string;
  agent?: string;
  surface: string;
  startTime: number;
  sessionFile: string;
  launchScriptFile: string;
  activityFile: string;
  interactive: boolean;
  runtimePlan: ResolvedRuntimePlan | undefined;
  worktree?: PiWorktreeLaunch;
  lifecycle: SubagentLifecycle;
  persistent?: boolean;
  logicalId?: string;
  generationId?: string;
  policyHash?: string;
  policyTools?: string[] | null;
  policyDeniedTools?: string[];
  tasksCompleted?: number;
  taskId?: string;
  inboxSequence?: number;
  observedTaskEvents?: number;
  stopState?: "requested" | "pending" | "failed";
  stopFailure?: string;
  crashNotified?: boolean;
}

export interface PiStartedMetadata {
  id: string;
  name: string;
  task: string;
  agent?: string;
  sessionFile: string;
  launchScriptFile?: string;
  model?: string;
  thinking?: ThinkingLevel;
  runtimePlan?: ResolvedRuntimePlan;
  worktree?: PiWorktreeLaunch;
  warning?: string;
  status: "started";
}
export interface PiCompletedMetadata {
  run: RunResult;
  name: string;
  task: string;
  agent?: string;
  summary: string;
  sessionFile?: string;
  exitCode: number;
  elapsed: number;
  error?: string;
  errorMessage?: string;
  ping?: { name: string; message: string };
  fallbackAttempts?: string[];
  fallbackFailures?: { model: string; error: string }[];
  runtimePlan?: ResolvedRuntimePlan;
  worktree?: PiWorktreeHandoff;
  logicalId?: string;
  generationId?: string;
  policyHash?: string;
}

export interface PiPersistentEvent {
  version: 1;
  type: "task-done" | "help-request";
  task: string;
  generation: string;
  at: string;
  message?: string;
}
export interface PiLedgerEntry {
  task: string;
  outcome: "dispatched" | "delivered" | "rejected-busy" | "help-requested" | "stop-pending" | "stopped";
  generation: string;
  logicalId: string;
  policyHash: string;
  at: string;
}
export type PiSendAcknowledgement =
  | { id: string; task: string; inbox: string; outcome: "dispatched" }
  | { error: string; task?: string; outcome?: "rejected-busy" };
export type PiStopAcknowledgement =
  | { id: string; name: string; status: "stop_requested" | "stop_pending" }
  | { error: string; id?: string; name?: string };

/** Narrow I/O for the existing host persistent policy, not a task scheduler. */
export interface PiPersistentIO {
  /** Raw events only; cursor indexes this array before generation filtering. */
  readEvents(record: PiRunRecord): PiPersistentEvent[];
  /** Explicit lazy read, once per drain with eligible post-cursor events. */
  readLedger(record: PiRunRecord): PiLedgerEntry[];
  /** Transcript read only for an undelivered task-done, never help/quiet wakes. */
  readTaskSummary(record: PiRunRecord): string;
  rejectBusy(record: PiRunRecord, task: string): void;
  dispatch(record: PiRunRecord, task: string, text: string): string;
  requestStop(record: PiRunRecord): void;
  acknowledge(record: PiRunRecord, event: PiPersistentEvent): PiLedgerEntry;
  recordStopped(record: PiRunRecord): void;
}
/** Run-scoped settlement I/O; only resumed acquisitions supply the late reader. */
export interface PiSettlementIO extends PiPersistentIO {
  readResumeResult?(): { summary: string; sessionFile: string };
}
export interface PiPersistentHostOperations {
  send(record: PiRunRecord, text: string, io: PiPersistentIO): PiSendAcknowledgement;
  stop(record: PiRunRecord, timeoutMs: number, io: PiPersistentIO): PiStopAcknowledgement;
  drain(record: PiRunRecord, io: PiPersistentIO): void;
}

export interface PiProgressEvidence {
  updatedAt?: number;
  classification: "blocked-tool" | "truncated-turn" | "generic-no-progress";
  lastEntryKind: "assistant" | "tool-result" | "message" | "other" | "none";
}
export interface PiBtwInput {
  question: string;
  parentSessionFile: string;
  leafId: string;
  cwd: string;
  invocationCwd: string;
  sessionDir: string;
  sessionId: string;
  model: string;
  thinking: ThinkingLevel;
  agentDir?: string;
}
export interface PiBtwMetadata {
  surface: string;
  sessionFile: string;
  launchScriptFile: string;
}
export interface PiRunSessionHooks {
  onSpawned?(record: PiRunRecord, started: PiStartedMetadata, task: Task): void | Promise<void>;
  onObserved?(record: PiRunRecord, observation: RunObservation): void;
  onSettled(record: PiRunRecord, result: PiCompletedMetadata, task: Task, io: PiSettlementIO): void | DeliveryDecision | Promise<void | DeliveryDecision>;
}
export interface PiRunSessionInfrastructure {
  surfaceProvider: SurfaceProvider;
  launchOperations: PiLaunchOperations;
  supervision: SupervisionCoordinator;
}
export interface DefaultRunSessionOptions {
  /** Test injection consumes the actual Stage 3 seams, not replacement launch logic. */
  infrastructure?: PiRunSessionInfrastructure;
  configDir: string;
  configExamplePath: string;
  /** Synchronous fresh snapshot, captured once at each launch/resume call. */
  getLaunchSnapshot(): PiLaunchSnapshot;
  roles: Role[];
  hooks: PiRunSessionHooks;
  persistent: PiPersistentHostOperations;
  forcePolling: boolean;
}
export interface PiRunSession extends RunSession {
  spawnPi(input: PiLaunchInput): Promise<AgentHandle>;
  resumePi(input: PiResumeInput): Promise<AgentHandle>;
  /** Live-run metadata queries; all undefined after terminal retirement. */
  getRecord(taskId: string): PiRunRecord | undefined;
  getStarted(taskId: string): PiStartedMetadata | undefined;
  getCompleted(taskId: string): PiCompletedMetadata | undefined;
  /** Live public Pi run ID -> control Task ID; undefined after retirement, not inbox ID. */
  getControlTaskId(publicRunId: string): string | undefined;
  availability(): { available: boolean; setupHint: string };
  listWorktreeSurfaces(options?: { cwd?: string; timeoutMs?: number }): Promise<WorktreeSurfaceInfo[]>;
  sendPersistent(taskId: string, text: string): Promise<PiSendAcknowledgement>;
  stopPersistent(taskId: string, timeoutMs?: number): Promise<PiStopAcknowledgement>;
  inspectProgress(taskId: string): PiProgressEvidence;
  openBtw(input: PiBtwInput): Promise<PiBtwMetadata>;
  closeBtw(): Promise<boolean>;
  diagnostics(): { mode: "wake+batch" | "polling(forced)" | "polling(fallback)"; watcherCount: number };
  shutdown(reason: "reload" | "new" | "resume" | "fork" | "quit" | undefined): Promise<void>;
}
export function createDefaultRunSession(options: DefaultRunSessionOptions, previous?: PiRunSession): PiRunSession;
```

`PiLaunchOperations` and `SupervisionCoordinator` in the injection declaration
are the existing complete declarations in `launch.ts` and `supervision.ts`.
Tests import their actual owner modules; these types are not re-exported as
standalone compatibility APIs. The factory constructs the production surface
provider, provider-backed launch operations, wake registry and coordinator,
and composes `createRunSession`. With injected infrastructure it uses that
coordinator and its existing registry, creating neither a second coordinator
nor a second registry. Injection is for host-through-adapter fixtures.
It never imports Pi SDK packages: host passes the active wrapped
`ModelRegistryAdapter`, not a new registry. Task 15's shared neutral constructor
and separate host/adapter SDK glue are specified below; the factory continues
to consume only the plain port. No host adapter import, runtime SDK import or
shallow runtime wrapper/reader compatibility export is permitted. `configDir`
is the durable agent config directory, not package-root state. `forcePolling`
is sampled at coordinator creation; existing coordinators retain their settings across replacement just
as Stage 3 does.

**Task 15 Pi-local activity observation**

This module-level export in `maestro/runtime/pi-run-session.ts`, re-exported
as an implemented operation by `maestro/runtime/index.ts`, is **outside**
PiRunSession and the generic ports:

```ts
// pi-herdr-agents extension; no owning session required
export function observePiActivity(
  input: { id: string; activityFile?: string; lifecycle: SubagentLifecycle },
  observedAt: number,
): RunObservation & { activityRead: ActivityReadResult };
```

Truthy supplied path reads the adapter activity file with input.id; absent or
empty path uses projectActivity(undefined). Compute lifecycle with
`observeActivity(input.lifecycle, read, observedAt)` and return exactly
`{ kind: "refresh", observedAt, lifecycle, projection: projectLifecycle(lifecycle,
observedAt), activity: read.ok ? read.activity : undefined, activityRead: read }`.
The operation does not mutate/store input. It performs real read/lifecycle/
projection, not raw-reader laundering. Existing core suppression, terminal,
interrupt and stale-sequence rules remain authoritative.

It is callable immediately after module import, before factory, extension or
session_start initialization and after owner retirement. It requires no
runtime.session, latestCtx or launch snapshot and acquires no Task, control
owner, adapter, watcher, registry history or resources. It inspects no pane,
transcript, ledger or Git, infers no completion and invokes no hooks/messages.
Do not initialize a factory/provider/coordinator or adopt a seeded row to use it.
The required activityRead intersection does not widen generic RunObservation.

Host's owned control-ID branch stays unchanged, including session.observe,
onObserved and the actual mutable record. Only its unowned fallback calls the
operation, after host-local ensureLifecycle has preserved legacy active-tool,
done-as-waiting and interrupt hydration. Host applies
`read.ok ? { ok: true } : { ok: false, reason: read.reason, error: read.error }`
to running.activityRead, including error:undefined when absent. Assign activity
only on success, retaining prior successful activity on invalid/missing reads;
assign returned lifecycle. Status/advisory/interrupt policy and timer cadence
stay host-local. Owned composition hydrate, adapter getState and local-evidence
paths are unchanged beyond imports: no shared hydration rewrite, changed
observation kind/callback order, extra read/hook/watcher or local-evidence read.

**Task 15 neutral registry construction and SDK boundaries**

`maestro/core/routing.ts` keeps RoutingModel and routing declarations. It uses
core/types.ts's seven-member ThinkingLevel union (off through max), with no SDK
type-only edge. The complete neutral model/source/port/constructor shapes are:

```ts
export interface RoutingModel {
  provider: string;
  id: string;
  reasoning: boolean;
  thinkingLevelMap?: Partial<Record<ThinkingLevel, string | null>>;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
}
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

Keep private toRoutingModel and the existing three query method bodies in this
one core owner, retaining receivers. Raw any is the existing boundary shape,
not a new parser/schema or permission to harden guards. Construction makes zero
registry queries; attach supplied capabilities without invoking/memoizing them.
Core's four former SDK sites call the supplied port: explicit validation,
`formatSupported(model, registry)` (its caller passes the same registry),
inherited clamp and catalog. Routing selection/auth order, fallback/worktree
restrictions, provenance, requested/observed fields and exact error/catalog
prose remain unchanged.

`maestro/adapters/pi/model-registry.ts` and the permanent host-local
`pi-extension/subagents/model-registry.ts` each export the same wrapper with
typed conversion closures:

```ts
export function wrapPiModelRegistry(registry: RoutingRegistrySource): ModelRegistryAdapter {
  return createModelRegistryAdapter(registry, {
    supportedThinkingLevels: (model) => getSupportedThinkingLevels(asPiModel(model)),
    clampThinkingLevel: (model, level) => clampThinkingLevel(asPiModel(model), level),
  });
}
// Private in each SDK-permitted owner:
function asPiModel(model: RoutingModel): Model<any>;
```

Only the pinned original 23-line asPiModel SDK conversion and this thin glue
are duplicated identically. Each owner imports SDK and core, never the other;
neutral normalization/query/auth/dedup and routing remain shared. Retain the
planned adapter wrapper and its existing test consumers even without a current
production adapter caller; do not manufacture one or create a shared SDK layer.
SDK capability functions require full Model<TApi>, not RoutingModel; direct
assignment or casts hide a real type mismatch. SDK ModelThinkingLevel includes
off; SDK ThinkingLevel alone does not.

Required behavior and later regression controls:

- **Normalization:** current string provider/id guards accept empty strings;
  no trimming/nonempty/exact-ref hardening (parseExactModelRef is separate).
  reasoning defaults only via `?? false`; map/cost are preserved by reference;
  input is undefined only if not an array; context/maxTokens are finite-number
  filtered. No SDK name/baseUrl/credentials or deep copies in core.
- **Availability:** one optional getAvailable per available(); nonempty direct
  source wins even if all entries fail normalization. Only empty direct source
  triggers optional getAll. Preserve order, skip invalid before fallback auth,
  call raw auth on valid fallback entries before dedup (including duplicates).
  Nonempty direct source bypasses auth here. First-seen `${provider}/${id}`
  dedup, no extra raw lookups.
- **Auth:** with raw predicate, one raw find per auth call and pass its exact
  original object to the predicate; missing original is false without predicate.
  Without predicate, use the existing optional getAvailable exact provider/id
  scan; no getAll rescue, cache or projected-object substitution.
- **SDK conversion:** preserve provider/id/name=id, api="openai-completions",
  baseUrl="", reasoning/map; filter present input to text/image, default
  `["text"]` only when absent (present empty/unsupported input stays empty).
  context/maxTokens and each absent cost component default via `?? 0`. This
  synthetic model is for capabilities, not launch or unknown catalog/init costs.
  Capability calls perform zero raw find/getAll/getAvailable/auth queries.
  Preserve real SDK off-for-nonreasoners, null-map exclusions, defined mappings
  for xhigh/max and upward-before-downward clamp; no hand-written replacement.
- **Active source:** each of the five host calls closes over that invocation's
  ctx.modelRegistry: candidate prevalidation, launchSnapshot, session_start
  preferences/catalog, task-model writer auth predicate and /worktree plan.
  Change only wrapper owner imports; do not consolidate calls, snapshot/cache,
  create a registry or re-query a raw model for capabilities. PiHarnessAdapter
  and PiLaunchSnapshot propagate the supplied port, not wrap/re-resolve it.
  Adapter task-model-init's independent raw SDK capability call stays local.

| Routing path | Port supported calls | Port clamp calls |
| --- | ---: | ---: |
| Explicit supported thinking | 1 | 0 |
| Explicit unsupported thinking, including error formatting | 2 | 0 |
| Inherited thinking with selected model | 0 | 1 |
| Inherited thinking, parent model absent | 0 | 0 |
| Catalog, including nonreasoners | 1 per visible model | 0 |

SDK clamp internally computes levels as before; do not call the supported port
first or memoize the second error-format call. Later core tests inject answers
unlike SDK defaults (explicit max, inherited medium -> low, exact catalog levels)
and assert selected-model identity/level/counts. Adding members to a fake alone
is not a runtime red test under strip-types.

Four directly assembled ports need both required methods, explicit synchronous
fixtures without casts: `test/maestro/pi-harness-adapter.test.ts`,
`test/maestro/pi-run-session.test.ts`, `test/test.ts`'s capturePersistentIO,
and `test/integration/harness-conformance.test.ts`. Keep the adapter fixture's
throwing find proving prevalidated-plan bypass; raw SDK registry suppliers stay raw.
Shared task-model declarations (TASK_CATEGORIES, TaskCategory,
TASK_CATEGORY_DESCRIPTIONS, mutable TaskPreferences and TaskPreferencesMeta)
move to `maestro/core/config/task-model-types.ts`; routing and legacy model-config
consume that leaf. Host and task-model-init split shared declarations from still-legacy
loader/writer/ModelConfig imports until Task 17. No loader/I/O/SDK in the leaf.

Query-spy controls cover constructor zero calls, direct nonempty with throwing
getAll, direct all-invalid without fallback, empty-direct fallback with invalid/
unauthenticated/duplicate entries, absent optional methods, missing/changing
find and auth-without-predicate; assert raw receiver/order/count/object identity,
empty-string IDs and first-seen dedup. Compare fresh core/adapter/host sources
without extra capability-model queries or production-normalized expectations;
active source changes stay visible. Real SDK sparse/null-map/upward-clamp/off
cases and source/AST comparison of both private conversions against the pinned
original guard drift, including SDK-unused defaults/filter fields. Later
changed-seam diagnostics cover full Model return and typed closures; no new ESM
mocking/loader framework. Detached real-file observation tests cover no-factory,
missing/invalid/wrong-ID health, nonmutation and durable interrupt/sequence;
host controls cover no session, no matching owner and retired rows without
adoption, prior activity retention, sequence7 pre-interrupt, unchanged owned
hooks/reads and demand-driven local-evidence I/O. Task 15 code waits for accepted
Task 14 with refreshed import/body/type evidence, not this snapshot's acceptance.

`spawnPi` consumes the role/body, complete validated plans, normalized behavior
on Task, raw `resolved` values and opaque identities. Named role body wins over
bare systemPrompt; bare `agent` stays omitted; tools omission remains omitted.
Model and thinking sources, requested values, clamp adjustment and later
observed mismatch are preserved. Omitted cwd is not converted to an explicit
cwd: keep request cwd, role cwd and parent invocation/agent-directory bases
separate. Validate the entire list and worktree request before creating a
PreparedRun or removing fallback metadata. Category routing selects the first
authenticated worktree candidate in `resolveRuntimePlans`; explicit worktree
fallback lists are refused, never truncated by this boundary.

One adapter is created per actual launch/resume snapshot, with the existing
`PiSpawnOptions.resolvedLaunch` and `launchIdentity`. The owning adapter's
`getRunningChild(handle)` supplies the exact mutable record to `getRecord` and
hooks. This is structural consumption, not a second child state copy. The
runtime registry owns handle/adapter/controller/candidate/release state.
Generic Task ID, public Pi run ID, session reference, logical specialist ID,
generation ID and persistent inbox task ID remain distinct namespaces even
when today's fresh launch supplies equal values. `getControlTaskId` maps public
targets to the generic control entry; resume public ID is the actual returned
handle ID, not its preselected generic Task ID. Host presentation fields and
persistent delivery/timer state can augment that same record, but may not
replace it. New launches capture the latest parent/model/thinking/config.
`prepareAttempt`, when supplied, invokes the existing host normalizer against
that invocation's captured context and thinking argument at each actual launch,
including retries: current source re-reads role definitions there. Its Task ID,
prompt, worktree request and validated candidate list cannot change. It returns
fresh normalized behavior/cwd/tools/role, opaque attempt identities and a
parent snapshot; after initial success preserve the public run ID/controller
while later launches receive fresh generation/task identities as the host does
now. The chosen full plan is still selected from the original validated list. The actual child
reports effective persistence to runtime. Without this callback, reuse the
explicit invocation inputs; do not store an ambient mutable launch context. Supplying
`previous` adopts the existing registry and surviving owners, then rebinds
hooks and the snapshot source for new calls. Do not replace owners with a new
empty adapter. Old completions and adapter observation callbacks dispatch through a shared
current-hook binding, not frozen host callback closures. Launch snapshots stay
per-invocation; delivery bindings stay replaceable.

Pi attempt finalization delegates to the existing transcript and manifest
helpers. Preserve last **nonempty** assistant summary independently of the
adapter's final-message inspection. Reconcile observed model/thinking and
runtimeMismatch. Capture rich worktree IDs and aggregate manifest warnings
before calling `onSettled`. The settlement hook receives this rich completed
metadata before retirement; `getCompleted` is a live query during delivery,
not a historical cache. `getRecord`, `getStarted`, `getCompleted` and
`getControlTaskId` all return undefined after retirement. The parent-facing
result already carries its handoff data; do not add an archive to preserve a
speculative historical getter. Terminal screen output is not a substitute.
Resume captures the parsed entry count **before** launch, restores saved policy, refuses persistent and managed
worktree sessions before pane creation, and builds the hook Task from
`taskId`, name, message (or `"resumed session"`), and saved cwd. Its actual
adapter ID, session path and script path populate started metadata. Host resume
acknowledgement still maps sessionFile to its existing public sessionPath field,
without adding new public tool parameters. Use only
post-cursor entries for the resumed summary and preserve the distinct
`Resumed session exited without new output` wording. The resumed acquisition
supplies a run-scoped `PiSettlementIO.readResumeResult`, capturing only its
session path, cursor, exit code and optional errorMessage scalars. It performs
an actual fresh post-cursor read with the existing resumed fallback wording;
no function is stored in completed-result metadata or shared persistent I/O.
Host invokes it only after the pending-delivery gate, mark-delivered/map-delete
and widget update, and after handling ping (which bypasses the reader).
Stable late-read rejection sends nothing, leaves delivery absorbing at
`delivered`, retains the manual pane and retires both runtime/Pi owners through
the existing rejected-settlement path, even without callers. A recovered read
uses its fresh output or exact resumed fallback. Rejected sends do not resend
or close. Ordinary caught processing failures remain normal exit-one results
without result sessionFile/runtimePlan, retaining full host details from the
live child and fallback wrapper. Ordinary/persistent settlements and explicit
suppression never invoke the resume reader; generic ports remain unchanged.

**Explicit host ownership:** Task 13 retains persistent target/name/cap policy,
delivery deduplication, raw event cursor, task assignment policy, stop timeout
and advisory presentation in the host. `persistent.send/stop/drain` are the
existing handlers with injected `PiPersistentIO`, not a second persistent
implementation. `sendPersistent/stopPersistent` resolve the current record and
invoke them; generic `send` delegates to that path for Pi, returning void on
accepted dispatch and throwing the acknowledgement error on rejection. Never
use generic getState as the busy or delivery gate. Generic non-Pi send simply
uses its owning adapter's `sendInput`.

**Demand-driven persistent I/O:** `PiPersistentIO` exposes three ordinary
methods instead of an eager snapshot or effectful property getters.
`readEvents` reads only the raw event array. Host drain slices after its raw
cursor, skips irrelevant generations and in-flight keys, and calls
`readLedger` lazily once only if an eligible event remains. Ledger deduplication
precedes `readTaskSummary`: read the existing last-nonempty transcript summary
(with the current unavailable/no-output wording) only for an undelivered
`task-done` whose send is being attempted. Help never reads the transcript.
Task events never capture Git; rich worktree capture remains process
completion/finalization or an explicit handoff operation, outside this I/O
interface. No empty placeholder snapshots or hidden eager effects.

Required per-drain read counts (fresh eligible events are after the raw cursor):

| Wake / event | readEvents | readLedger | readTaskSummary | Git capture |
| --- | --- | --- | --- | --- |
| Quiet, no new raw event | 1 | 0 | 0 | 0 |
| Only irrelevant-generation or in-flight events | 1 | 0 | 0 | 0 |
| Duplicate wake, events already behind cursor | 1 | 0 | 0 | 0 |
| New raw matching-generation duplicate already acknowledged in ledger | 1 | 1 | 0 | 0 |
| New help request | 1 | 1 | 0 | 0 |
| New undelivered task-done | 1 | 1 | 1 | 0 |

For multiple eligible events share the one per-drain ledger array; read the
summary once per undelivered done send attempt, not once per wake regardless
of demand. A failed send remains retryable and can re-read that done summary
on the next wake, as today.

The remaining I/O methods perform narrowly bounded mutations:
`rejectBusy` appends exactly one rejected row without inbox creation;
`dispatch` increments inbox sequence, writes the task, assigns its ID, and appends the dispatched row in existing order;
`requestStop` uses `record.taskId ?? "stop"`, preserves active assignment,
appends stop-pending only for an active task, then writes `{type: "stop"}`
with incremented sequence; `acknowledge` appends help-requested/delivered and
then releases matching assignment (and increments tasksCompleted for done);
`recordStopped` appends the stopped row. These methods do not send parent
messages or implement deduplication; the host calls acknowledge only after
accepted send, supplies the returned row to its per-drain ledger snapshot, and
advances the raw cursor only after the full drain succeeds. No generation-
filtered array replaces the cursor source. Send/append failure leaves that
event's assignment/count unchanged and the raw cursor unadvanced for a later
wake; earlier successfully acknowledged events in the same drain stay committed
and are deduplicated on retry, not rolled back. Preserve in-flight `(run ID, event type, task ID)` exclusion.

Initial dispatch remains adapter-owned exactly once. Task-done/help events
are nonterminal process events: host drain does not call generic onSettled,
close a surface or release a worktree lease. Stop is graceful inbox delivery,
not kill; ack means requested/pending, not stopped. Host starts the bounded
stop timer immediately when idle or after accepted task completion when
pending; failed stop rejects sends with the existing unconfirmed-stop guidance
and permits explicit stop retry. Confirm stopped only on process evidence;
retain facts-only crash and failed-stop behavior. Host `onSettled` drains final
events and performs existing stop/crash presentation using the I/O argument.
These host policy callbacks remain intentionally host-owned after Task 18;
Task 17 moves their configuration declarations/loaders, not a scheduler.

`availability` consumes provider availability/setupHint without fabricating
host error wording; host retains muxUnavailableResult and its existing public
failure presentation. Do not add a new Pi executable preflight to public
handlers; current host availability checks only the surface provider.
`listWorktreeSurfaces` consumes the
provider's neutral inspect-only listing for the child command; parent contained
inventory/removal remains the legacy cleanup operation until Task 16.
`inspectProgress` packages the existing bounded tail classification plus
session modification evidence and is called only when the existing advisory
policy needs classification, not on every widget tick; host retains advisory-
only episode policy and cheap modification-time checks.
`openBtw` and `closeBtw` consume session/surface operations: active-leaf detached
snapshot, non-focused tab, shell readiness, tracked provider `runScript`,
`pi --no-extensions`, same model/thinking and existing boundary prompt. A new
open first closes the prior BTW; explicit close uses best-effort Escape, then
surface close, then snapshot/script cleanup. Failure preserves existing
recoverability and best-effort cleanup. BTW has no AgentHandle, supervision,
normal completion hook or parent result, and answering does not auto-close.
Host still owns `waitForIdle`, UI notifications and completed-leaf selection.

`shutdown` preserves live registry/owners/coordinator and consumed IDs on
reload/new/resume/fork and closes BTW as before. Final exit (quit or undefined
reason) suppresses delivery for **all live runs** before asynchronous callbacks
can send or drain, then closes the coordinator/its registry. This is a delivery-
safety rule: shipped cleanup interleaves per-record suppression and abort in a
synchronous loop; promise handlers run afterward. It does not require a literal
two-pass loop or a batch API. Skip settlement hooks and persistent drains/sends
even after failed persistent task delivery. Authorize best-effort temporary-
surface release for ordinary live attempts (including that active persistent
process), while retaining every managed worktree root/workspace. Retired
failed-process-delivery panes remain manual resources, not late suppression
cleanup targets. Closing an ordinary pane can terminate its child process:
this is existing surface cleanup, explicitly pinned by
`test/integration/placement.test.ts:587`, not a new direct process-kill policy.
Issue ordinary close best-effort with synchronous throws and async rejection
caught; production shutdown must not join producers, finalizers, ordinary close
promises, surface absence or process exit. Preserve only the existing BTW await
(`closeBtw`). Integration may poll the actual close effect as the existing
placement cases do; production must not. Do not add `HarnessAdapter.kill`,
worktree removal or a new process-exit wait. No full-restart watcher rediscovery
is introduced.

#### Explicit intermediate gate and later ownership

Stage 4 is not the final composition-root gate. Task 13 removes host provider/
adapter construction and direct session imports, plus the launch loops and
process watcher logic it replaces. It may retain the exact host `launch.ts`
edge for worktree handoff and the `task-model-init.ts` edge for init; these
already have Task 16/17 removal milestones. Host launch-operation/test helper
exports must migrate to tests' actual owning-module fixtures or remain named
under that same Task 16 edge, not be re-exported from runtime. Worktree
inventory/removal stays on the explicit legacy cleanup seam until Task 16.
`launch.ts`'s compatibility default provider construction also remains to Task
16 for that handoff; production watched runs use injected factory operations
from Task 13. Change that existing edge's removalTask openly from 13 to 16.
Task 18, not Task 13, requires no direct host adapter/surface imports.

Task 14 moves lifecycle/status/wake/supervision (including cheap projection
operations), imports lifecycle's plain types from core/types.ts, moves the pure
type-guards leaf forward from Task 17, and makes loadStatusConfig's config/
example paths explicit at host call sites. Its current config-path.ts defaults
cannot follow it into core. Task 15 moves routing and activity-file consumption
plus the shared task-preference declarations routing currently imports from
legacy model-config.ts. No core-to-host exception hides these prerequisites.
Task 16
moves worktree finalization rules into subprocess-free core, implements real
Git/manifest/runtime operations, and replaces host handoff/cleanup construction
with meaningful runtime operations; Task 17 moves roles/config and supplies a
meaningful task-model init operation using the sanitized active-registry brief;
Task 18 removes all exceptions. Core does not run Git. This staging corrects
an impossible earlier gate rather than advancing all of Tasks 14–17 into 12.

## 5. Where existing modules go

| Today (`pi-extension/subagents/`) | Destination | Stage |
| --- | --- | --- |
| `herdr.ts`, `terminal.ts` | `maestro/surfaces/herdr/` | 2 |
| `launch.ts`, `completion.ts`, `session.ts`, `task-model-init.ts` | `maestro/adapters/pi/` | 3 |
| `subagent-done.ts` (child-side extension) | `maestro/adapters/pi/child/subagent-done.ts`; `launch.ts` builds the `-e` path from its own location | 3 |
| `runtime-routing.ts` | Routing and neutral normalization/registry construction to `maestro/core/routing.ts`; typed SDK conversion/glue in `maestro/adapters/pi/model-registry.ts` and host-local `pi-extension/subagents/model-registry.ts` | 5 |
| `activity.ts` | Canonical types already in `core/types.ts`; validated-state projection/scope predicate in `core/activity.ts`; private validators, reader, paths/writer/recorder in adapter `activity-file.ts`; detached lifecycle observation in runtime `pi-run-session.ts` | 5 |
| `lifecycle.ts`, `status.ts`, `wake.ts`, `supervision.ts` | `maestro/core/` | 5 |
| `worktree-cleanup.ts` | eligibility and manifest-state rules to `maestro/core/worktree-cleanup.ts`; Git/process/Herdr operations stay behind injected runtime operations built in `maestro/runtime/` from the surface provider | 5 |
| `index.ts:414-890` role discovery, role packs, agent definition parsing | `maestro/core/roles/` producing `Role` values; `pi.events.emit` for role-pack discovery stays in `index.ts` via a callback | 5 |
| `role-config.ts`, `model-config.ts`, `persistent-config.ts`, `pane-config.ts`, `supervision-config.ts` | `maestro/core/config/`; loaders take the config directory as a parameter in Task 17 | 5 |
| Pure `type-guards.ts`; shared task-model declarations consumed by routing | `maestro/core/config/`; leaf guards in Task 14, task-model declarations in Task 15 | 5 |
| `config-path.ts` | stays; resolves `$PI_CODING_AGENT_DIR` and passes it in | 5 |
| Worktree finalize and launch manifest/handoff helpers | Pure schema/state rules in `maestro/core/worktree.ts`; Git/process/manifest I/O and handoff capture in injected `maestro/runtime/worktree-operations.ts` | 5 |
| `index.ts` launch, watch, interrupt, resume, persistent send/stop, BTW launch | `maestro/runtime/` through `RunSession`; `index.ts` keeps the tool and command handlers that call it | 4 |
| `index.ts` widget rendering, status refresh, `sendSubagentResult`, result presentation | stays in `index.ts` (Pi UI and delivery) | 4 |

Moves are `git mv` with import updates only. Function bodies do not change
in a move commit. Task 15 is the bounded split exception: named validated-state
projection, detached-observation and capability-injection adaptations preserve
validation/query/capability contracts; it is not pure byte relocation or a
behavior improvement. Behavior changes, if any, require a separate decision
and their own tests.

## 6. Composition root

After Task 13 the host calls `createDefaultRunSession(options, previous)` and
uses its typed Pi operations; it does not construct adapters, providers or
completion registrations directly. The factory retains owning instances and
captures fresh launch inputs per invocation, not one frozen parent per session.

The host registers tools/commands, selects roles and normalized launch inputs
(until Task 17), renders widgets/status/advisories, delivers parent messages,
and owns persistent target/cap/deduplication/stop-timer policy through section
4.4's injected operations. Its hooks consume rich typed metadata; successful
send, explicit suppression and failed send have distinct cleanup consequences.
It requests owned cheap observations and the module-level observePiActivity
for unowned legacy/seeded presentation refresh, never completion polling or
ownership acquisition. Permitted host-local model-registry SDK glue supplies
core's neutral constructor, not a direct adapter import or runtime wrapper/
raw-reader compatibility re-export.
`session_shutdown` delegates the reason-aware suppression/cancellation contract.

Direct worktree handoff/cleanup and task-model init consumers remain staged to
Tasks 16 and 17. After Task 18 there are no host adapter/surface imports or
shallow re-exports concealing them. Host persistent policy and presentation
remain host-owned; session I/O, launch, evidence collection and production
resource ownership do not.

Host-call accounting: the 93 `pi.*` and `ctx.*` call sites in `index.ts`
reduce to registration, `ctx.ui`, `ctx.sessionManager` reads for the parent
session, `ctx.modelRegistry` handed to the adapter, and `pi.sendMessage` and
`pi.sendUserMessage` for delivery. The dependency-rule test is the check.

## 7. Error handling

- Public handlers check surface-provider availability and return the existing
  `muxUnavailableResult()` text. Adapter `isAvailable()` remains a seam method;
  this extraction does not add a new public Pi-executable preflight.
- A throw from `adapter.spawn` is reported by the tool handler exactly as
  today's launch failure path, including runtime-plan fallback retries,
  which stay in `index.ts` until stage 4 and move into `RunSession.spawn`
  there with the same candidate order. The adapter preserves the single
  launch transaction, including manifest-before-resource creation for
  worktrees.
- Runtime-owned `awaitCompletion` rejecting with abort maps to `killed`; any
  other owned rejection maps to `failed` with `error` set to the message.
  Caller-local abort instead rejects that caller's wait with the existing
  wording and never settles the logical run. Post-acquisition onSpawned errors
  propagate while leaving a registered, recoverable owner; duplicate reserved
  or previously acquired control IDs reject before preparation. Unknown Git
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
   through the adapter. The old legacy launch path leaves the allowlist;
   exact moved-adapter edges remain until their Task 14–17 milestones. Acceptance:
   adapter conformance passes against the real adapter in integration.
4. **Run session.** Implement section 4.4's generic runtime and typed Pi
   composition; rewire watched runs, controls, persistent I/O and BTW. Remove
   replaced host construction/session edges, retaining only the named Task
   16 worktree and Task 17 init host edges plus later module-migration edges.
   Acceptance: no duplicate registration/acquisition, preserved host-through-
   adapter regressions, and an exact live-edge allowlist, not an empty one.
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
