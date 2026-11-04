# Family Hub roadmap

This is the Family Hub customization roadmap. The root `ROADMAP.md` belongs to upstream OpenFamily and is preserved.

## Latest checkpoint — October 29, 2026

Predeployment scope correction: Budget/Pocket money pages are restored to Family
Hub navigation. Other OpenFamily modules are available via parent Settings and
default off; preferences persist per household without changing upstream mode.
Calendar supports month/week/day browsing of the selected Google calendar instead
of only a seven-day list. See `MODULES.md` for semantics and current limitations.

Autonomous readiness increment: 136 backend tests, 10 frontend tests and four
built-worker privacy tests passed; authenticated build passed. Live read-only
smoke checks passed for `/health`, `/ready`, and unauthenticated/no-store notes,
Family Hub and AI endpoints. A private backup of the active local database was
created. The separate HTTPS Compose stack and recovery/device runbook are in
`DEPLOYMENT.md`; Docker/Caddy/nginx runtime checks remain unperformed because
those runtimes are unavailable on the Mac. Browser control reported
`browser.user is unavailable`, blocking fresh live UI checks in this session.
Physical iOS devices and a supported Pi OS are needed for the remaining
environment-specific checks. Gemini stays deferred.

Google setup has progressed beyond the historical setup notes below: the owner
connected the account and reported that Calendar/Tasks checked out. Independent
end-to-end acceptance of all live mutations, native-app round trips, revocation,
and timezone cases remains pending. Daycare fixture simulation passed; real
daycare email acceptance remains pending.

The owner deferred Gemini troubleshooting after Google restriction errors and
provider availability failures. Provider inference is not accepted as working;
do not treat the earlier timeout disappearing on a retry as proof of a fix.

Local backup tooling and a fictional PostgreSQL restore drill are now complete.
The drill verified record preservation, source isolation, private permissions,
and checksum rejection. See `BACKUP_RESTORE.md`. Full encrypted off-machine
recovery, uploads/configuration recovery, production cutover, deployed-worker
verification, physical iOS Safari, and Docker/ARM64/Pi deployment remain pending.

## Current state

Phase 0 source audit is complete and Phase 1 was accepted October 29, 2026. The user authorized Phase 2, Google Calendar/Tasks integration, and daycare Gmail development. Development uses fictional fixtures and an isolated local database. Actual Google consent, source selection, and live-data verification are outstanding user setup/acceptance steps. Production Pi deployment is not complete or authorized by these local implementation steps.

OpenFamily's audited base is `a6fb4dc4ef0f2025cf4fabe3dc48e0f7c5f34f01`; work remains on `familyhub/prototype` with the original `upstream` remote. Preserve upstream history, notices, and the root roadmap.

## Phase 1 — fictional interactive prototype (accepted October 29, 2026)

Implemented locally: five cards, calendar day/week navigation and event details,
task create/edit/complete/reopen/delete, notes create/edit/pin/delete, daycare
timeline, Classroom detail preview, card visibility, display layout preview,
and simulated loading/error/empty states. Fixtures and the mock service are
separate from presentation; changes reset on reload.

Validation: normal shared/server/client build passed; prototype build passed;
six mock-service tests passed; public-safety and whitespace checks passed. A
static review led to stronger text contrast, larger essential labels, hash-router
safe skip navigation, preserved note authors, and dialog focus restoration.
The prototype targets Safari 15.4+ for bundling, with viewport/safe-area fallbacks;
this is not evidence of an actual Safari device test. The local Vite preview
responded over HTTP. These are historical Phase 1 checks; later backend checks
are recorded separately below.

The user confirmed testing/validation complete and approved Phase 2 on October 29, 2026. Independent in-app inspection verified phone/tablet/desktop rendering, task creation/completion, note editing, and daycare details. Native Safari inspection timed out; physical iOS testing was not independently verified. The display toggle demonstrates presentation only, not protected read-only access.

**Approval gate satisfied:** the user accepted the prototype and authorized Phase 2.

## Phase 2 — local features and foundation (authorized, in progress)

First increment: service worker no longer caches API responses or serves private
cached data offline; activation removes old API caches. API fetches and server
responses use no-store. Four worker regression tests pass. This intentionally
removes offline household-data browsing while retaining offline app assets.
Existing open tabs must receive the new worker before the policy takes effect.

Implemented locally: persistent Family Hub notes through existing OpenFamily
identity and CRUD API, pinning/author migration, and signed display-session tokens
whose read-only restriction is enforced by backend middleware. The fictional
dashboard stays separate. PostgreSQL 16 was installed for an isolated localhost
cluster under ignored `.familyhub-local/`; development and disposable test
databases are separate. At this increment, ten new persistence/authorization tests
and the full 90-test backend suite passed; the local-mode build passed. These
counts describe that increment, not the final Google integration test total.

