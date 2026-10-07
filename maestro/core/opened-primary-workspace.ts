import { isNonEmptyString } from "./config/type-guards.ts";

/**
 * A primary workspace this process saw Herdr open while creating a worktree.
 * The record lives only in this process. Another session is another process,
 * and a restart starts empty, so neither reports a claim. Manifest copies are
 * not consulted.
 */
export interface PrimaryWorkspaceClaim {
	workspaceId: string;
	repoKey: string;
	terminalId: string;
	checkoutPath: string;
}

export interface ReleasedPrimaryWorkspaceClaim {
	workspaceId: string;
	repoKey: string;
	terminalId: string;
}

/** A report never closes a workspace. `note` is absent when nothing is safe to suggest. */
export interface OpenedPrimaryWorkspaceReport {
	note?: string;
	repoKey: string;
	releasedClaims: ReleasedPrimaryWorkspaceClaim[];
}

/** Each launch snapshot (`worktree list` or the opened workspace's `pane list`). */
export const OPENED_PRIMARY_SNAPSHOT_TIMEOUT_MS = 10_000;

/**
 * How many of those snapshots a worktree launch can run: list before create,
 * list after create, and pane list for the opened workspace.
 */
export const OPENED_PRIMARY_SNAPSHOT_CALLS = 3;

/** `pgrep -P` while deciding whether a removal may mention the primary workspace. */
export const OPENED_PRIMARY_CHILD_CHECK_TIMEOUT_MS = 5_000;

/**
 * Positive removal report, each call at its timeout: one 30s worktree list,
 * then workspace get, pane list, process-info (30s each) and pgrep (5s),
 * then those four again immediately before the note.
 */
export const OPENED_PRIMARY_REPORT_CALLS = 9;
export const OPENED_PRIMARY_REPORT_WORST_CASE_MS = 220_000;

const openedPrimaryWorkspacesKey = Symbol.for(
	"pi-herdr-agents:opened-primary-workspaces",
);

interface OpenedPrimaryWorkspaceStore {
	claims: PrimaryWorkspaceClaim[];
}

function store(): OpenedPrimaryWorkspaceStore {
	// SAFETY: this extension alone writes this process-local symbol.
	const globalStore = globalThis as typeof globalThis & {
		[openedPrimaryWorkspacesKey]?: OpenedPrimaryWorkspaceStore;
	};
	return (globalStore[openedPrimaryWorkspacesKey] ??= { claims: [] });
}

export function isCompletePrimaryWorkspaceClaim(
	value: PrimaryWorkspaceClaim,
): boolean {
	return (
		isNonEmptyString(value.workspaceId) &&
		isNonEmptyString(value.repoKey) &&
		isNonEmptyString(value.terminalId) &&
		isNonEmptyString(value.checkoutPath)
	);
}

function sameClaim(
	left: PrimaryWorkspaceClaim,
	right: PrimaryWorkspaceClaim,
): boolean {
	return (
		left.workspaceId === right.workspaceId &&
		left.repoKey === right.repoKey &&
		left.terminalId === right.terminalId &&
		left.checkoutPath === right.checkoutPath
	);
}

export function rememberOpenedPrimaryWorkspace(
	claim: PrimaryWorkspaceClaim,
): void {
	if (!isCompletePrimaryWorkspaceClaim(claim)) return;
	const claims = store().claims;
	if (claims.some((existing) => sameClaim(existing, claim))) return;
	claims.push({
		workspaceId: claim.workspaceId,
		repoKey: claim.repoKey,
		terminalId: claim.terminalId,
		checkoutPath: claim.checkoutPath,
	});
}

export function openedPrimaryWorkspaceClaims(): PrimaryWorkspaceClaim[] {
	return store()
		.claims.filter(isCompletePrimaryWorkspaceClaim)
		.map((claim) => ({ ...claim }));
}

export function forgetOpenedPrimaryWorkspaceClaims(
	released: readonly ReleasedPrimaryWorkspaceClaim[],
): void {
	if (!released.length) return;
	const claims = store().claims;
	store().claims = claims.filter(
		(claim) =>
			!released.some(
				(entry) =>
					entry.workspaceId === claim.workspaceId &&
					entry.repoKey === claim.repoKey &&
					entry.terminalId === claim.terminalId,
			),
	);
}

export function clearOpenedPrimaryWorkspaceClaims(): void {
	store().claims = [];
}
