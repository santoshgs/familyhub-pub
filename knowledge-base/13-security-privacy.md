# Security and privacy

[Knowledge base index](README.md) · [Accounts](03-accounts-and-access.md) · [Recovery](10-backup-recovery.md)

## Access boundaries

- The Pi application is reachable through the household's private Tailscale network and HTTPS. The client binds on the Pi to loopback; the server and database are not published as host ports. Tailscale membership is not a substitute for Family Hub sign-in.
- Parent, child/member and read-only display permissions are enforced by the backend. A prototype display toggle or hidden module is not an authorization boundary.
- API responses use no-store behavior and the service worker does not keep a private API cache for offline reuse. Test existing browser tabs after worker updates.
- CORS allows only the origins in `CORS_ORIGINS`. Until v0.3.7 the server also always allowed `http://localhost`, `https://localhost` and `capacitor://localhost` for the Android app; that was removed with the app.
- Docker administrator access is effectively host administrator access. The updater runs as root and its environment and credentials must stay root-protected.
- The photo frame reaches only a display listener on the home network: an allowlist of display pages, assets and display API calls, HTTPS accepted only from the frame's reserved address, everything else 404 or redirected to the display. Displays hold read-only tokens bound to revocable sessions; the server enforces the same allowlist. Pairing codes are hashed, single-use, five-minute and rate limited.
- Server credentials submitted in Settings → Advanced (server administrator only) are written to a 0600 file in a bind-mounted exchange folder and applied by a root-only systemd unit that tests, installs and deletes them. FamilyHub never stores, logs or returns them; the container cannot read installed credentials. Since v1.1 the root helpers never follow a path the container could have planted (symlinks are refused, files are opened through descriptors, results live in the root-only `/opt/familyhub/admin-state`) and keep tokens off `curl`'s command line.
- Module switches are enforced by the server (v1.0): a module that is off answers 403 `MODULE_DISABLED`. The per-person **Show** setting only hides a module for that person.
- Access ends with membership (v1.1): leaving or removal replaces the shared calendar feed link and deletes the member's push subscriptions; joining a family ends older sessions; a child cannot multiply or reverse chore points; a parent's data import changes only their own preferences.
- Outbound requests (v1.1): saved integration and AI keys are sent only to the address they were saved for and are cleared when that address changes; private, special, IPv4-mapped and NAT64 addresses are blocked; DNS rebinding is blocked by connecting to the vetted address; push endpoints must be real push services.
- Reset and invite links need a trusted host (`APP_PUBLIC_URL`); login timing no longer reveals whether an account exists; the calendar feed token is redacted from logs.

## Secrets and private records

Keep `.familyhub-local/`, `.env` files, SSH private keys, Google OAuth secrets/tokens, GitHub tokens, databases, backups, family records and daycare emails out of Git, issue reports, screenshots and chat. Do not put a password or token in a command argument, shell history, build-time frontend variable or public URL.

`JWT_SECRET` protects authentication and also encrypts upstream AI credentials and, since v1.2, the display's guest Wi-Fi password and market API keys. `FAMILYHUB_TOKEN_KEY` separately protects saved Google credentials. Back up the original keys securely with the database and matching configuration; changing a key can make stored credentials unreadable. The Pi backup archives have restrictive permissions but are not encrypted; use encrypted storage for copies away from the device.

The GitHub image token is a classic token limited to `read:packages`. The separate release token is fine-grained to the project repository with Contents read permission. Both are set to never expire, which trades rotation for reliability; replace them if they may have leaked, and keep them root-only on the Pi. A previous attempt to transfer the Mac's broad GitHub credential to the Pi was blocked; the narrower Pi-specific credentials were used instead.

## Dependency and code scanning