Authenticated notes/display and disconnected Google controls have been inspected in the in-app browser. Remaining: deployed-worker/cache verification; deployment, backup/restore, and physical device checks. Existing open tabs must receive the updated worker before
the private-cache policy takes effect. Keep test fixtures fictional until the
permission/privacy prerequisites and user account setup are ready.

**Google development approval received:** no additional phase approval is needed
to implement the authorized Calendar/Tasks/daycare features. Real Google consent
still belongs to the account owner.

## Phase 3 — Google Calendar and Tasks (authorized October 29, in progress)

User authorized Phase 3. Phase 2 remains incomplete; this authorization permits
adapter development but does not establish production readiness.

Calendar/Tasks adapters use injected transport/token providers, bounded pagination,
recurring-instance/date-only event preservation, hidden completion retrieval,
sanitized errors, timeouts, and no automatic mutation retries. Mock tests require
no credentials. OAuth connection code, separate token encryption, namespaced connection/settings/cache migrations, authenticated routes, synchronization, and the connected dashboard are implemented and locally tested.

Required behavior: one verified dedicated Google account; selected shared calendar
read/create; Google Tasks create/edit/complete/reopen/delete; explicit source,
freshness, stale-cache, and reconnect states. Card controls and reviewed AI task
actions must reach the same Google Tasks service. No competing local tasks or
appointments should be created. Dedicated-account switching in native Google
Tasks is accepted.

Pending live acceptance: user Cloud project/client setup and consent; correct
account/source selection; actual Calendar/Tasks reads and disposable writes;
native Google app round trips; refresh/revocation and timezone/DST behavior.
Passing mock or local PostgreSQL tests does not complete those checks. Follow
`docs/familyhub/GOOGLE_SETUP.md`; record final current-increment test results only
after the implementation and checks finish.

## Phase 4 — Lillio through Gmail (development authorized, in progress)

Read daycare emails from `no-reply@himama.com` in the same verified family Google
account after optional Gmail consent. Deterministic MIME/text parsing supports
activities (including feeding/milk) and parent messages when present. Cache by
message ID, validate the sender, ignore attachments/photos, display untrusted
content as text, and use a notification/link fallback when details are absent.
No daycare/child content is sent to external AI by default.

Parser/runtime integration and fixture tests are complete for the current Google dashboard increment. Representative real Lillio email formats, mailbox authorization,
duplicate/malformed behavior against those formats, and actual displayed activity
versus parent-message content remain unverified. Gmail read access is restricted
and mailbox-wide; personal-use verification exceptions and Testing's seven-day
token lifetime must be addressed for the actual deployment. There is no extra
code-development gate before this already-authorized daycare work.

## Phase 5 — Raspberry Pi production

The Pi was reimaged to Raspberry Pi OS Lite 64-bit (Debian 13). The private
`familyhub-v0.1.0` release is installed with digest-pinned ARM64 images, private
Tailscale Serve HTTPS, pre-update backups, application rollback, and an hourly
jittered update timer. Pi address and recovery details are recorded in
`RELEASES.md`; the DHCP address may change. The user authorized new releases and
updates to this installation. The next update is `familyhub-v0.2.0`.

## Phase 6 — separately prioritized enhancements

Live Classroom subject to permission feasibility; weather/Bitcoin/home automation; card personalization; e-ink rendering. Each requires explicit scope agreement.

## Verification record to finish this increment

- Re-run relevant builds and tests after Google/backend/UI integration; distinguish
  fixture/unit tests, local PostgreSQL tests, browser checks, and real-provider checks.
- Inspect authenticated notes, parent Google settings, task/event mutations, daycare
  states, and a restricted tablet session in the rendered interface.
- Have the user complete dedicated-account Google consent locally, without sharing
  secrets, and record live Calendar/Tasks/Gmail results separately.
- Retain AGPL attribution and the exact-version source offer for any network
  deployment; exclude credentials, database records, and email content.
- Keep physical iOS Safari and Pi deployment explicitly pending until tested.

## Local implementation verification — October 29, 2026

The final backend run passed 128 tests, frontend passed 10 tests, and the service worker passed four tests. Normal, authenticated Family Hub, and fictional prototype builds passed. The in-app browser verified disconnected Google setup, phone/desktop layout, persistent authenticated note edits, and protected display controls. See `QA.md` for evidence and limits.

The account owner confirmed that the dedicated Google account exists and Cloud setup is still needed. A private `.familyhub-local/google.env` template and encryption key are prepared locally. Next: complete the Cloud web-client setup, fill the three blank local configuration fields, restart the authenticated app, finish consent, and choose the shared calendar/task list. Follow `GOOGLE_SETUP.md` and perform Calendar/Tasks live acceptance before optional Gmail acceptance. No real Google data was accessed, no GitHub push occurred, and the Pi was not changed.

## Ambient Display and management navigation — November 2, 2026

