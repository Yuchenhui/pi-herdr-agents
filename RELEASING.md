# Release guide

## Yuchenhui fork: manual GitHub-only releases

This fork releases through <https://github.com/Yuchenhui/pi-herdr-agents> on the maintenance branch `release/yuchenhui-herdr-1`, not through npm. The npm name stays `pi-herdr-agents`; the original author, MIT license, dependencies, and upstream release history are preserved. Do not run `npm publish`, configure npm credentials, or use the inherited upstream release procedure for this fork. The earliest `detect` job in `.github/workflows/publish.yml` is guarded by `github.repository == 'giuseppecrj/pi-herdr-agents'`, so even future version bumps on fork `main` cannot start upstream npm publication. No fork CI or test trigger is added.

### Version and source provenance

The first fork version is `3.1.0-yuchenhui.1`, with tag `v3.1.0-yuchenhui.1`. Use `3.1.0-yuchenhui.N` for subsequent releases on this upstream basis, incrementing `N`; document any later upstream-basis change explicitly. These are fork identifiers, not claims that the upstream npm package contains the fork changes.

Source baseline: `e217f2a6a6635bdb1cb6d98fca287900199e09a7`, merging fork commit `4c991794acae0c160a1ef02a2ff88f25c2fec90d` with upstream `3.1.0` commit `0bb8bcdc328d152c5cab5eaaf4d261f109055ee4`. The release tag must identify the reviewed metadata commit on top of that baseline, not the source baseline itself. Preserve the Windows launcher and native CLI customizations; this release preparation does not modify runtime implementation.

### Manual release and pinned Windows deployment

The parent release owner performs these steps only after review; this checklist is not evidence that they have already run:

1. Review a clean maintenance checkout and record the full release commit SHA, source baseline, upstream basis, and validation limitations. Verify that a proposed tag does not already identify a different commit. Never move or reuse a release tag.
2. Preview contents with `npm pack --ignore-scripts --dry-run --json`. Require `README.md`, `CHANGELOG.md`, `AGENTS.md`, `docs/`, `config.json.example`, `examples/role-pack/`, `pi-extension/subagents/index.ts`, the extension helpers and `maestro/` runtime files, and only the host-owned `skills/pi-herdr-agents/SKILL.md`. Exclude bundled roles, plan/workflow skills and workers, private configuration, credentials, sessions, plans, journals, prototypes, generated evidence, test artifacts, and `openspec/`.
3. Separately create the real package with scripts disabled from that same reviewed checkout. Inspect the actual archive, compute its SHA-256 checksum, and retain the reviewed package and checksum as release assets. A dry-run preview is not a real archive or an independently verified asset checksum.
4. Perform only the separately authorized isolated offline-load check against the packaged extension. Record the exact Pi/Node versions and result. Do not run models, native CLI clients, regressions, tests, or integration as part of this bounded fork release. An offline load is not full runtime validation.
5. Push the reviewed maintenance commit to the own fork, create and push the annotated `v3.1.0-yuchenhui.1` tag at its full SHA, and manually create the GitHub Release in `Yuchenhui/pi-herdr-agents`. Include source provenance, tag and exact release SHA, reviewed package filename, SHA-256, changes, and validation limitations; attach the reviewed package and checksum. No npm publication is involved.
6. Deploy on native Windows only from the verified package or an exact-SHA pinned own-fork checkout. Record the pin and installed source; preserve local configuration, credentials, history, and active sessions. Do not deploy from a moving branch or silently replace the installed upstream source. Have the user fully exit and restart Pi, then distinguish installed-source verification from runtime validation.

Rollback source is the previously retained fork commit `4c991794acae0c160a1ef02a2ff88f25c2fec90d` (`4c99179`). Preserve access to that source and the previous installation pin before deployment. If rollback is needed, the parent restores the prior pinned installation without deleting user state or rewriting release tags, then fully exits and restarts Pi. Record the rollback pin and reason; do not claim rollback was exercised unless it was.

### Validation limits for this preparation

