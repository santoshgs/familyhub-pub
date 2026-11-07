# Pi admin helpers: renewals, notifications, sign-in and server credentials

Host-side helpers (run as root on the Pi) behind **Settings → Advanced → Server
credentials** in FamilyHub, plus a daily expiry check.

| File | Installed as | Purpose |
| --- | --- | --- |
| `check-renewals.sh` | `/opt/familyhub/check-renewals.sh` | Lists every credential/certificate the Pi depends on with its expiry. Exit 1 when anything expires within 30 days or cannot be checked. Pushes through `notify.sh` when action is needed (urgent within 7 days). With `STATUS_JSON=<file>` it also writes a secret-free status file for the app. |
| `familyhub-renewals.service` / `.timer` | `/etc/systemd/system/` | Runs the check daily at about 09:17 and refreshes the app's status file. |
| `apply-credentials.sh` | `/opt/familyhub/apply-credentials.sh` | Applies tokens submitted from Settings. Tests each token, replaces the current one only if it works, deletes the submission, writes the outcome to `results.json`. |
| `familyhub-credentials.path` / `.service` | `/etc/systemd/system/` | Starts the applier as soon as a submission appears. |
| `update-github-tokens.sh` | `/opt/familyhub/update-github-tokens.sh` | Terminal alternative: hidden prompts, same applier. Hardened like the applier: writes each submission through its own descriptor into a no-follow `inbox/` handle, refuses a missing or symlinked `inbox/` instead of creating it, and reads results from the root-only state directory. Covered by `test_update_github_tokens.py`. |
| `notify.sh` | `/opt/familyhub/notify.sh` | Sends one ntfy push. Best effort, never fails its caller, keeps any access token off the command line. |
| `setup-ntfy.sh` | run once with sudo | Creates `/etc/familyhub-notify.env` (0600) with a long random topic and optional token, installs `notify.sh`, sends a test push. |
| `../release.py`, `../familyhub-update.service` | `/opt/familyhub/release.py`, `/etc/systemd/system/` | The updater. Writes a secret-free `update-status.json` (running, previous and newest release, last check, result) and, with `--publish-dir`, copies it into the exchange for Settings → Advanced → Software updates. |
| `remove-account.sh` | run with sudo | Removes one account by email (for example a review or test login): reports what would go, refuses an account other accounts have joined as their family, backs up the database, asks you to retype the address. See below. |

Install or update from the Mac with `.familyhub-local/pi/install-admin.sh` (it
copies these files and asks for the Pi password once). That script is local and is
not committed, and earlier instructions here missed several steps. Treat the table
above as the checklist for any install or update:

1. Copy every file to its install path: the helpers (including `notify.sh`) to
   `/opt/familyhub/` (root, 0755) and the units to `/etc/systemd/system/`.
2. Run `systemctl daemon-reload`.
3. Enable and start the renewal timer and the credentials path unit
   (`systemctl enable --now familyhub-renewals.timer familyhub-credentials.path`).
   The update timer is a separate, already enabled unit.
4. Run `setup-ntfy.sh` once if you want phone alerts.

Releases can change these files: v1.1.0 changed the applier and renewal check, and
v1.2.0 changed `release.py`, `familyhub-update.service`, `apply-credentials.sh` and
`update-github-tokens.sh`. The hourly updater does not replace host files.

## Notifications (ntfy)

Run `sudo bash setup-ntfy.sh` on the Pi, then subscribe to the printed topic in
the ntfy app. You then hear about:

| Event | Sent by | Priority |
| --- | --- | --- |
| A credential or certificate expires within 30 days, or cannot be checked | daily `check-renewals.sh` | high; urgent within 7 days |
| A new release was installed | hourly updater (`release.py`) | default |
| An update failed and the previous release was restored | hourly updater | high; the same failure repeats at most once a day |
| A manual rollback | `release.py rollback` | high |

On the public ntfy.sh server anyone who knows a topic can read it, so the topic
is random and messages carry only names, versions, dates and states, never a
secret. For more privacy, reserve the topic with an ntfy account and add its
access token, or point `NTFY_URL` at a self-hosted ntfy. An older
`/etc/familyhub-renewals.env` `NTFY_URL` is still honoured.

