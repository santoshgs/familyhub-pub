# OpenFamily upstream and private development

## Recorded baseline

- Upstream: <https://github.com/NexaFlowFrance/OpenFamily>
- Remote name: `upstream`
- Audited prototype base: `a6fb4dc4ef0f2025cf4fabe3dc48e0f7c5f34f01` (October 28, 2026)
- Latest stable at audit: v1.9.0, October 25, 2026
- Family Hub branches: `develop` (working) and `familyhub/prototype` (default and release)
- Private repository: `santoshgs/familyhub`

GitHub native forks of public repositories must remain public. A private Family Hub repository will therefore be a derivative that preserves upstream Git history and tracks the original remote, rather than a member of GitHub's fork network. This still supports merging upstream updates.

## Current changes

Phase 1 adds an opt-in fictional dashboard under `client/src/familyhub/`, corresponding development/build commands, and Family Hub documentation. No production integrations, OAuth, or database modifications are part of this phase. Retain OpenFamily's original `ROADMAP.md`; our roadmap is `docs/familyhub/ROADMAP.md`.

Since November 4, 2026 Family Hub is web-only: the Android (Capacitor) app, public website, Windows installer, CasaOS/Runtipi/Unraid packaging, Proxmox/update scripts, upstream-only GitHub workflows and translated READMEs/install guides were removed. Expect merge conflicts in those paths when updating from upstream and keep them deleted.

## Update procedure

1. Fetch `upstream` and review a specific release/tag against the recorded base.
2. Inspect release notes, security changes, dependencies, migration changes, and overlapping dashboard/kiosk/navigation work.
3. Merge the reviewed revision into a separate upgrade branch. Do not automatically follow moving `main` or force-push shared history.
4. Build normal OpenFamily and Family Hub modes; run relevant tests and responsive visual checks.
5. For future production upgrades, test migrations against a restored backup first. Reverting application code does not guarantee a database rollback.
6. Record the tested upstream commit, changes, and remaining conflicts here before deployment.

Likely overlap: dashboard/kiosk pages, navigation, widget identifiers/preferences, global tokens, route registration, and migrations. Isolated modules and separate migration namespaces reduce that overlap. Consider general bug/security fixes as separate upstream contributions; household-specific UI need not be proposed upstream.

## AGPL compliance

OpenFamily is AGPL-3.0-only; preserve `licence.md`, attribution, and required notices. Mark our modifications and maintain a prominent offer of the exact deployed modified version's Corresponding Source to network users, including household users. Private hosting/repository status is not an exemption from that offer. A public-to-everyone repository is not inherently required solely because a household uses the modified network application.

Include necessary source/build material in that offer; exclude credentials, family records, email content, database exports, and other private runtime data. Review new third-party code licenses and preserve their notices.

Sources: [GitHub fork visibility](https://docs.github.com/en/pull-requests/reference/forks), [upstream license](https://github.com/NexaFlowFrance/OpenFamily/blob/a6fb4dc4ef0f2025cf4fabe3dc48e0f7c5f34f01/licence.md).
