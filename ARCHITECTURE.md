# Family Hub architecture

## Foundation

Family Hub preserves OpenFamily's React/TypeScript/Vite frontend, Express/TypeScript backend, PostgreSQL database, authentication, family-owner data scoping, authenticated WebSocket updates, and Docker Compose deployment. There is no second application backend or database.

The audited upstream base is `a6fb4dc4ef0f2025cf4fabe3dc48e0f7c5f34f01` (October 28, 2026), ahead of stable release v1.9.0. See `UPSTREAM.md` for update handling.

## Phase 1 prototype boundary

The opt-in Family Hub experience lives in `client/src/familyhub/`, selected with `VITE_FAMILYHUB=true` and `VITE_DEMO=true`. Root commands `dev:familyhub` and `build:familyhub` select this mode. Normal OpenFamily behavior remains available outside it.

Reuse existing UI libraries and self-hosted fonts. Keep fictional fixtures, data interfaces, and mock state separate from presentation. State resets when the browser reloads. No real accounts, external API calls, backend mutations, or production persistence are required for the prototype. A visual display toggle does not grant or restrict API permissions.

## Existing reuse points

- `client/src/pages/Dashboard.tsx` and `Kiosk.tsx`: existing dashboard and authenticated fullscreen display patterns.
- `client/src/components/ui/`: reusable UI primitives, including Radix-based dialogs.
- `client/src/components/app/FamilyNotes.tsx` and `server/src/routes/notes.ts`: existing notes UI and CRUD API.
- `client/src/demo/`: existing fictional demo infrastructure.
- `client/src/contexts/AuthContext.tsx`: identity, modules, and dashboard preferences.
- `server/src/services/integrations/`: existing server-side integration conventions.
- `server/src/migrations/runner.ts` and `registry.ts`: checksummed, transactional migrations with downstream namespaces.

## Authenticated local and Google integration design

External services → small server adapters → authenticated API → typed dashboard cards.

The opt-in authenticated mode uses `VITE_FAMILYHUB_LOCAL=true`, real OpenFamily login, and existing PostgreSQL notes CRUD/pinning. It remains separate from the fictional demo. Signed display tokens carry read-only scope enforced centrally by backend middleware; a client toggle cannot grant write access. The API service-worker cache was removed so private API responses are not reused offline across account changes.

Google Calendar remains authoritative, with reads and event creation in the selected shared calendar (updated user requirement October 29). Preserve time zone, all-day, and recurrence identity explicitly; do not copy Google events into independently editable local appointments. Google Tasks mutations reach Google, not a competing local task store. Parse Lillio emails deterministically and retain only necessary normalized text; Gmail message IDs provide deduplication. Classroom remains conditional on account and school permissions.

Reuse existing scheduling and WebSocket infrastructure where appropriate. Keep integration-specific errors, last successful synchronization, and stale-cache status explicit. Namespaced `familyhub/…` migrations extend existing notes and add Google connection/flow, settings, and snapshot tables; preserve shipped core migrations.

Google source is under `server/src/services/familyhub/google/`: OAuth connection management, Calendar/Tasks adapters, runtime/cache behavior, and deterministic daycare parsing. Authenticated Family Hub routes mediate browser access. New connection/settings migrations live in `server/src/migrations/familyhub/`. Integration code and UI wiring are implemented and locally tested; actual Google consent and representative live-email validation remain outstanding.

Calendar/Tasks snapshots have a 60-second freshness window; daycare has a
five-minute window. A minute scheduler refreshes connected households and browser
reads reuse fresh snapshots. Failed sources retain their last successful payload
with a stale label while other sources continue. A database revision and ordered
row locks prevent older in-flight reads from restoring data after source changes,
writes, scope changes, or disconnection. No local task/appointment rows are made
by Family Hub Google actions, including AI actions launched from Settings.

## Production prerequisites

- Validate the signed display-session scope on every new Google route. Existing kiosk/child behavior is not a substitute for that scope.
- Ensure existing tabs receive the updated service worker and that API no-store behavior holds in the deployed browser.
- Google tokens/flow secrets use a separate base64 32-byte `FAMILYHUB_TOKEN_KEY`, independent of `JWT_SECRET`, with authenticated encryption. Back up the key securely; changing it requires deliberate recovery/reconnection. Upstream integrations may still use their original signing-secret-derived encryption.
- Explicit household time zone (initial recommendation: `America/New_York`), plus DST, all-day, and recurrence tests.
- Supported 64-bit Pi OS, frontend-only network exposure, HTTPS, backups including uploads/configuration, and tested restore.

Build/type checks establish code validity. Browser visual QA, iOS Safari behavior, server integration behavior, and Pi capacity are distinct checks; none should be inferred from a successful frontend build.

## Shared Google connection contract

Calendar, Tasks and Gmail use the same household-owned Google connection, not
the current browser's unrelated Google session. Validate the configured account
identity during OAuth and bind stored credentials to its verified Google subject.
Use optional incremental Gmail consent; daycare code is authorized now, while actual mailbox consent remains a distinct user action.
Both the task card and existing AI action execution must call the Google Tasks
adapter. The daycare adapter queries `from:no-reply@himama.com`, validates sender
headers, and normalizes available activities and parent messages as untrusted
text. Sender filtering limits processing; Gmail OAuth read permission is not
restricted to that sender. Link-only notifications retain an approved provider
link and an honest lack-of-details state. No attachment/photos are needed, and
no email/child content is sent to external AI by default.

The OAuth web client uses state, nonce, PKCE, and a server callback. Expected
dedicated email is server configuration; the verified Google subject and email
bind the connection to the household. Secrets remain server-only in ignored
local configuration or deployment environment variables. Parent accounts manage
connection/source settings; tablet credentials do not authorize mutations.

For local configuration and live acceptance checks, see
`docs/familyhub/GOOGLE_SETUP.md`. Unit/mock and local PostgreSQL tests do not
establish live Google compatibility or represent actual Lillio email formats.
