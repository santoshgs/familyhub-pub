# Wishlist

Ideas for future FamilyHub builds. Add anything — a line is enough. When an
idea is picked up, move it to **In progress**, and to **Done** with the release
that shipped it.

**How to add an idea:** put it under the closest heading as
`- [ ] Short title — why it would help (optional notes, links, who asked)`.

## Ideas

### Display (photo frame)
- [ ] Google Photos as a slideshow source — needs Google Photos Ambient API partner access; see `docs/familyhub/AMBIENT_DISPLAY.md`. (Uploaded photos shipped in v1.2.)
- [ ] Shopping list summary card.
- [ ] Hardware brightness on the night-mode schedule (today only the dashboard dims; the backlight stays at its set level).
- [ ] Rotate between two card layouts (e.g. weekday morning vs. evening).

### Management
- [ ] Notify a phone when the Pi's updater fails or a credential nears expiry (built in since v1.0; run `setup-ntfy.sh` on the Pi to switch it on).
- [ ] Classroom integration (currently a placeholder page).
- [ ] Include budget groups, settlements and sharing fields in the portable data export — a known gap since v1.5.0 (database backups already keep them).
- [ ] Publish the Google OAuth app out of Testing — grants in Testing expire after seven days (owner action in Google Cloud).

### Pi and operations
- [ ] Run the server container as a non-root user (root cause behind the v1.1 admin-helper findings; needs bind-mount ownership changes and a Pi drill).
- [ ] Least-privilege hardening for containers and host: `nginx-unprivileged` for the client, `cap_drop: ALL` with `no-new-privileges`, a read-only root filesystem, PostgreSQL on an internal-only network, resource limits, and an updater split so only the final compose step runs as root (proposed; pairs with the non-root item above; needs a Pi drill and a rollback path; rootless Docker and userns-remap not recommended for now; see `knowledge-base/13-security-privacy.md`).
- [ ] Disable Tailscale key expiry for the Pi (one click in the admin console; currently expires 2027-04-27).
- [ ] Encrypted off-device backups on a schedule.
- [ ] A real upgrade-then-rollback drill across two releases.
- [ ] Commit `install-admin.sh` so the Pi helper install is one tested step (today it is a local script that misses `daemon-reload`, enabling the units and `notify.sh`).
- [ ] Make the release workflow's version check print why it failed.
- [ ] A security scan of the code the first scan skipped (`client/`, `scripts/`, `shared/`, sign in with Google, ntfy, v1.2), in diff mode from `252e83c`.

## In progress

None right now. Owner follow-ups are listed in `docs/familyhub/STATE.md`.

## Done

- [x] Choose which cards show on the photo frame: a display layout (cards, quick pills or off) in Settings → Display — v1.5.2
- [x] Frame detail panels open faster; menu order per account (Settings → You); Classic look and theme on the phone More menu; Display setup merged into Settings; compact budget balance card — v1.5.2
- [x] Restart Family Hub from Settings → Advanced (server administrator); uniform Classic Settings sections; F1 card keeps its last good race calendar — v1.5.3
- [x] Board Book look for the management app, behind a per-browser Classic/Board Book switch (Classic default) — v1.4.0

- [x] Edit and delete Google Calendar events from the calendar and event details, with the Google colour picker — v1.5.0
- [x] Frame: Google Calendar colour swatches beside events, and faster detail sheets — v1.5.0
- [x] Budget: shared expenses (who paid, split between members), who owes whom, Settle up, expense groups, owes/paid analytics; fixed categories in 5 groups — v1.5.0
- [x] Budget: import Splitwise history (Budget → Groups → Import from Splitwise) — v1.5.1

- [x] Quick bar with guest Wi-Fi QR, countdown, stocks and crypto, photo slideshow; richer weather and F1 panels — v1.2.0
- [x] Check for and install updates from Settings → Advanced → Software updates — v1.2.0
- [x] Owner-run `remove-account.sh` for leftover logins — v1.2.0
- [x] Security release: November 2026 scan findings fixed — v1.1.0
- [x] Own fork: unused modules and languages removed, server-enforced module switches, sign in with Google and ntfy alerts built in (setup on the Pi pending) — v1.0.0
- [x] Frame pairing with one-time codes; revocable displays — v0.3.1
- [x] Detail panels for calendar (7 days), to-dos and daycare; night dimming — v0.3.1
- [x] Hold to exit display mode — v0.3.2
- [x] Chores page; navigation that overflows into More; "+N more" indicators — v0.3.3
- [x] News card with reader view; tomorrow's weather; profile name — v0.3.4
- [x] Server credentials in Settings → Advanced; daily renewal check — v0.3.5
- [x] Dependabot/Snyk fixes and a `develop` branch with a `/develop/` preview — v0.3.6
- [x] Version number in the display and management footers; web-only cleanup — v0.3.7
