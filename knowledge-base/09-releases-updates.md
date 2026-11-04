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

Both tokens are set to **never expire** (November 2, 2026). Replace one from Settings → Advanced → Server credentials or with `.familyhub-local/pi/update-github-tokens.sh`; the Pi tests it before switching. Never paste tokens into chat or commit them. A daily check warns 30 days before anything expires — see [renewals and credentials](17-renewals-and-credentials.md). Update failures are not pushed anywhere yet; inspect the timer/service journal if updates stop.

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

Real upgrades across many releases (v0.1.0 → v0.3.5) have run on the Pi, each with its pre-update backup; confirm v0.3.6/v0.3.7 from the footer or the updater journal. A deliberate rollback on the Pi has not yet been exercised; unit tests cover simulated rollback and failure paths. See [the detailed release notes](../docs/familyhub/RELEASES.md).

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
| v1.0.0 | Nov 2026 | Own fork: unused OpenFamily modules and languages removed (tables dropped), server-enforced module toggles, sign in with Google, ntfy alerts |