The metadata worker is authorized only for directed static manifest/workflow inspection, `git diff --check`, and the script-disabled dry-run content preview. It does not run tests, builds, installs, regressions, models, native CLI clients, or integration; it does not create a real package, perform offline loading, push, tag, publish, or deploy. Those separately authorized release-owner steps remain pending.

Prior source-sync evidence reported directed strict no-emit diagnostics decreasing from 65 to 63 with zero new diagnostics; LSP coverage was limited and retained one old `TS18048`. This is a historical baseline, not a fresh all-green check. Do not fix unrelated baseline errors here, treat unavailable JSON/YAML language analysis as clean, or imply full runtime validation from static inspection.

## Original upstream npm release process

The remainder documents the original `giuseppecrj/pi-herdr-agents` npm process only. Its npm-first GitHub Release rule and regression gates do not apply to this fork's bounded manual GitHub-only release above.

GitHub Actions publishes this package when the version in `package.json` changes on `main`. The release workflow reads the package name and version from `package.json`, validates the package, publishes to npm, creates a matching `vX.Y.Z` tag, and creates a GitHub Release with generated notes and a link to the npm package.

The published version must be unique on npm.

## Public versioning

`0.0.1` was a manual bootstrap publication that established the npm package. `0.0.2` is the first release published through the trusted GitHub Actions workflow; every later release uses trusted publishing.

