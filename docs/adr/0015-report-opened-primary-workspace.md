# ADR-0015: Report the primary workspace worktree creation opened

- **Status:** Accepted
- **Date:** 2026-10-07
- **Amends:** [ADR-0011](0011-explicit-worktree-cleanup.md)

## Context

`herdr worktree create` groups a new worktree with the source repository's
primary workspace and opens that workspace when none is open. `herdr worktree
remove` removes only the linked checkout, so the first worktree of an idle
repository leaves an empty shell workspace behind.

Herdr's `WorktreeCreated` result does not include `created_parent`, so this
extension cannot ask Herdr which workspace the create call opened. The only
signal is a `herdr worktree list --cwd` snapshot before create and another
after it. A workspace the user or another session opens during a long checkout
can be attributed to this create. That race is inherent in the snapshots.

## Decision

Explicit worktree removal never closes the source repository's primary
workspace.

On a worktree launch, this process may record one claim: workspace id, the
source `repo_key`, the only pane's `terminal_id`, and the checkout path the
workspace was opened at. A workspace that was already open is not claimed. A
snapshot that fails, times out, or lacks a required field claims nothing, and
the failure is logged. Ordinary non-worktree launches do not take these
snapshots.

The claim lives only in the creating process. Removal from another session, or
after this process restarts, reports nothing even if a manifest still contains
a copy of the claim. Manifest copies are not consulted. Extension reload inside
the same process keeps the in-memory claim.

On explicit removal, if this process holds a complete claim for the source
repository Herdr reports, the Herdr surface re-reads that workspace. It may
tell the parent:

`wX was opened by worktree creation; close it with herdr workspace close wX`

only when a second read, taken immediately before that sentence, still shows
the workspace untouched: default label, not focused, one tab, one pane, the
recorded terminal, `cwd` and `foreground_cwd` still at the recorded checkout,
an idle shell, and no child processes. No other linked worktree workspace may
be open. Any missing or wrong-typed field (`label`, `focused`,
`foreground_cwd`, `terminal_id`, or any other field a check uses) means the
workspace is not claimable or not untouched, so removal says nothing about it.
The surface method is `SurfaceProvider.reportOpenedPrimaryWorkspace`. Herdr
implements it. Other surfaces return an unsupported result and do not report.
Core does not import Herdr.

A failed report is a warning. The checkout removal still succeeds. Nothing in
this path polls, retries, or sleeps.

### Blocking time

A worktree launch adds at most three synchronous Herdr calls, each bounded at
10 seconds:

1. `herdr worktree list --cwd` before create
2. `herdr worktree list --cwd` after create, only when the before snapshot
   succeeded and showed no primary workspace
3. `herdr pane list --workspace` for that workspace's terminal, only when the
   after snapshot shows a new primary workspace with a repo key and checkout
   path

If each of those three runs to its timeout, the extra blocking time is 30
seconds. A failed before-snapshot skips the later two. `herdr worktree create`
itself is an existing call and is not given a new timeout here.

Explicit removal adds report calls only when this process holds a claim.
The longest path is nine synchronous calls:

1. `herdr worktree list --cwd` — 30 seconds
2. `herdr workspace get` — 30 seconds
3. `herdr pane list --workspace` — 30 seconds
4. `herdr pane process-info` — 30 seconds
5. `pgrep -P` — 5 seconds
6. `herdr workspace get` again — 30 seconds
7. `herdr pane list --workspace` again — 30 seconds
8. `herdr pane process-info` again — 30 seconds
9. `pgrep -P` again — 5 seconds

Calls 6–9 are the re-check and are the only reads allowed to produce the
note. If every call runs for its full timeout, that is 220 seconds. A failed
call stops the rest. These calls are in addition to the existing cleanup Git
and Herdr calls, which stay at 30 seconds each. With no claim, removal adds
none of them.

## Rejected alternatives

- **Automatic close from the idle-shell heuristic.** One tab, one pane, the
  same terminal id, cwd at the checkout, an idle shell, no children, and the
  default label cannot tell whether the user worked in the workspace. `git
  log`, a test run, and `cd` back to the checkout leave that same picture, and
  closing it would destroy the scrollback.
- **Pane fingerprinting.** Reading `herdr pane read --source recent` at claim
  time and requiring the same text before a close would catch some commands
  the heuristic misses. It is not clearly better than reporting. Prompt
  redraws, hooks, and Herdr's own startup change the text without a user
  command; a cleared screen looks untouched; a read can fail; and the gap
  between the confirming read and a close is still a race. A mistaken close
  is destructive. A mistaken report is a command the user can ignore.
- **Trusting the manifest after restart.** The creating process is the only
  observer of the before/after snapshots. A later process would be acting on
  a claim it did not make.

## Consequences

Cwd containment, branch retention, and the rejection of automatic reaping in
ADR-0011 are unchanged. A misattributed claim can name a workspace this create
did not open. The message does not close it. The "no other linked workspace"
check is not part of the immediate re-check; a linked workspace that appears
during the report can be missed, and the message is still only a suggestion.

See the [operating guide](../worktree-subagents.md#cleanup).
