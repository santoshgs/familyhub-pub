# Pi admin helpers: renewals, notifications, sign-in and server credentials

Host-side helpers (run as root on the Pi) behind **Settings → Advanced → Server
credentials** in FamilyHub, plus a daily expiry check.

| File | Installed as | Purpose |
| --- | --- | --- |
| `check-renewals.sh` | `/opt/familyhub/check-renewals.sh` | Lists every credential/certificate the Pi depends on with its expiry. Exit 1 when anything expires within 30 days or cannot be checked. Pushes through `notify.sh` when action is needed (urgent within 7 days). With `STATUS_JSON=<file>` it also writes a secret-free status file for the app. |
| `familyhub-renewals.service` / `.timer` | `/etc/systemd/system/` | Runs the check daily at about 09:17 and refreshes the app's status file. |
| `apply-credentials.sh` | `/opt/familyhub/apply-credentials.sh` | Applies tokens submitted from Settings. Tests each token, replaces the current one only if it works, deletes the submission, writes the outcome to `results.json`. |
| `familyhub-credentials.path` / `.service` | `/etc/systemd/system/` | Starts the applier as soon as a submission appears. |
| `update-github-tokens.sh` | `/opt/familyhub/update-github-tokens.sh` | Terminal alternative: hidden prompts, same applier. |
| `notify.sh` | `/opt/familyhub/notify.sh` | Sends one ntfy push. Best effort, never fails its caller, keeps any access token off the command line. |
| `setup-ntfy.sh` | run once with sudo | Creates `/etc/familyhub-notify.env` (0600) with a long random topic and optional token, installs `notify.sh`, sends a test push. |
| `google-signin.sh` | run with sudo | `enable`, `google-only`, `passwords-on`, `disable`, `status` for sign in with Google. See [GOOGLE_SIGNIN](../../../docs/familyhub/GOOGLE_SIGNIN.md). |

Install or update from the Mac with `.familyhub-local/pi/install-admin.sh` (it
copies these files and asks for the Pi password once).

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

## How a token travels

```
Settings (owner only, tailnet)                 Pi host (root)
PUT /api/familyhub/admin/credentials/:kind ──▶ /opt/familyhub/admin-exchange/inbox/<kind>.json (0600)
                                                 │ familyhub-credentials.path fires
                                                 ▼
                                               apply-credentials.sh: test token → install → delete file
GET /api/familyhub/admin/credentials ◀──────── results.json + status.json (no secrets)
```

* The server container sees only `/app/admin-exchange` (a bind mount of
  `/opt/familyhub/admin-exchange`). It cannot read the installed tokens,
  `/opt/familyhub/github-release.env`, Docker's login or the Cloudflare file.
* FamilyHub never stores, logs or returns a token. Only the household owner can
  submit one; other parents, children and displays get 403. The LAN display
  listener does not expose these routes.
* Supported: `github-release` (fine-grained, Contents read on
  `santoshgs/familyhub`), `ghcr` (classic, `read:packages`), `cloudflare`
  (zone DNS edit). The Let's Encrypt certificate renews itself; the Tailscale
  node key is shown for information (disable key expiry in the Tailscale admin
  console).

## Current expiry state (November 2, 2026)

| Item | Expires | Plan |
| --- | --- | --- |
| GitHub release token | 2026-11-29 | Replace with a no-expiration fine-grained token |
| GHCR pull token | 2027-01-27 | Replace with a no-expiration classic `read:packages` token |
| Frame LAN certificate | 2027-01-31 | Automatic (certbot) |
| Cloudflare DNS token | never | — |
| Tailscale node key | 2027-04-27 | Disable key expiry for the Pi |

GitHub allows non-expiring personal tokens on personal accounts; it deletes
tokens unused for a year, which the hourly updater prevents. GHCR accepts only
classic tokens, and GitHub Apps cannot pull from it, so the image token cannot
be replaced by an auto-rotating app credential.
