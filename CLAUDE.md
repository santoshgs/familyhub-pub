# Family Hub

Read `AGENTS.md` for the shared project constraints and phase gates, then
`docs/familyhub/STATE.md` for where work stands. Before compacting or ending a
long session, run the `handoff` skill so the next session can pick up.

## Agents

Delegate to the project agents in `.claude/agents/`. They run on cheaper models
(Haiku for read-only checks and docs, Sonnet for changes) and keep their own
notes in `.claude/agent-memory/` (git-ignored):
`github-release` (Git/GitHub, PRs, release prep), `verifier` (builds, tests,
migration simulation), `pi-status` (read-only Pi health), `pi-ops` (Pi scripts the
owner runs), `frame-adb` (photo frame), `docs-keeper` (STATE.md, release notes,
knowledge base), `public-sync` (sanitized copy in `santoshgs/familyhub-pub`).
Publishing steps (merging to `familyhub/prototype`, tags, releases, pushing to
the public repo, changing the frame) stay with the owner; `.claude/settings.json`
asks before them and blocks force pushes and sudo.

Family Hub is a personal, self-hosted fork of OpenFamily; since v1.0 it is its own product (unused OpenFamily modules removed, English and French only). Phase 1 was accepted by the user on October 29, 2026. Phase 2 is approved: implement local persistence using existing notes/authentication, display permissions, privacy fixes, tests, and deployment foundations. Phase 3 Google Calendar/Tasks development is authorized and the app runs on the household Pi from `familyhub-v*` releases. Keep development data fictional. Change the Pi only through committed scripts the owner runs with sudo, and the photo frame only over ADB with owner approval (see `AGENTS.md`, `docs/familyhub/DEPLOYMENT.md`, `docs/familyhub/FRAME.md`).

## Useful commands

```sh
npm ci
npm run dev:familyhub
npm run dev:familyhub:develop   # authenticated local stack at http://127.0.0.1:5174/develop/
npm run build
npm run build:familyhub
```

The prototype uses `VITE_FAMILYHUB=true` and `VITE_DEMO=true`, existing React/Vite infrastructure, self-hosted fonts, and an isolated `client/src/familyhub/` module. State resets on reload. Keep fixtures and state transitions separate from UI.

Google Calendar and Google Tasks will remain authoritative. Reuse existing OpenFamily notes, authentication, family ownership, API, database, and deployment conventions. Display access is server-enforced through read-only, revocable display sessions; photo frames pair with one-time codes (`docs/familyhub/AMBIENT_DISPLAY.md`).

Preserve original code history and AGPL notices. Work on `develop` and merge to `familyhub/prototype` (the release branch) by pull request; `upstream` is OpenFamily. `origin` is the private `santoshgs/familyhub` repository. Never commit secrets or household records. Preserve upstream `ROADMAP.md`; use `docs/familyhub/ROADMAP.md` for our milestones.

Validate actual rendered layouts before describing the UI as polished. In-app visual checks ran on October 29; native Safari automation timed out. The user accepted Phase 1 testing and approved Phase 2. Do not claim independent physical iOS verification.
