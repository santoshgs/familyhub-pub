# Family Hub project instructions

## Scope and current phase

Family Hub is a fork of OpenFamily; since v1.0 it no longer tracks every upstream module (see `docs/familyhub/MODULES.md`). Extend existing code before replacing it. Phase 1 was accepted by the user on October 29, 2026. Phase 2 is authorized: local notes, authentication, server-enforced display permissions, privacy fixes, and deployment foundations. Phase 3 adapter/integration development was authorized October 29, 2026. Phase 2 prerequisites are complete and the app runs on the household's Raspberry Pi from versioned `familyhub-v*` releases with real household data (see `docs/familyhub/RELEASES.md`). Keep development and test data fictional.

## Development

- Existing stack: React/TypeScript/Vite/Tailwind/Radix frontend, Express/TypeScript backend, PostgreSQL, authenticated WebSockets, Docker Compose.
- Family Hub prototype code belongs in `client/src/familyhub/`; preserve normal OpenFamily behavior outside its opt-in mode.
- `npm ci` installs locked dependencies. `npm run dev:familyhub` starts the mock prototype; `npm run dev:familyhub:develop` serves the authenticated local stack at `/develop/`. `npm run build` checks the existing application; `npm run build:familyhub` checks the prototype build.
- Reuse existing components, fonts, and dependencies where appropriate. Keep fixtures separate from presentation and integration logic out of components.
- Test meaningful state transitions and important workflows. Inspect rendered phone/tablet/desktop layouts when browser tools work. Compilation does not establish visual quality.

## Privacy and permissions

- Use fictional names, dates, messages, and fixtures in code, tests, screenshots and docs. Never copy production credentials or family records into the repository.
- Never request secrets in chat or commit `.env`, tokens, database exports, or production data.
- Optional modules are closed on the server when switched off (`server/src/lib/modules.ts`); keep the client list in `client/src/familyhub/modules.ts` in step.
- Display access is server-enforced: ambient display tokens are read-only, limited to an endpoint allowlist, and bound to revocable display sessions. Keep the LAN display listener's allowlist (`deploy/familyhub/lan-display/Caddyfile.lan`) in step with that server allowlist.
- Google Calendar and Google Tasks remain authoritative when integrations are approved. Local copies must be clearly disposable caches.
- External clients (MCP servers, messaging bridges, scripts) discover the API through `GET /api/schema` and follow `docs/familyhub/AGENT_API.md`. Authentication stays in `server/src/middleware/auth.ts`: never add a shared-secret or environment-token bypass to a route file.
- The Raspberry Pi runs production. Change it only through committed scripts under `deploy/familyhub/` that the owner runs with the Pi password; never run sudo unattended or upgrade/reimage its OS without explicit owner approval. Record every host change in `docs/familyhub/DEPLOYMENT.md`.
- The photo frame is configured over ADB from the owner's Mac (`docs/familyhub/FRAME.md`). Make device changes only with owner approval; never flash or root-install anything. Keep addresses and MACs out of the repository.

## Git and upstream

- Upstream: `https://github.com/NexaFlowFrance/OpenFamily`; audited base: `a6fb4dc4ef0f2025cf4fabe3dc48e0f7c5f34f01`.
- Working branch: `develop` (preview locally with `npm run dev:familyhub:develop` at `http://127.0.0.1:5174/develop/`). `familyhub/prototype` is the default and release branch; changes reach it by pull request from `develop`. `upstream` points to OpenFamily. `origin` is the private `https://github.com/santoshgs/familyhub`; a `familyhub-v*` tag or the manual **Family Hub release** run publishes a release, and the Pi's hourly updater installs it.
- Family Hub is web-only. The upstream Android app, website, installers, packaging and upstream-only workflows were removed on November 4, 2026; keep them deleted when merging upstream.
- Preserve upstream Git history and license notices. Never push to upstream or force-push shared history.
- Preserve upstream `ROADMAP.md`; Family Hub milestones live in `docs/familyhub/ROADMAP.md`.
- Keep changes focused. Use separately namespaced `familyhub/…` migrations in future phases; never edit shipped upstream migrations.
- Removed in v1.0 and kept removed when merging upstream: Recipes, Meal planning, Family posts, the kiosk, Mealie/Tandoor/Grocy, Support OpenFamily, and languages other than English and French.
- `santoshgs/familyhub` (private) is the source of truth. `santoshgs/familyhub-pub` is a sanitized public copy with its own history, updated only through `scripts/public-export.sh` (`docs/familyhub/PUBLIC_SYNC.md`).

## Review gates

1. Phase 1 prototype and responsive visual review → user approval.
2. Local features, privacy/permissions, deployment foundation → user approval before Google access.
3. Calendar/Tasks → user validation before Gmail/Lillio work.

See `PRODUCT.md`, `ARCHITECTURE.md`, `UPSTREAM.md`, and `docs/familyhub/GETTING_STARTED.md`. Record limitations honestly: the user accepted Phase 1 testing; in-app browser checks ran, but native Safari automation timed out and physical iOS testing was not independently verified.