- **Dependabot** watches `package-lock.json` on GitHub. Alerts close only when the fix reaches the default branch (`familyhub/prototype`).
- **Snyk** runs from the Mac through the Snyk tools in the Claude desktop app: a dependency scan and Snyk Code (source analysis, enabled November 4, 2026). The Snyk token lives in the app's settings; never paste it into chat.
- Patched transitive versions are pinned with root `overrides` in `package.json` (for example `glob` and `ejs`, added in v0.3.6). npm's suggested `audit fix --force` would *downgrade* `vite-plugin-pwa`; do not use it.
- [`client/.snyk`](../client/.snyk) accepts two build-only findings with no patched release, each expiring on 2027-02-04 so Snyk raises them again: `braces` (via Tailwind 3; the only fix, Tailwind 4, needs Chrome 111+/Safari 16.4+ and would break the frame's WebView 107 and Safari 15.4) and `deepmerge` (via the PWA/Workbox build). Dependabot alert #1 is the same `deepmerge` issue.
- The first Snyk Code scan reported 95 findings. Three were fixed in v0.3.6 (integration request type checks — a malformed field could crash the server; the Immich photo proxy now re-serves only image types; the native server URL check, later removed with the app). The rest were reviewed as false positives or by design: parameterized SQL, SSRF guard with per-redirect checks and metadata blocking, allowlisted file names, test fixtures. Snyk Code ignores can only be recorded in the Snyk web app, so local scans keep listing them.
- **Claude Security** (the `/claude-security` plugin in Claude Code) ran once, on November 4, 2026. It needs the Workflow tool, so enable *Dynamic workflows* and run it on a clone. That scan was medium effort, scoped to `server/` and `deploy/`, at revision `252e83c` (before v1.0), and verified 33 findings: 1 high, 17 medium and 15 low. All 33 were still present on `develop` on November 5 and all were fixed in v1.1.0 (next section). **Not scanned:** `client/` (282 files), `scripts/`, `shared/`, and everything added after that revision (sign in with Google, the ntfy scripts, the module guard, `release.py` changes and all of v1.2). A diff-mode scan of those from `252e83c` has not been recorded.

## The November 2026 scan and v1.1.0

v1.1.0 fixed the 33 findings in six themed groups, with regression tests in `server/test/securityV11.test.ts`:

| Theme | Problem found | Fix |
| --- | --- | --- |
| Crashes and stalls (F1, F43, F44, F46, F51, F52, F57) | One unauthenticated request with a NUL byte in an invitation token (the single high finding, reachable over the tailnet) or a malformed id could end the Node process. A trailing-slash expression ran on every path in quadratic time, and invitation email checks and ICS recurrence expansion could stall the event loop | Every async route forwards errors (400 instead of a crash); tokens and ids are validated; linear trailing-slash stripping; email length cap; a total step budget for ICS expansion; feed tokens redacted from logs |
| Privilege (F2, F45, F48, F49, F58, F64, F65) | A child could leave a family, become an owner and replace the server's credentials; photo-frame tokens could link a Google identity; joining did not end old sessions; chore points could be multiplied or undone; an import could overwrite other accounts' preferences | Administrator checked in the database; display and ambient tokens rejected when linking; sessions revoked on join; points de-duplicated; import limited to the importer |
| Secrets sent to the wrong host (F41, F50, F55, F63, F66) | Changing an integration or AI address kept the stored key; the address guard missed IPv4-mapped forms and DNS rebinding; push endpoints were unchecked | Keys cleared when the address changes; addresses parsed to bytes with a full special-range list; connections pinned to the vetted address; push endpoints must be public https |
| Membership lifecycle (F42, F47, F59) | The calendar feed token and push subscriptions outlived membership; members could read and clear owner-only notifications | Feed token replaced on leave, removal or transfer; subscriptions recorded per account and deleted; notifications addressed to their real recipient (migration `familyhub/0011`) |
| Pi root helpers (F40, F53, F60, F61, F62, F68) | A compromised container could plant symlinks that the root applier followed, and tokens appeared on `curl` command lines | Never follow exchange paths; descriptor-based writes; root-only state directory; tokens passed through a descriptor |
| Lower (F3, F39, F54, F56, F67) | Reset links built from the request's Host header, login timing, imported recurrence overrides, SMTP downgrade | Trusted-host check, dummy password comparison, allowlisted override keys, `requireTLS` |

Several findings needed features this household has switched off (web push, SMTP, sign in with Google, the Integrations module) and were fixed before those are enabled. F2 had to be fixed before sign in with Google could safely be turned on.

**Deferred on purpose:** run the server container as a non-root user (the root cause behind the Pi-helper findings; it needs bind-mount ownership changes and a drill on the Pi, so it is a wishlist item for its own release); migrate to Express 5; per-member hashed calendar feed tokens (v1.1 replaces the shared token instead); ICS parsing in a worker thread; re-authentication before linking a new identity.

## Google and AI data

Calendar/Tasks OAuth permissions may cover more than the selected source, although application actions use the saved calendar/list. Optional Gmail read access covers the mailbox, not only the daycare sender. Family Hub filters and processes the specified sender, and daycare text is not automatically sent to AI. Treat messages, provider responses, links and attachments as untrusted.

AI requests can send deliberately included information to the selected provider. Review the provider's privacy terms and the proposed action before use; do not include children's email content merely to troubleshoot an AI connection. Test provider integration with fictional information where possible.

## Source and licensing

OpenFamily is AGPL-3.0-only. Preserve attribution and the upstream license, and provide the exact deployed modified version's Corresponding Source to network users as required. A private repository alone is not a replacement for the required source offer. Source archives must exclude secrets and household data. Consult [`UPSTREAM.md`](../UPSTREAM.md) and the repository's `licence.md`; seek appropriate legal advice for specific compliance questions.
