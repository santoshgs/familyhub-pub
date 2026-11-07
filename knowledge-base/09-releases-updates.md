# Releases and updates

[Knowledge base index](README.md) · [Pi deployment](07-raspberry-pi.md) · [Backup and recovery](10-backup-recovery.md)

Family Hub is maintained in a private derivative repository, with OpenFamily retained as the upstream remote. Pushing a branch alone does **not** update the Pi. A stable, versioned Family Hub release triggers the release mechanism; the Pi installs released, digest-pinned images rather than building the application on its 4 GB host.

## Branches and preview

Work happens on the **`develop`** branch. Preview it on the Mac with `npm run dev:familyhub:develop` at `http://127.0.0.1:5174/develop/` (same local database and sign-in as `dev:familyhub:local`; the Pi and frame are not involved). When it looks right, merge `develop` into **`familyhub/prototype`** — the default branch and the source of releases — with a pull request, then create a release from it. Merging alone does not change the Pi.

## Creating a release

The workflow is [`.github/workflows/familyhub-release.yml`](../.github/workflows/familyhub-release.yml). It can run for a new `familyhub-vX.Y.Z` tag or via its manual workflow input (**Actions → Family Hub release → Run workflow** on `familyhub/prototype`, as used for v0.3.6 and v0.3.7). Never reuse a version. The tag is passed into the client build, so the release shows as "Family Hub vX.Y.Z" in the app's footers. Review the final source and schema policy before creating the release.

The workflow installs locked dependencies, runs public-safety, build, backend, frontend, service-worker and release-tool checks, builds ARM64 and AMD64 server/client images, and tests the packaged stack on an AMD64 runner. It publishes a private release containing a deployment archive, digest-pinned manifest and matching source archive. The first release is `familyhub-v0.1.0`; ARM64 containers have since run on the actual Pi.

Keep the corresponding image digests and releases required for recovery. A release asset or build success is not by itself proof of functional Google, iOS or real-device acceptance. Retain the exact deployed source and OpenFamily's license notices; keep credentials and household data out of source archives.

## Automatic checks

The Pi's `familyhub-update.timer` is enabled. It checks approximately hourly with jitter for stable, non-draft semantic Family Hub releases. The updater validates the package, pulls digest-pinned images, takes a private pre-update backup of database, uploads and configuration, starts the stack, and waits for health checks. It records the installed version only after success. Failed or deliberately rolled-back versions are blocked from automatic retry. It does not automatically deploy arbitrary branch commits.

The service runs with administrator privileges because Docker and private deployment files require them. Two distinct credentials are involved:

- A GitHub Packages classic token with `read:packages` for the private container images.
- A fine-grained token restricted to the Family Hub repository with Contents read permission for listing and downloading releases. It is stored in the Pi's root-only `/opt/familyhub/github-release.env` as `GH_TOKEN`.

Both tokens are set to **never expire** (November 2, 2026). Replace one from Settings → Advanced → Server credentials or with `.familyhub-local/pi/update-github-tokens.sh`; the Pi tests it before switching. Never paste tokens into chat or commit them. A daily check warns 30 days before anything expires — see [renewals and credentials](17-renewals-and-credentials.md). Since v1.0 the updater can push to a phone through ntfy when a release is installed, an update fails (once a day per failure) or a rollback happens, once `setup-ntfy.sh` has been run on the Pi. That has not been done on the household Pi yet, so inspect the timer/service journal if updates stop.

## Software updates from Settings (v1.2)

The server administrator can open **Settings → Advanced → Software updates** to see the release running on the Pi and the newest stable release, then choose **Check now** or **Install now**. The app only leaves a small request file in the exchange folder; a root-only helper on the Pi runs `release.py check` or starts the same `familyhub-update.service` the hourly timer runs. The app cannot pick a version, skip the backup or force a rollback. It needs the updated `release.py`, `familyhub-update.service` and `apply-credentials.sh` installed on the Pi (see [the admin helpers](../deploy/familyhub/admin/README.md)).

## Restart from Settings (v1.5.3)

The server administrator can open **Settings → Advanced → Restart Family Hub** to restart the server (for example to clear its caches). The page waits for the server's health check and reloads. The server exits cleanly and Docker's `unless-stopped` policy starts it again; the database, web and gateway containers keep running. Shutdown is bounded to five seconds even with a photo frame connected. `release.py restart` on the Pi remains available for the same job. The button is not yet tried on the household Pi.

## After a release: files outside the containers

The hourly updater replaces the application images. It does not replace host files. When a release changes `release.py`, `familyhub-update.service` (followed by `systemctl daemon-reload`), the admin helpers or the LAN listener, the release notes say so and the owner reinstalls them from the release package. v1.1.0 changed the admin helpers; v1.2.0 changed `release.py`, the update service, `apply-credentials.sh` and the LAN listener (photo route, so re-run `apply-lan-display.sh`).

