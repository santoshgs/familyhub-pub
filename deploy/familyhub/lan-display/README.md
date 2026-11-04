# Pi LAN display listener

Host-level files that let the photo frame, which has no Tailscale client, reach
the read-only FamilyHub display over the home network. They sit beside the
running service on `127.0.0.1:8080` and do not change the Compose stack or
Tailscale Serve. Management stays on the tailnet.

| File | Installed as | Purpose |
| --- | --- | --- |
| `apply-lan-display.sh` | run from here | Installs or updates everything below. Safe to rerun. |
| `Caddyfile.lan` | `/etc/caddy/Caddyfile` | Host Caddy bound to the Pi's LAN address only; display allowlist. |
| `caddy-familyhub-lan.conf` | `caddy.service.d/familyhub-lan.conf` | Starts Caddy after the firewall; loads `listener.env`. |
| `familyhub-firewall.service` | `/etc/systemd/system/` | Loads `/etc/family-hub-lan/firewall.nft` before the network comes up. |
| `familyhub-cert-deploy.sh` | `/etc/family-hub-lan/cert-deploy.sh` | certbot deploy hook: copies the certificate for Caddy and reloads it. |

## Run

```sh
sudo ./apply-lan-display.sh <reserved-frame-ip> <lan-hostname>
```

The owner runs it from the Mac with `.familyhub-local/pi/apply-lan-display.sh`,
which copies this folder to `~/familyhub-lan-display` on the Pi over Tailscale
(the pinned host key is used), installs the newest release, then runs the script
with sudo. The `pi` account has no passwordless sudo, so the owner types the
password on the Pi. Nothing here is run unattended.

What the script does, in order:

1. Backs up the current ruleset, Caddyfile, `/etc/family-hub-lan` and units to
   `/root/familyhub-lan-backup/<timestamp>/`.
2. Installs `certbot` and `python3-certbot-dns-cloudflare` if missing.
3. On first run, asks (hidden input) for a Cloudflare API token limited to
   *Zone → DNS → Edit* on the domain, and stores it as
   `/etc/family-hub-lan/cloudflare.ini` (root, 0600).
4. Obtains or keeps the Let's Encrypt certificate for `<lan-hostname>` by DNS-01
   and installs it for Caddy. `certbot.timer` renews it; the deploy hook reloads
   Caddy.
5. Writes `firewall.nft` and checks it with `nft -c`.
6. Validates and installs the Caddyfile and units.
7. Retires the earlier Pi-hosted DNS resolver (`familyhub-dns.service`) and the
   Tailscale-issued LAN certificate units.
8. Replaces the firewall table atomically, restarts Caddy, reports the Docker
   Engine version (warns below 28), and checks the routes from the Pi itself.

The hostname needs a public DNS **A record** pointing at the Pi's LAN address,
proxy off (DNS only). It resolves for anyone but is only reachable inside the
home network, which lets the frame use normal DNS.

## Routes on the LAN listener

| Request | Result |
| --- | --- |
| `GET/HEAD /display`, `/display-pair` | proxied |
| `GET/HEAD` static assets (`/assets/*`, `/fonts/*`, icons, manifest, `sw.js`, `registerSW.js`) | proxied |
| `GET /api/auth/me`, `/api/auth/dashboard-prefs`, `/api/familyhub/modules`, `/api/familyhub/ambient`, `/api/familyhub/ambient/article` (news reader view) | proxied |
| `POST /api/familyhub/display/pair`, `/api/familyhub/display/refresh` | proxied |
| any other `GET/HEAD` page (`/`, `/login`, `/display-settings`, …) | `302 → /display` |
| anything else (other API paths, `/ws`, other methods) | `404` |

The server applies the same limits to display tokens, so the allowlist is a
second layer rather than the only one. Path traversal attempts
(`/assets/../api/…`, encoded variants) were checked against this configuration
and return 404.

## Firewall (`table inet familyhub_lan`)

Input hook, priority −10, on `wlan0` and `eth0`:

* established/related, loopback and `tailscale0`: accepted
* HTTPS (443) from the frame's reserved address only
* SSH (22) from the home subnet (IPv4 and the global IPv6 prefix) and IPv6
  link-local
* ICMP echo from the home subnet; required ICMPv6 neighbour/router and error
  messages
* Tailscale UDP 41641 from the home subnet; DHCP and DHCPv6 client replies
* everything else new on `wlan0`/`eth0`: dropped

Docker's and Tailscale's own iptables-nft tables are not touched, and Docker
publishes FamilyHub only on `127.0.0.1:8080`. The unit has no stop action:
stopping it leaves the rules in place. To remove them deliberately, run
`sudo nft delete table inet familyhub_lan` and disable the unit.

## Rollback

Each run's backup folder holds the previous Caddyfile, `/etc/family-hub-lan`,
the units and a full `nft list ruleset`. Restore those files, run
`sudo systemctl daemon-reload`, `sudo nft -f /etc/family-hub-lan/firewall.nft`
and `sudo systemctl restart caddy`.