Implemented the dedicated `/display` ambient client and `/display-settings`
parent configuration in the existing FamilyHub app. The app-style navigation
now keeps Home, Calendar, To-dos and enabled Budget in the primary row; other
modules sit in More. The shared AI magic-input dialog now adjusts to the iOS
visual viewport while the keyboard is open. The original OpenFamily `/kiosk`
remains separate.

The display reads a minimal server-built snapshot from the existing Google
Calendar/Tasks runtime, OpenFamily reward chores and cached daycare summaries.
Weather is fetched from Open-Meteo for a parent-selected household location;
Formula 1 sessions come from Jolpica F1 and render in the household time zone.
No new secrets or provider keys are required. Display token requests are
server-enforced read-only, settings and location search are parent-only, and
the daycare card receives summaries rather than full email bodies. The additive
`familyhub_ambient_settings` migration is backward-compatible. See
`AMBIENT_DISPLAY.md` for setup, API paths, source links, cache behavior and
device limitations.

The FamilyHub frontend suite passed (16 tests), isolated local PostgreSQL
backend suite passed (23 tests), and `npm run build:familyhub:local` passed.
Physical Frameo 105K and iPhone keyboard validation remain outstanding. The X
post was not accessible during this work; the supplied dark, high-contrast card
direction was used. The hardware model label is not sufficient to infer Android
version/board; no OS or APK changes were made.

`familyhub-v0.2.0` is published and installed on the Raspberry Pi by the
existing digest-pinned updater. GitHub validation and packaged-container smoke
checks passed; the updater reported the new version, and post-update `/health`
returned `ok`. The Mac joined the Pi's tailnet during rollout. See `RELEASES.md`
for the record. Authenticated screen review, physical Frameo 105K behavior and
iPhone keyboard validation remain open.

## Ambient display visual update — November 2, 2026

The `/display` dashboard now uses a layered navy gradient, custom weather
illustration, and a larger F1 panel. It emphasizes the next scheduled session
and puts subsequent practice, qualifying, sprint, and race sessions in time
capsules along the bottom. The Scuderia Ferrari card uses a credited shield
photograph and explicit team wordmark. The display remains connected to the
same source APIs and account data.

Google Photos is a feasible future widget through Google's Ambient API, which
lets the account holder choose display sources in the Photos app. Google
currently requires program acceptance before granting API access, so no OAuth,
tokens, Photos widget, or fictitious photo data was added. See
`AMBIENT_DISPLAY.md` for the integration limitation and source links.

## Photo frame pairing and display fixes — v0.3.1, November 2, 2026

Delivered:

- **Frame pairing.** Parents create an 8-digit, 5-minute, single-use code in
  Display setup; the frame enters it on its pairing screen and receives a
  read-only token bound to its own display session. No password is typed on the
  frame, and a signed-out frame always returns to the pairing screen.
- **Revocable displays.** Display setup lists paired displays with last-seen
  times; **Remove** signs out one frame immediately.
- **Display.** Calendar (7 days), To-dos and Daycare open detail panels; a
  parent-configured night-dimming schedule with tap-to-wake; the dashboard fits
  exactly one 1280 × 800 screen; larger minimum type; token renewal on every
  load (fixes weekly sign-outs on frames that reload or sleep).
- **Pi LAN listener.** One rerunnable script with a Let's Encrypt certificate for
  a public name that points at the Pi's LAN address, so the frame uses normal
  DNS. The firewall now allows SSH from the home network and covers Ethernet;
  unknown pages redirect to the display.
- **Frame setup.** Found that the frame's home screen is the HomeHQ kiosk and
  that its URL had never been saved; set it, made HomeHQ the permanent home app,
  and restored the Frameo app (for brightness and sleep settings) without letting
  it start at boot. See `FRAME.md`.

Next:

- Long-duration burn-in on the frame (overnight dimming, Wi-Fi drops, Pi
  restarts, a week without a re-pair).
- Physical iPhone/iPad acceptance, unchanged from earlier milestones.
- Optional: a Google Photos card if Ambient API partner access is granted.

v0.3.2 (same day) restores a way out of display mode: v0.3.1 removed the
frame's sign-out button, which also left management browsers that had been put
into display mode with no exit. Displays now have a 2-second **Hold to exit**.

v0.3.3 (same day): **Chores** is a top-level page (no longer behind Pocket
money) and the display shows every chore due today; the management navigation
shows as many tabs as fit and overflows the rest into **More**; the display's
cards show "+N more" indicators and day labels; detail panels open faster on
the frame (no full-screen blur); household-supplied F1 and team logo images
are supported from `client/public/assets/familyhub-brand/`.

v0.3.4 (same day): opt-in **News** card (BBC World and Technology, 10
headlines, server-side reader view); tomorrow's forecast on the Weather card;
a baby icon for Daycare; the bottom row shares its width between whichever of
To-dos, Chores, News and Daycare are enabled; a **Your name** field at the top
of Settings (the display greeting uses it); cropped household-supplied F1 and
team logos. The LAN listener gains `GET /api/familyhub/ambient/article`, so
rerun the Pi apply script after this release.