`3.0.0` is the pack-neutral baseline. It is a major release because it removes the bundled roles, `/plan`, `/skill:orchestrate`, `/iterate`, `/btw`, and `/btw-close`, and makes `roles.bundled` a deprecated no-op. Its hand-written breaking changes and migration notes are in the README [Release notes](README.md#release-notes) section, because `npm version` regenerates `CHANGELOG.md` and would discard hand edits there. Record later breaking-release notes in the same section.

`3.1.0` is a compatible minor release. It adds the request-scoped task-model init events that let a loaded pack approve `/subagents-init` proposals; with no pack offering, the direct writer is unchanged. It was prepared from feature commit `1b6bacd0b5eecb6f83ffba1d5a5ee57a8b0fa944`. It is not published until the release workflow succeeds.

For original upstream npm releases, do not design a release that creates a GitHub Release without a successful npm publish for a new version. The workflow publishes first, then tags and creates the GitHub Release.

## Prerequisites

You need:

- Permission to manage this repository's GitHub Actions settings and npm package access for `pi-herdr-agents`
- A clean local `main` branch

Automated release gates (run by the workflow and required locally):

```bash
npm ci
npm run format:check
npm run lint
npm test
npm pack --dry-run
```

Manual deterministic Herdr integration (required before you push a release commit; not run in GitHub Actions):

```bash
npm run test:integration
```

Run that suite from inside Herdr. It uses real Pi and Herdr processes with the local deterministic provider, so it needs no provider credentials or network access.

The optional live-provider smoke test is not a release gate:

```bash
PI_TEST_MODEL="openai-codex/gpt-5.6-luna" PI_TEST_TIMEOUT=180000 npm run test:integration:live
```

Do not release from skipped Herdr tests. Confirm the package preview includes `README.md`, `CHANGELOG.md`, `AGENTS.md`, `docs/`, `config.json.example`, and `examples/role-pack/`, contains no `agents/` resources, no `skills/` resources other than the host-owned `skills/pi-herdr-agents/SKILL.md`, and no `pi-extension/subagents/plan-skill.md`, and excludes `pi-extension/subagents/workflow-worker.js`. Confirm it excludes plans, journals, sessions, prototypes, generated evidence, local `config.json` and `openspec/`, and that the worktree integration tests leave no test workspace behind. Durable user configuration is `$PI_CODING_AGENT_DIR/herdr-agents/config.json`; package-root configuration is ignored, so users must move an older file manually or re-run `/subagents-init`.

## npm authentication

### Steady state: trusted publishing (tokenless)

After the package exists on npm, steady-state releases use npm trusted publishing (OIDC). No long-lived `NPM_TOKEN` is required.

1. Open the package settings for `pi-herdr-agents` on [npmjs.com](https://www.npmjs.com/).
2. Add a trusted publisher for GitHub Actions with:
   - Organization or user: `giuseppecrj`
   - Repository: `pi-herdr-agents`
   - Workflow filename: `publish.yml`
   - Allowed action: `npm publish`
3. Confirm the release job has `permissions.id-token: write` and runs on a GitHub-hosted runner (already set in `.github/workflows/publish.yml`).
4. Confirm the workflow uses the exactly pinned Node `26.3.0`, whose bundled npm supports trusted publishing.
5. Publish stays tokenless: `npm publish --access public --provenance`.

When the repository secret `NPM_TOKEN` is absent, the publish step unsets `NODE_AUTH_TOKEN` and relies on OIDC. Once the package exists, the workflow fails if `NPM_TOKEN` is still configured, so steady-state releases cannot silently keep using the bootstrap credential. Manual dispatch runs only from `main`; other refs are rejected.

### Bootstrap history

The initial `0.0.1` publication established the npm package. Trusted publishing is now configured for `giuseppecrj/pi-herdr-agents` and `publish.yml`, so all later releases use OIDC only. Later version bumps use trusted publishing only. Do not add `NPM_TOKEN`: the workflow rejects it once the package exists.

## Publish a release

Choose the semantic version increment:

- `patch`: compatible bug fixes, such as `0.0.2` to `0.0.3`
- `minor`: compatible features, such as `0.0.2` to `0.1.0`
- `major`: breaking changes, such as `0.0.2` to `1.0.0`

Create the version commit without a local tag:

```bash
git fetch --tags --prune
npm version patch --no-git-tag-version
git add package.json package-lock.json CHANGELOG.md
git commit -m "chore: release v$(node -p \"require('./package.json').version\")"
git push origin main
```

The `npm version` hook regenerates `CHANGELOG.md` with `auto-changelog`. Use `npm run changelog` to regenerate it without changing the version.

Replace `patch` with `minor` or `major` when appropriate. The push triggers the **Release** workflow, which installs dependencies, runs lint and unit tests, previews package contents, publishes to npm with provenance, creates and pushes the version tag, and creates the GitHub Release.

You can rerun a failed or incomplete release from **Actions → Release → Run workflow**. If npm already has `PACKAGE_NAME@VERSION`, the workflow reads that version's `gitHead` and continues only when it matches `GITHUB_SHA` (exact-commit retry). A foreign publish fails before tag or GitHub Release creation. Existing tags are verified to point at the release commit. The workflow does not create a GitHub Release for a version that still needs publish and failed to publish.

## Verify the release

After the workflow succeeds, inspect the published package:

```bash
npm view pi-herdr-agents
```

Test installation through Pi:

```bash
pi install npm:pi-herdr-agents
```

The package should appear at <https://pi.dev/packages/pi-herdr-agents> after the gallery indexes the npm release.

## Troubleshooting

### Tag points to another commit

The workflow stops if the matching version tag already points to a different commit. Do not move or reuse release tags. Increment the package version and push a new release commit instead.

### npm rejects authentication

Confirm that the trusted publisher matches owner `giuseppecrj`, repository `pi-herdr-agents`, and workflow `publish.yml`, that the job has `id-token: write`, and that the runner is GitHub-hosted. If a release reports that `NPM_TOKEN` is bootstrap-only, remove the secret and use the trusted publisher.

### npm reports that the version already exists

If the published `gitHead` does not match this commit, the workflow fails before tagging. npm versions are immutable: increment the package version and push a new release commit. If it is a retry of the exact same commit, the workflow skips publish and continues with tag/release.

### Initial branch creation did not release

A clean repository's first push has `github.event.before` all zeroes. The workflow treats that as `release=false`. This package is already established on npm, so use tokenless trusted publishing for later releases.

### The package is absent from pi.dev

Confirm that npm published the package publicly and that `package.json` contains the `pi-package` keyword. Gallery indexing may take some time.
