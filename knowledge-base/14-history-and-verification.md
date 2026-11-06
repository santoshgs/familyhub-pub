# Project history and verification

[Knowledge base index](README.md) · [Overview](01-overview.md) · [Architecture](12-development-architecture.md)

This page distinguishes historical implementation evidence from owner acceptance and remaining work. It is a checkpoint, not a claim that every feature is fully tested in production.

## Timeline

### Audit and fictional prototype

The project audited OpenFamily at upstream commit `a6fb4dc4ef0f2025cf4fabe3dc48e0f7c5f34f01` and built an opt-in fictional Family Hub dashboard. Independent in-app browser review covered representative desktop, tablet and phone layouts and fictional task, note and daycare interactions. Native Safari automation timed out. The owner accepted Phase 1 and its testing on October 29, 2026; mock state resets on reload and is not real household data.

### Authenticated foundation and Google work

Local notes, backend-enforced display scope and private-cache protections were implemented. Google OAuth, Calendar/Tasks adapters, optional daycare Gmail processing, source settings, snapshots and AI proposal routing were added with namespaced migrations. Backend, frontend, service-worker and build checks passed at multiple increments; exact historical counts and scope are in [QA.md](../docs/familyhub/QA.md) (screenshots archived in Git history at `familyhub-v0.3.6`). Mock tests do not establish provider behavior.

The owner completed Google setup and confirmed Calendar/Tasks during development. A mixed fictional Gmail simulation covered feeding, nap, parent message, link-only fallback, duplicates, sender filtering and safe rendering. Representative real daycare emails and mailbox behavior are not yet accepted.

### Requested feature and interface changes

The OpenFamily AI settings and review flow were surfaced; notes gained direct creation/navigation; Google event colors were retained. The full selected-calendar month/week/day interface, Budget, Pocket money and optional modules were restored or added. Dark/system/light appearance, household color legend and per-user card ordering were implemented. Tests and fictional browser checks are documented in [MODULES.md](../docs/familyhub/MODULES.md) and [QA.md](../docs/familyhub/QA.md). Gemini inference was not validated and was deferred.

### Release and Pi deployment

The private `familyhub-v0.1.0` release built ARM64/AMD64 images and passed CI packaged-stack checks on AMD64. The owner approved erasing the original Pi card, without requiring a full disk backup; a supported 64-bit Raspberry Pi OS was freshly imaged. The new SSH host fingerprint was verified at the local Pi console. Docker, Compose and Tailscale were installed, the owner authorized Tailscale and private HTTPS, and the database and original encryption keys were migrated after stopping the Mac backend.

The Pi runs the ARM64 images; client, server and PostgreSQL containers passed health checks. HTTPS returned 200 and an unauthenticated Family Hub API request returned 401. A the DNS resolver DNS conflict was identified during Safari access. The owner signed into the Pi-hosted app, updated the Family Hub credentials, registered the Pi Google callback, and confirmed Google Calendar and To-Dos appear.

### Recovery and update checks

A fresh Pi backup was restored into an isolated temporary database and selected account, notes and Google-connection counts matched; the temporary database was removed. The uploads archive was readable. GitHub release listing and download succeeded with a repository-limited token; the update tool and a systemd service check reported the installed release current. The hourly timer was enabled. Release-tool unit tests cover simulated failure and rollback behavior.

### Photo frame and display (November 2, 2026)

The ambient display shipped in v0.2.0–v0.3.0. Putting it on the photo frame surfaced several issues, fixed in v0.3.1–v0.3.5: the frame's kiosk had never saved its URL (it showed its own sample page); Android preferred the router's IPv6 DNS over the Pi; signing out on the frame dead-ended at a blocked login. The frame now uses a public name pointing at the Pi's LAN address with a Let's Encrypt certificate, pairs with one-time codes, and returned to the dashboard after `adb reboot` (owner-confirmed). The Pi's firewall allows SSH from the home network. Server tests (159) and FamilyHub client tests (16) passed for v0.3.5; screens were checked in a browser at 1280 × 800 with fictional data. The renewal check found the GitHub release token due on November 29; both GitHub tokens were replaced with non-expiring ones.

### Security patch, cleanup and develop branch (November 4, 2026)

