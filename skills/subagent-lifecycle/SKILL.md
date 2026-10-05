---
name: subagent-lifecycle
description: Control a running pi-herdr-agents subagent. Use when asked to stop, cancel, interrupt, abort, resume, restart, or clean up a child, or when a child looks hung, stalled, or unwanted.
---

# Subagent lifecycle control

Children run asynchronously in Herdr. `subagent` returns an acknowledgement and
the result is delivered to you automatically. Never poll, sleep, tail session
files, or repeatedly list status to wait for a child.

## Authority

Live tool descriptions, the installed package's README, and the installed
version are authoritative. An installed release can predate current source, so
a tool described here may be absent. Check which `subagent*` and `worktree_*`
tools you actually have, and read the README under the installed package root
(the path in your Pi packages settings) before relying on a behavior not listed
below.

## Decision table

| Goal | Use | Effect | Not guaranteed |
| --- | --- | --- | --- |
| Halt the child's current model turn, keep its session | `subagent_interrupt({ id\|name })` | Sends Escape only. Pane, process, and session stay alive; widget shows `interrupted` | No result is emitted; the child is not stopped and may start work again |
| End a persistent specialist cleanly | `subagent_stop({ id\|name })` | Graceful: waits for the active task to finish, then confirms exit | Persistent specialists only; not immediate |
| Terminate an ordinary (non-persistent) child | See "Pending: subagent_cancel" | — | Until that tool exists, only interrupt, or let it finish |
| Continue an exited ordinary child | `subagent_resume({ sessionPath, message })` | New ordinary pane on the old session | Does not reattach worktree ownership; not for persistent specialists |
| Send follow-up to a live persistent specialist | `subagent_send` | Delivers one task if idle | Rejected while busy or stop-unconfirmed |
| Close the pane, kill the process, Ctrl-C by hand | Avoid | See "Fallback gotcha" | Can launch a replacement run |

If the child is merely slow, do nothing: the result or a `caller_ping` help
request will arrive on its own. Stalled notices are facts, not instructions to act.

## Lifecycle states

Widget labels as documented in the README:

- `starting` — launched; confirmation still settling
- `active` — processing (turn, provider request, streaming, tool call)
- `blocked` — Herdr reports the child blocked
- `waiting` — turn finished; process open for more input
- `interrupted` — turn cancelled by Escape or `subagent_interrupt`; process still open, not active
- `stalled` — pane inspection unhealthy; the parent cannot trust the run (also used for an unconfirmed stop)
- `running` — coarse process presence only
- `finalizing` — completion observed, delivery in progress

Herdr's own `agent_status` values (`idle`, `working`, `blocked`, `done`,
`unknown`) describe the pane occupant as the multiplexer sees it, not the host's
run state above. Treat `unknown` as "no evidence", never as stopped or clean.

Check the README and live output for the exact set in your installed version.

## Evidence before declaring stopped

A request is not an exit. `interrupt` sent, `stop` requested, or `stop-pending`
means nothing has stopped. Say a child is stopped only when you have either:

1. a delivered result or failure notice for that run, or
2. confirmed process-exit evidence (for example `subagent_stop` reporting `stopped`).

If a stop times out, the specialist is `stalled` with an unconfirmed stop. Retry
`subagent_stop` for another bounded check, or spawn a replacement; report the
uncertainty rather than asserting it exited. Do not start a concurrent writer
on the same files or worktree until exit is confirmed.

## Fallback gotcha

Closing a child's Herdr pane by hand is read as error evidence. The host can
then launch a fallback model under the same logical session, so the work you
tried to cancel keeps going. Never close panes, kill processes, or send raw
terminal keystrokes to cancel a child. If a fallback launched anyway, identify
the new run and handle it with the tools above.

## Persistent versus ordinary

- Ordinary children exit when done and can be interrupted or resumed.
- Persistent specialists stay alive between tasks, accept `subagent_send`, can be
  interrupted or stopped with `subagent_stop`, and cannot be resumed; spawn a new
  one after a crash or confirmed stop.

## Worktrees, handoff, and cleanup

- Worktree workspaces are retained after success, failure, or help requests.
- Review the reported Git state first. Inspection failures mean unknown, not clean.
- `subagent_resume` opens an ordinary pane and does not reattach worktree
  ownership. Continue in the retained workspace only after the previous process
  has exited.
- Removal needs separate explicit authorization and `worktree_remove`. Stopping
  or interrupting a child never authorizes cleanup. Branches are never deleted
  automatically; the parent owns review, integration, and publication.

## Pending: subagent_cancel

This section is a placeholder. The tool is not documented as available here.
The parent fills it from the committed tool description once it ships.

- Tool description: `<PENDING: copy from committed tool description>`
- Parameters: `<PENDING>`
- Result states and meaning: `<PENDING: e.g. requested / confirmed-exited / unconfirmed>`
- Persistent and worktree behavior: `<PENDING>`
- Decision-table row to finalize: `<PENDING>`

Until filled, do not assume `subagent_cancel` exists.

## Finding current tool help

Read the live tool descriptions in your session first, then the README sections
"Interrupting a running subagent", persistent specialist stop, and worktree
cleanup in the installed package. Confirm the installed version before trusting
source on a branch.
