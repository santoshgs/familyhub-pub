# Wishlist

Ideas for future FamilyHub builds. Add anything — a line is enough. When an
idea is picked up, move it to **In progress**, and to **Done** with the release
that shipped it.

**How to add an idea:** put it under the closest heading as
`- [ ] Short title — why it would help (optional notes, links, who asked)`.

## Ideas

### Display (photo frame)
- [ ] Google Photos slideshow card — needs Google Photos Ambient API partner access; see `docs/familyhub/AMBIENT_DISPLAY.md`.
- [ ] Travel countdown card — days until the next trip on the family calendar.
- [ ] Shopping list summary card.
- [ ] Bitcoin / market ticker card.
- [ ] Hardware brightness on the night-mode schedule (today only the dashboard dims; the backlight stays at its set level).
- [ ] Rotate between two card layouts (e.g. weekday morning vs. evening).

### Management
- [ ] Notify a phone when the Pi's updater fails or a credential nears expiry (ntfy is supported by the renewal check; pick a topic).
- [ ] Edit and delete events from the FamilyHub calendar view (today: create only).
- [ ] Classroom integration (currently a placeholder page).

### Pi and operations
- [ ] Disable Tailscale key expiry for the Pi (one click in the admin console; currently expires 2027-04-27).
- [ ] Encrypted off-device backups on a schedule.
- [ ] A real upgrade-then-rollback drill across two releases.

## In progress

_Nothing yet._

## Done

- [x] Frame pairing with one-time codes; revocable displays — v0.3.1
- [x] Detail panels for calendar (7 days), to-dos and daycare; night dimming — v0.3.1
- [x] Hold to exit display mode — v0.3.2
- [x] Chores page; navigation that overflows into More; "+N more" indicators — v0.3.3
- [x] News card with reader view; tomorrow's weather; profile name — v0.3.4
- [x] Server credentials in Settings → Advanced; daily renewal check — v0.3.5
- [x] Dependabot/Snyk fixes and a `develop` branch with a `/develop/` preview — v0.3.6
- [x] Version number in the display and management footers; web-only cleanup — v0.3.7