```sh
systemctl is-enabled familyhub-update.timer
systemctl is-active familyhub-update.timer
systemctl list-timers familyhub-update.timer --all
sudo systemctl status familyhub-update.service --no-pager
sudo journalctl -u familyhub-update.service -n 30 --no-pager
```

Review logs for private content before sharing. During an incident, `sudo systemctl stop familyhub-update.timer` pauses scheduled checks; re-enable the timer only after investigation.

## Which version is running?

The footer of the display ("ONE FAMILY · ONE SOURCE OF TRUTH · Family Hub vX.Y.Z") and of every management page ("Family Hub vX.Y.Z · Built on OpenFamily") shows the version baked into the client image. A `/develop/` preview shows a git description instead, such as `v0.3.7-3-g1a2b3c4` (three commits after v0.3.7). If the frame still shows an older number an hour or more after a release, check the update timer and journal below.

## Manual rollback and limits

After a second release has been installed and a previous version is recorded, the operator can run:

```sh
sudo python3 /opt/familyhub/release.py rollback \
  --state-dir /opt/familyhub/state --env-file /opt/familyhub/private.env
```

The tool takes a fresh backup and switches application images. **It does not rewind the database or undo writes to Google.** The release policy permits automatic rollback only for declared backward-compatible changes; incompatible schema changes need a separate migration and recovery plan. A failed first deployment has no previous application to restore.

Real upgrades across many releases (v0.1.0 → v1.2.0) have run on the Pi, each with its pre-update backup. Before release, the v1.0.0 upgrade (which drops the removed modules' tables) and an app rollback to v0.3.7 were simulated with fictional data, as were v1.1.0 and v1.2.0 with a rollback to v1.0.0. Their `rollbackSafe` entries in `deploy/familyhub/release-policy.json` record this. A deliberate rollback on the Pi has not yet been exercised; unit tests cover simulated rollback and failure paths. See [the detailed release notes](../docs/familyhub/RELEASES.md).

## Release history

| Release | Date | Highlights |
| --- | --- | --- |
| v0.1.0 | Oct 30, 2026 | First Pi deployment |
| v0.2.0 | Nov 2, 2026 | Ambient display and app navigation |
| v0.3.0 | Nov 2, 2026 | Display visuals: weather and F1 artwork |
| v0.3.1 | Nov 2, 2026 | Frame pairing, revocable displays, detail panels, night dimming, LAN listener |
| v0.3.2 | Nov 2, 2026 | Hold to exit display mode |
| v0.3.3 | Nov 2, 2026 | Chores page, overflowing navigation, "+N more", faster panels |
| v0.3.4 | Nov 2, 2026 | News with reader view, tomorrow's weather, Your name |
| v0.3.5 | Nov 2, 2026 | Server credentials in Settings → Advanced; daily renewal check |
| v0.3.6 | Nov 4, 2026 | Security patch: glob/minimatch/ejs advisories, Snyk Code hardening |
| v0.3.7 | Nov 4, 2026 | Version in footers; web-only cleanup (Android, website, installers removed); narrower CORS |
| v1.0.0 | Nov 4, 2026 | Own fork: unused OpenFamily modules and languages removed (tables dropped), server-enforced module toggles, sign in with Google, ntfy alerts |
| v1.1.0 | Nov 5, 2026 | Security release: fixes the 33 findings of the November 4 scan (crash-proof routes, server-admin credentials, SSRF and secret-destination checks, membership clean-up, hardened Pi helpers) |
| v1.2.0 | Nov 5, 2026 | Dashboard quick bar (Wi-Fi, countdown, markets, photos), richer weather and Formula 1 panels, Settings → Display, Settings → Advanced → Software updates (check or install now) |
| v1.3.0 | Nov 5, 2026 | Frame light/dark toggle, full-screen photo slideshow, News card from chosen RSS/Atom feeds; collapsible Settings sections; Sign out in the navigation bar |
| v1.4.0 | Nov 6, 2026 | Board Book look for the management app behind a Classic/Board Book switch |
| v1.4.1 | Nov 6, 2026 | Same code as v1.4.0 (released before the fix reached `familyhub/prototype`) |
| v1.4.2 | Nov 6, 2026 | No sign-out when Google needs re-authorizing (409 `GOOGLE_RECONNECT`); sign in with Google removed, passwords only |
| v1.5.0 | Nov 6, 2026 | Frame colour swatches and faster detail sheets; budget shared expenses, settle up and expense groups; fixed budget categories; edit and delete Google Calendar events |
| v1.5.1 | Nov 6, 2026 | Budget → Groups → Import from Splitwise (CSV import with people, categories, currencies and balances) |
| v1.5.2 | Nov 6, 2026 | Frame display layout chooser (cards, pills or off), faster frame detail panels, per-account menu order, Classic look on phone More menu, Display setup merged into Settings, budget balance card |
| v1.5.3 | Nov 6, 2026 | Restart Family Hub from Settings → Advanced (server administrator), bounded shutdown, uniform Classic Settings sections, F1 card keeps the last good race calendar |
