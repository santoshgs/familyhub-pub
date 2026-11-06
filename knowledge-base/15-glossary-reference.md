# Glossary and reference

[Knowledge base index](README.md) · [Troubleshooting](11-troubleshooting.md)

## Terms

| Term | Meaning |
| --- | --- |
| Family Hub | The household-focused customization of OpenFamily |
| OpenFamily | The upstream self-hosted application and source foundation |
| Household / family owner | The account boundary used to scope shared family data |
| Dedicated Google account | The Google identity used for shared Calendar, Tasks and optional daycare mailbox access |
| Display scope | A server-enforced read-only session; different from the fictional prototype's visual toggle |
| Tailnet | The private Tailscale network containing authorized devices |
| MagicDNS | Tailscale's private device-name resolution |
| Tailscale Serve | Private tailnet HTTPS proxy to a local service; not public Funnel |
| GHCR | GitHub Container Registry, where private application images are stored |
| Release manifest / digest | Version metadata and immutable image references checked by the updater |
| Snapshot / cache | Disposable local copy of Google-derived data; not its source of truth |
| Rollback | Switching to previous application images; it does not automatically reverse database or Google changes |
| Ambient display | The read-only dashboard at `/display`, designed for a frame or wall screen |
| Display session | A paired display's revocable, read-only session; listed under Paired displays |
| Pairing code | 8-digit, single-use, five-minute code that connects a frame without a password |
| LAN listener | Host Caddy on the Pi's LAN address serving only the display, for the frame |
| HomeHQ | The kiosk launcher on the frame (Wes Bos's photo-frame-dashboard) |
| Server credentials | Tokens the Pi uses (GitHub release, GHCR, Cloudflare), managed in Settings → Advanced |
| `develop` / `familyhub/prototype` | The working branch (previewed at `/develop/` on the Mac) and the release/default branch |
| Version label | "Family Hub vX.Y.Z" in the display and management footers; the release tag baked into the client image |
| Snyk policy | `client/.snyk`: accepted dependency findings with a reason and an expiry date |
| Server administrator | The one account that manages server credentials and software updates: the email in `FAMILYHUB_ADMIN_EMAIL`, otherwise the first account created |
| Quick bar | The row of pills on the frame (guest Wi-Fi, countdown, markets, photos), set up in Settings → Display (v1.2) |
| Module guard | The server check that closes a switched-off module with 403 `MODULE_DISABLED` (v1.0) |
| Software updates | Settings → Advanced panel showing the running and newest release, with Check now and Install now; the Pi still chooses the version |
| ntfy | The phone-notification service used for expiry, install, failure and rollback alerts; set up with `setup-ntfy.sh` |
| Claude Security | The Claude Code plugin whose November 4, 2026 scan led to the v1.1.0 security release |

## Locations

| Location | Purpose |
| --- | --- |
| [`knowledge-base/`](README.md) | This GitHub-readable, categorized guide |
| [`docs/familyhub/`](../docs/familyhub/) | Earlier detailed implementation notes and the historical QA record |
| [`deploy/familyhub/`](../deploy/familyhub/) | Deployment, update and release templates |
| `.familyhub-local/` | Ignored Mac development configuration, backups and dedicated SSH material; private |
| `/opt/familyhub/private.env` | Pi's root-protected app configuration; private |
| `/opt/familyhub/github-release.env` | Pi's root-protected release-read token; private |
| `/opt/familyhub/state/` | Pi release state and private pre-update backups |
| `/opt/familyhub/release.py` | Pi release updater and rollback tool |
| `/opt/familyhub/check-renewals.sh`, `apply-credentials.sh` | Pi renewal check and credential applier |
| `/opt/familyhub/notify.sh`, `/etc/familyhub-notify.env` | ntfy sender and its private topic settings |
| `/opt/familyhub/admin-state/` | Root-only results and status written by the applier (v1.1) |
| `familyhub-photos/` in the uploads volume | Slideshow photos uploaded in Settings → Display (v1.2) |
| `/opt/familyhub/admin-exchange/` | Hand-off folder between Settings → Advanced and the root applier (status files only, once applied) |
| `/etc/family-hub-lan/` | LAN listener config, frame certificate, Cloudflare token (root-only) |
| [`deploy/familyhub/lan-display/`](../deploy/familyhub/lan-display/README.md), [`admin/`](../deploy/familyhub/admin/README.md), [`frame/`](../deploy/familyhub/frame/frame.sh) | Pi and frame scripts |
| [`WISHLIST.md`](../WISHLIST.md) | Ideas for future builds |

Never add the contents of private locations to Git. The Pi's precise IP and Tailscale hostname may change; obtain them from the router, Tailscale status or the device owner rather than treating old examples as permanent.

## Starting points

- [Upstream OpenFamily](https://github.com/NexaFlowFrance/OpenFamily) and [`UPSTREAM.md`](../UPSTREAM.md)
- [Detailed release runbook](../docs/familyhub/RELEASES.md)
- [Original Google setup](../docs/familyhub/GOOGLE_SETUP.md)
- [Local backup/restore guide](../docs/familyhub/BACKUP_RESTORE.md)
- [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve)
- [Google OAuth web-server flow](https://developers.google.com/identity/protocols/oauth2/web-server)
- [GitHub Container Registry authentication](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry)

The detailed local/Google guides contain original setup-era checkpoints. Check their dates and this index before interpreting claims about what is currently deployed or accepted.
