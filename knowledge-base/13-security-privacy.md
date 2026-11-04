# Security and privacy

[Knowledge base index](README.md) · [Accounts](03-accounts-and-access.md) · [Recovery](10-backup-recovery.md)

## Access boundaries

- The Pi application is reachable through the household's private Tailscale network and HTTPS. The client binds on the Pi to loopback; the server and database are not published as host ports. Tailscale membership is not a substitute for Family Hub sign-in.
- Parent, child/member and read-only display permissions are enforced by the backend. A prototype display toggle or hidden module is not an authorization boundary.
- API responses use no-store behavior and the service worker does not keep a private API cache for offline reuse. Test existing browser tabs after worker updates.
- CORS allows only the origins in `CORS_ORIGINS`. Until v0.3.7 the server also always allowed `http://localhost`, `https://localhost` and `capacitor://localhost` for the Android app; that was removed with the app.
- Docker administrator access is effectively host administrator access. The updater runs as root and its environment and credentials must stay root-protected.
- The photo frame reaches only a display listener on the home network: an allowlist of display pages, assets and display API calls, HTTPS accepted only from the frame's reserved address, everything else 404 or redirected to the display. Displays hold read-only tokens bound to revocable sessions; the server enforces the same allowlist. Pairing codes are hashed, single-use, five-minute and rate limited.
- Server credentials submitted in Settings → Advanced (owner only) are written to a 0600 file in a bind-mounted exchange folder and applied by a root-only systemd unit that tests, installs and deletes them. FamilyHub never stores, logs or returns them; the container cannot read installed credentials.

## Secrets and private records

Keep `.familyhub-local/`, `.env` files, SSH private keys, Google OAuth secrets/tokens, GitHub tokens, databases, backups, family records and daycare emails out of Git, issue reports, screenshots and chat. Do not put a password or token in a command argument, shell history, build-time frontend variable or public URL.

`JWT_SECRET` protects authentication and is also relevant to existing upstream AI credential encryption. `FAMILYHUB_TOKEN_KEY` separately protects saved Google credentials. Back up the original keys securely with the database and matching configuration; changing a key can make stored credentials unreadable. The Pi backup archives have restrictive permissions but are not encrypted; use encrypted storage for copies away from the device.

The GitHub image token is a classic token limited to `read:packages`. The separate release token is fine-grained to the project repository with Contents read permission. Both are set to never expire, which trades rotation for reliability; replace them if they may have leaked, and keep them root-only on the Pi. A previous attempt to transfer the Mac's broad GitHub credential to the Pi was blocked; the narrower Pi-specific credentials were used instead.

## Dependency and code scanning

- **Dependabot** watches `package-lock.json` on GitHub. Alerts close only when the fix reaches the default branch (`familyhub/prototype`).
- **Snyk** runs from the Mac through the Snyk tools in the Claude desktop app: a dependency scan and Snyk Code (source analysis, enabled November 4, 2026). The Snyk token lives in the app's settings; never paste it into chat.
- Patched transitive versions are pinned with root `overrides` in `package.json` (for example `glob` and `ejs`, added in v0.3.6). npm's suggested `audit fix --force` would *downgrade* `vite-plugin-pwa`; do not use it.
- [`client/.snyk`](../client/.snyk) accepts two build-only findings with no patched release, each expiring on 2027-02-04 so Snyk raises them again: `braces` (via Tailwind 3; the only fix, Tailwind 4, needs Chrome 111+/Safari 16.4+ and would break the frame's WebView 107 and Safari 15.4) and `deepmerge` (via the PWA/Workbox build). Dependabot alert #1 is the same `deepmerge` issue.
- The first Snyk Code scan reported 95 findings. Three were fixed in v0.3.6 (integration request type checks — a malformed field could crash the server; the Immich photo proxy now re-serves only image types; the native server URL check, later removed with the app). The rest were reviewed as false positives or by design: parameterized SQL, SSRF guard with per-redirect checks and metadata blocking, allowlisted file names, test fixtures. Snyk Code ignores can only be recorded in the Snyk web app, so local scans keep listing them.

## Google and AI data

Calendar/Tasks OAuth permissions may cover more than the selected source, although application actions use the saved calendar/list. Optional Gmail read access covers the mailbox, not only the daycare sender. Family Hub filters and processes the specified sender, and daycare text is not automatically sent to AI. Treat messages, provider responses, links and attachments as untrusted.

AI requests can send deliberately included information to the selected provider. Review the provider's privacy terms and the proposed action before use; do not include children's email content merely to troubleshoot an AI connection. Test provider integration with fictional information where possible.

## Source and licensing

OpenFamily is AGPL-3.0-only. Preserve attribution and the upstream license, and provide the exact deployed modified version's Corresponding Source to network users as required. A private repository alone is not a replacement for the required source offer. Source archives must exclude secrets and household data. Consult [`UPSTREAM.md`](../UPSTREAM.md) and the repository's `licence.md`; seek appropriate legal advice for specific compliance questions.
