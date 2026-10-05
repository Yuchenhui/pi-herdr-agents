# ADR-0014: Operator cancel records terminal intent before termination

- **Status:** Accepted
- **Date:** 2026-10-05
- **Scope:** Public `subagent_cancel` for ordinary managed Pi subagents

## Context

An operator could interrupt a turn (`subagent_interrupt`) but not end a run.
`subagent_stop` is the persistent-specialist graceful stop and rejects ordinary
children. Closing a child's pane by hand made the watcher report "pane
disappeared" as a provider/agent error, which the run session treated as a
retryable failure and launched the next configured fallback model. Wrapping the
existing primitives does not fix this: `suppress` drops delivery entirely, and
`kill` alone produces exactly that fallback-eligible error.

## Decision

`RunSession.cancel(taskId)` is the one cancellation path, owned by the existing
kernel producer, adapter, and finalization. It is not a second engine.

1. **Terminal intent first.** The call records the cancel intent synchronously,
   before any abort, kill, or await. Every later decision reads it: no fallback,
   acquisition, retry, or recovery starts after it.
2. **Settle point.** The producer's synchronous check after an attempt's wait
   settles decides the race. Intent recorded before it makes the run cancelled,
   even if natural evidence (including the kill's own pane-loss evidence)
   arrived first. A natural result that cannot start a fallback, taken before
   the intent, stays authoritative and cancel reports `already-terminal`. A
   cancel during a fallback-eligible attempt's finalization still wins because
   that result was not terminal.
3. **Owned termination.** The kernel calls the owning adapter's `kill` for the
   current attempt, one kill at a time; concurrent cancels join it. Only a
   resolved kill confirms termination, and only then is the producer's wait
   aborted, so a failed kill leaves the run supervised.
4. **Pending acquisition.** With an acquisition in flight, cancel reports
   `requested`. The acquired owner is registered as usual, so it is never
   leaked, and killed immediately; no later candidate is attempted. A cancel
   before any acquisition rejects the launch without acquiring anything. If
   the in-flight acquisition fails, the settled previous attempt is still owned
   and is terminated before delivery.
5. **One result.** A confirmed cancel is finalized once by the attempt that owns
   it and delivered once with the existing `killed` outcome and a
   `cancellation` record (`requestedAt`, `termination`, `confirmedAt`). Pi
   presents it with its existing "Subagent cancelled." summary and `cancelled`
   error marker, never as a provider failure.
6. **Unconfirmed is not terminal.** A failed kill reports `unconfirmed` with the
   error. The run keeps its live ownership, watcher, row, and panes; nothing is
   delivered, retired, or released. A retry repeats the kill and keeps the first
   `requestedAt`. If the wait later settles on its own, the producer makes one
   kill attempt itself, then waits for an operator retry or shutdown
   suppression, which settles without delivery.
7. **Surface ownership.** Pi `kill` closes an ordinary pane and confirms its
   absence through Herdr; a close error on an already-absent pane is still
   confirmed by that absence. A managed-worktree root pane is the retained
   review workspace, and Herdr refuses to close it. For that child, `kill`
   signals SIGTERM only to the Pi process Herdr reports in the pane foreground
   with the child's exact `--session` and worktree cwd. On Linux it also
   re-checks `/proc/<pid>/cmdline`, so a PID-namespace mismatch cannot misfire.
   Confirmation requires Herdr to report that process gone and the retained
   shell idle, or the pane gone. Any other foreground process is never
   signalled and makes termination unconfirmed. The manifest records
   `cancelled`, and the handoff is captured as for any completion. There is no
   Git cleanup.
8. **Persistent specialists are rejected** before any kill; `subagent_stop`
   keeps its graceful v1 semantics.

## Consequences

- Cancel never confirms more than its evidence: ordinary confirmation is Herdr
  pane absence, which terminates the pane's PTY, not an OS PID check. Worktree
  confirmation is Herdr's process-info view of the retained pane.
- An unconfirmed cancel can leave a live row indefinitely until a retry, the
  child's exit, manual pane closure, or parent shutdown.
- Late callbacks after delivery change nothing: the retired ID answers
  `already-terminal`.

## Rejected alternatives

- **Boolean flag plus gate around `kill`:** it misses pending acquisitions, the
  abort-before-confirmation race, and finalization provenance.
- **`suppress` then `kill`:** it drops the one result the parent is waiting for.
- **Deliver `unconfirmed` and retire:** it would release live ownership whose
  process may still be writing.
- **Close the worktree root pane:** it would discard the retained review
  workspace that worktree runs promise to keep.
- **Escalate to SIGKILL automatically:** an operator retry repeats the bounded
  SIGTERM check instead; forced escalation stays outside this decision.
