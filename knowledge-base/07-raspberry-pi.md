# Raspberry Pi deployment

[Knowledge base index](README.md) · [Networking](08-tailscale-networking.md) · [Updates](09-releases-updates.md) · [Recovery](10-backup-recovery.md)

## Installed host

The household Pi is a Raspberry Pi 4 with 4 GB RAM and a roughly 128 GB microSD card. However, this endpoint can be anything - Raspberry Pi, a server, desktop, or hosted on the cloud. Your choice.

## Running services and storage

| Component | Role |
| --- | --- |
| Docker and Compose | Run the versioned application stack |
| PostgreSQL 16 container | Household database and Family Hub state |
| Server container | Authentication, APIs, Google adapters and AI integration |
| Client container | Browser UI; host port `127.0.0.1:8080` only |
| Tailscale and Serve | Private tailnet connection and HTTPS proxy to the loopback client |
| systemd update timer | Periodic checks for stable GitHub releases |
| Host Caddy (LAN listener) | HTTPS for the photo frame at `frame.example.com`, bound to the Pi's LAN address; display routes only |
| nftables `inet familyhub_lan` | HTTPS from the frame, SSH from the home network, Tailscale transport; drops other new LAN input on Wi-Fi and Ethernet |
| certbot | Renews the frame certificate through Cloudflare DNS |
| `familyhub-renewals.timer` | Daily expiry check; status for Settings → Advanced |
| `familyhub-credentials.path` | Applies tokens submitted from Settings → Advanced |

The database and server are not published as host ports. The inactive public-ingress Compose profile is not the chosen deployment. No router forwarding or Tailscale Funnel is required. See [networking](08-tailscale-networking.md).

Host changes are made with committed scripts that the owner runs from the Mac; each copies its files over Tailscale and asks for the Pi password once. Nothing runs with sudo unattended.

| Script (in `.familyhub-local/pi/`) | What it installs or changes | Source |
| --- | --- | --- |
| `apply-lan-display.sh` | Installs the newest release, then the LAN listener, certificate, firewall | [`deploy/familyhub/lan-display`](../deploy/familyhub/lan-display/README.md) |
| `install-admin.sh` | Renewal check and credential applier | [`deploy/familyhub/admin`](../deploy/familyhub/admin/README.md) |
| `update-github-tokens.sh` | Replaces the GitHub tokens at hidden prompts | same |

The root-protected deployment environment is `/opt/familyhub/private.env`; release state and backups are under `/opt/familyhub/state/`; the release tool is `/opt/familyhub/release.py`. A separate protected file, `/opt/familyhub/github-release.env`, contains the GitHub release-read credential. These are operational locations, not files to publish. Docker volumes hold the database and uploads. Secrets and tokens must not be copied into documentation.

## SSH from the prepared Mac

The Pi's address can change with DHCP; check the router or Tailscale for its current identity. On the original Mac, from the project checkout, the dedicated deployment key and verified host-key file are in the ignored `.familyhub-local/` folder:

```sh
ssh -i .familyhub-local/pi-deploy \
  -o IdentitiesOnly=yes \
  -o UserKnownHostsFile=.familyhub-local/pi-known-hosts \
  pi@<verified-pi-address>
```

SSH listens on port 22 and is reachable from the home network and over Tailscale; the Pi's firewall drops other inbound LAN traffic. Do not put the private key in Git. After OS replacement, verify the new host fingerprint on the Pi console before changing the trusted host entry. The Pi password and Family Hub password are different.

## Routine read-only checks

On the Pi:

```sh
sudo docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
tailscale status
tailscale serve status
systemctl is-active familyhub-update.timer
sudo systemctl status familyhub-update.service --no-pager
```

Also useful: `systemctl status caddy familyhub-firewall`, `sudo nft list table inet familyhub_lan` and `sudo /opt/familyhub/check-renewals.sh`.

All three app containers should report healthy. The client should bind to `127.0.0.1:8080`, not all interfaces. A healthy container only establishes a basic service check, not that all Google operations or Safari interactions work. Logs may contain private information; review them locally before sharing.

The original Mac backend was stopped during migration to avoid running two Google synchronization processes. Do not restart it with live household credentials while the Pi is active without a deliberate cutover plan. The local Mac data and backups are not a live replica.
