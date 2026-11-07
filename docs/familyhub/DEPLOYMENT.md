# Family Hub deployment

The standalone `deploy/familyhub/compose.yml` prepares the authenticated Family Hub
dashboard, PostgreSQL 16, and a Caddy HTTPS gateway. It does not merge with the
upstream Compose file. Only the gateway publishes host ports (80/443); the API
and database stay inside Docker. `/ready` checks PostgreSQL connectivity and
returns a generic 503 when unavailable. `/health` remains a process liveness check.

The Raspberry Pi runs this stack from versioned private releases (see
`RELEASES.md`): a digest-pinned updater (`familyhub-update.timer`, hourly)
installs new `familyhub-v*` releases with a protected pre-update backup.

## Current Pi deployment

| Area | State |
| --- | --- |
| Host | Raspberry Pi 4, Debian 13 (Trixie) ARM64, 3.7 GiB RAM, 117 GiB root. Inventoried read-only over SSH on 2026-11-02. |
| App | Compose with the VPN override: the client is published only on `127.0.0.1:8080`; the public gateway is disabled (`public-ingress` profile). |
| Management access | Tailscale Serve (`https://familyhub.example-tailnet.ts.net`). |
| Photo frame access | Host Caddy LAN listener for `frame.example.com`, read-only display allowlist. See [FRAME.md](FRAME.md) and [`deploy/familyhub/lan-display`](../../deploy/familyhub/lan-display/README.md). |
| Firewall | `inet familyhub_lan` table: HTTPS from the frame, SSH from the home network, Tailscale transport; other new LAN input dropped on Wi-Fi and Ethernet. Docker/Tailscale tables untouched. |
| Certificates | Let's Encrypt via Cloudflare DNS-01 (`certbot.timer`) for the LAN name; Tailscale for the tailnet name. |
| Router | DHCP reservations for the Pi and the frame; guest-network exception for the frame only; no port forwarding. Addresses are kept out of this repository. |
| Renewals | Daily `familyhub-renewals.timer`; Settings → Advanced → Server credentials (server administrator) replaces tokens through `familyhub-credentials.path`. GitHub tokens never expire; see [renewals](../../knowledge-base/17-renewals-and-credentials.md) and [`deploy/familyhub/admin`](../../deploy/familyhub/admin/README.md). |
| SSH | Port 22 from the home network and over Tailscale. |
| Admin helpers (v1.1, v1.2) | Reinstall after v1.1.0 and again after v1.2.0 (the local `.familyhub-local/pi/install-admin.sh` is not committed; the file and unit list is in [`deploy/familyhub/admin`](../../deploy/familyhub/admin/README.md), including `notify.sh`, `daemon-reload` and enabling the units). Since v1.1 the applier keeps its results in the root-only `/opt/familyhub/admin-state` (created on first run, 0700) and never follows paths in the exchange directory. Server credentials belong to `FAMILYHUB_ADMIN_EMAIL` in `/opt/familyhub/private.env` when set, otherwise the first account created. |
| Software updates and alerts (v1.2) | Settings → Advanced → Software updates (server administrator) asks the Pi to check for or install a release now, through the admin exchange; it needs the updated `release.py`, `familyhub-update.service` and `apply-credentials.sh`. The updater still chooses the version, backs up and rolls back. ntfy alerts need `setup-ntfy.sh`, which has not been run on the household Pi. |
| Restart (v1.5.3) | Settings → Advanced → **Restart Family Hub** (server administrator) calls `POST /api/familyhub/admin/restart`. The server exits cleanly within five seconds (bounded even with frames' WebSockets open) and Docker's `unless-stopped` policy starts it again; the database, client and gateway keep running. The page waits for `/health` and reloads. `release.py restart` on the Pi does the same from the shell. Not yet tried on the household Pi. |
| Admin rights | The `pi` account has no passwordless sudo or Docker socket access. Host changes are scripts the owner runs with the Pi password; nothing runs unattended with sudo. |

The earlier approach (a Pi-hosted DNS resolver plus a bootstrap Caddy config
that allowed parent sign-in on the frame, then a finalize step) was replaced in
v0.3.1. Android kept preferring the router's IPv6 DNS servers, so the frame's
resolver override reset and the frame lost the dashboard; a public name that
points at the LAN address avoids that entirely, and pairing codes replace
signing in on the frame.

## Preparing a new host

Use a Docker host with Compose v2. Copy `deploy/familyhub/env.example` privately to
`.familyhub-local/deployment.env`, with owner-only permissions. Set a real
`FAMILYHUB_HOST` hostname (no scheme/path), strong database password, and preserved
encryption secrets. No existing local credentials are copied automatically.
Required variables fail configuration when blank. The stack uses separate named
volumes and does not migrate the Mac's database automatically.

Caddy's automatic certificate issuance requires suitable DNS and certificate
authority reachability. A private LAN-only hostname needs a different certificate
strategy and device trust setup; do not expose the home router just to satisfy this
template. Choose the hostname/access method before launching it.

Register `https://<hostname>/api/familyhub/google/callback` on the existing Google
OAuth client. Calendar/Tasks/Gmail credentials stay server-side. A changed origin
requires logging in again; Google consent may also need renewal. Registration
defaults off; enable it temporarily only when bootstrapping a fresh household.

After host/configuration readiness, run from the repository root:

```sh
docker compose --env-file .familyhub-local/deployment.env -f deploy/familyhub/compose.yml config --quiet
docker compose --env-file .familyhub-local/deployment.env -f deploy/familyhub/compose.yml build
docker compose --env-file .familyhub-local/deployment.env -f deploy/familyhub/compose.yml run --rm --no-deps gateway caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose --env-file .familyhub-local/deployment.env -f deploy/familyhub/compose.yml up -d
node scripts/familyhub-smoke.mjs https://<hostname>
```

Do not print resolved Compose configuration containing secrets into shared logs.
The smoke check is read-only: readiness plus unauthenticated rejection/no-store
headers for notes, Family Hub and AI settings. It requires HTTPS outside loopback.
It does not validate sign-in, WebSockets, Google access or browser rendering.
Before sharing a network deployment, retain AGPL notices and provide recipients
access to the corresponding modified source without private configuration/data.

## Cache and device acceptance

Nginx now uses exact locations for `/sw.js` and `/registerSW.js` so the general
one-year immutable JavaScript rule cannot capture these update scripts. Confirm
their deployed `Cache-Control` headers through the HTTPS gateway. The built worker
passed all four private-cache regression checks in the Node test harness:

```sh
FAMILYHUB_TEST_BUILT_SW=true node --test scripts/service-worker.test.mjs
```

Actual installed-worker activation and iOS Safari behavior remain device tests.
On iPhone/iPad verify sign-in, Google redirects, task and event edits, inline notes,
keyboard/zoom, safe areas, portrait/landscape, home-screen launch, and protected
display permissions. After loading the updated worker, confirm offline household
requests fail rather than show a prior account's cached data. Test sign-out and
account switching. Browser viewport simulation cannot substitute for this.

## Restart and shutdown

Restarting from Settings only restarts the server process; it is not a host reboot
and does not run an update. Shutdown is bounded: idle connections close at once, and
the process exits within five seconds even with display WebSockets open (before
v1.5.3 it could wait a minute or more). A restart does not change the database or
uploads.

## Recovery and operation

Follow `BACKUP_RESTORE.md` for the verified native Mac backup/restore drill.
That script does not manage Docker volumes. Production backup must additionally
cover encrypted configuration, uploads and certificate volumes; verify restore
on an isolated host before changing the active database. Avoid running a recovered
copy's background Google synchronization alongside the original instance.

After deployment, verify restart/reboot recovery, a fresh backup, restoration,
storage growth, memory use under load and real Google/provider behavior. Gemini
is deferred; a deployment must not be described as AI-validated until inference
succeeds. The Pi's current state is summarized under “Current Pi deployment.”

References: [Caddy proxy configuration](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)
and [Compose required variables](https://docs.docker.com/reference/compose-file/interpolation/).