A `develop` branch and a Mac preview at `/develop/` were added so patches are tried before release. Dependabot (glob, minimatch, deepmerge) and Snyk (dependency and Snyk Code) findings were triaged: glob, minimatch and ejs were patched through overrides; three Snyk Code findings were fixed, including a malformed integration request that caused an unhandled rejection (reproduced by a new test on the old code); `braces` and `deepmerge` were accepted in `client/.snyk`. Published as **v0.3.6** (Actions run 41781123074).

The repository was then reduced from 697 files (17.9 MB) to about 506 (10 MB): one-off scripts, the phase QA screenshots and harness, the OpenFamily website, installers and packaging, upstream-only workflows and the Android app were removed, and CORS was narrowed. The app version now appears in the display and management footers. Published as **v0.3.7** (run 41785055085). Evidence: all release validation steps passed in a clean checkout (163 server, 16 client, 4 service-worker and the release-tool tests); the v0.3.7 commit was run with fictional data and its display rendered at 1280 × 800 without overflow or page errors, footer "Family Hub v0.3.7". Installation of v0.3.6/v0.3.7 on the Pi and the frame was not observed from the development session.

### Own fork, security release and dashboard extras (November 4–5, 2026)

**v1.0.0 (November 4)** removed the OpenFamily modules and languages Family Hub does not use, made module switches server-enforced, and added sign in with Google and ntfy alerts. Its migration `familyhub/0009` drops the removed modules' tables; the upgrade from a v0.3.7 database and an app rollback to v0.3.7 were run locally with fictional data. 172 server tests passed, and the rendered navigation, overview and Settings → Modules were checked at 1280 px and 390 px.

A Claude Security scan that day verified 33 findings in `server/` and `deploy/` (1 high, 17 medium, 15 low). On November 5 all 33 were re-checked against `develop` and fixed in six themed commits, then shipped as **v1.1.0**; the upgrade from v1.0.0, a restart and an app rollback to v1.0.0 were simulated locally with fictional data. The owner confirmed on the Pi that the image digests matched the release manifest, set `FAMILYHUB_ADMIN_EMAIL` and reinstalled the admin helpers. See [security](13-security-privacy.md).

**v1.2.0 (November 5)** added the frame's quick bar and detail panels, Settings → Display and Settings → Advanced → Software updates. The release run passed, including 218 server tests on PostgreSQL 16, and the updates panel was rendered at 390 px and 1280 px with fictional data without overflow or page errors. Two Pi tools were added along the way: a hardened `update-github-tokens.sh` (v1.1.0 had missed it) and `remove-account.sh`, tested against a local database for a dry run, a refusal, a confirmed removal and a re-run. The owner then reinstalled the helpers, `release.py`, the update service and `notify.sh`, re-applied the LAN listener, removed a leftover review login and confirmed that v1.2.0 is running and Software updates reports up to date. v1.2 has not yet been tested on the physical frame.

## Remaining acceptance and operational work

- Verify representative live daycare messages after appropriate Gmail consent; no child content should be shared for the test.
- Exercise safe disposable Calendar/Tasks writes and native-app round trips, all-day/DST behavior, stale-cache recovery and OAuth expiry/reconnection.
- Upgrades across several releases have run on the Pi; a deliberate rollback has not. Database and Google writes are not automatically undone.
- Check v1.2 on the physical frame (quick bar, panels, photos, footer version) over ADB with owner approval, and recheck sign-in, invitations and the calendar after the v1.0 module removal.
- Run a diff-mode security scan from `252e83c` covering what the first scan did not (`client/`, `scripts/`, `shared/`, sign in with Google, the ntfy scripts, the module guard and the v1.2 code).
- Diagnose and set up sign in with Google and ntfy on the Pi; neither is verified working.
- Deferred hardening from the scan: non-root server container, Express 5, per-member hashed calendar feed tokens, ICS parsing in a worker thread, re-authentication before linking a new identity.
- Overnight burn-in of the frame (night dimming, Wi-Fi drops, Pi restarts, a week without re-pairing) and the news reader against live BBC pages.
- Keep encrypted off-device backups and exercise a complete recovery, including uploads, keys, application version and network setup.
- Resolve Gemini/provider issues when prioritized; no successful inference is recorded.
- Disable Tailscale key expiry for the Pi (2027-04-27). Update failures are not pushed to a phone; renewal warnings can be via ntfy.
- Classroom remains a placeholder. Full deployed service-worker behavior and exhaustive iOS interactions have not been independently certified.

Historical docs may say the Pi was not yet deployed or an approval was pending; those statements describe earlier checkpoints. Refer to [releases](09-releases-updates.md) and this page for later deployment evidence.