## Software updates from Settings

The server administrator can check for and install a release from Settings →
Advanced → Software updates. The app writes `inbox/update-check.json` or
`inbox/update-install.json` (no other content matters); the applier then runs
`release.py check` (lists stable releases with the read-only release token from
`github-release.env`, passed in its environment) or `release.py start-update`
(starts `familyhub-update.service` now, the same unit the hourly timer runs).
The app cannot choose a version, skip the backup or force a rollback. Status is
published as `update-status.json` in the exchange, written without following
any path there; the app re-validates every field it shows.

After this change, reinstall on the Pi: `release.py` to `/opt/familyhub/`,
`familyhub-update.service` to `/etc/systemd/system/` (then `systemctl
daemon-reload`), and `apply-credentials.sh` to `/opt/familyhub/`.

## How a token travels

```
Settings (server admin only, tailnet)          Pi host (root)
PUT /api/familyhub/admin/credentials/:kind ──▶ /opt/familyhub/admin-exchange/inbox/<kind>.json (0600)
                                                 │ familyhub-credentials.path fires
                                                 ▼
                                               apply-credentials.sh: test token → install → delete file
GET /api/familyhub/admin/credentials ◀──────── results.json + status.json (no secrets)
```

* Root never follows a path in the exchange directory (v1.1): results and the
  status file are kept in the root-only `/opt/familyhub/admin-state` (0700) and
  published into the exchange by an atomic rename of a file written through its
  own descriptor; submissions are read and deleted through a no-follow handle on
  `inbox/`, and a symlinked `inbox` is refused. Tokens reach `curl` through a
  file descriptor, never its command line.
  `update-github-tokens.sh` follows the same rules: it never uses `install -d` or
  a plain `open` inside the exchange, and shows results from `admin-state`.
* The server container sees only `/app/admin-exchange` (a bind mount of
  `/opt/familyhub/admin-exchange`). It cannot read the installed tokens,
  `/opt/familyhub/github-release.env`, Docker's login or the Cloudflare file.
* FamilyHub never stores, logs or returns a token. Only the server administrator
  (`FAMILYHUB_ADMIN_EMAIL`, else the first account created) can submit one; other parents, children and displays get 403. The LAN display
  listener does not expose these routes.
* Supported: `github-release` (fine-grained, Contents read on
  `santoshgs/familyhub`), `ghcr` (classic, `read:packages`), `cloudflare`
  (zone DNS edit). The Let's Encrypt certificate renews itself; the Tailscale
  node key is shown for information (disable key expiry in the Tailscale admin
  console).

## Removing an account

The app can remove a member from a family but cannot delete an account. To
clear a leftover login, copy `remove-account.sh` to the Pi and run it there:

```sh
sudo bash remove-account.sh --dry-run someone@example.test   # report only
sudo bash remove-account.sh someone@example.test             # back up, confirm, remove
```

Family records belong to the family owner's account, so removing an owner removes
its family's records too. The script refuses when other accounts belong to that
family. It dumps the database to `/opt/familyhub/state/pre-remove-account-*/`
first (restore with `pg_restore` if needed), and running it again reports that
the account no longer exists. Uploaded files stay in the uploads volume.

## Current expiry state (November 5, 2026)

| Item | Expires | Plan |
| --- | --- | --- |
| GitHub release token | never | Replaced with a no-expiration fine-grained token on November 2, 2026 |
| GHCR pull token | never | Replaced with a no-expiration classic `read:packages` token on November 2, 2026 |
| Frame LAN certificate | 2027-01-31 | Automatic (certbot) |
| Cloudflare DNS token | never | — |
| Tailscale node key | 2027-04-27 | Disable key expiry for the Pi (still to do) |

GitHub allows non-expiring personal tokens on personal accounts; it deletes
tokens unused for a year, which the hourly updater prevents. GHCR accepts only
classic tokens, and GitHub Apps cannot pull from it, so the image token cannot
be replaced by an auto-rotating app credential.
