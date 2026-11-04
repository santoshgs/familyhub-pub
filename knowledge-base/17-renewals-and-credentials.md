# Renewals and credentials

[Knowledge base index](README.md) · [Releases and updates](09-releases-updates.md) · [Security and privacy](13-security-privacy.md)

The Pi depends on a few tokens and certificates. This page lists them, how each
renews, and how to replace one. Current state (November 2, 2026): **nothing
needs manual renewal except the Tailscale node key**, which can be switched to
never expire.

| Item | Used for | Renews | State |
| --- | --- | --- | --- |
| GitHub release token | The updater lists and downloads releases | Manual — set to **no expiration** | No expiry |
| GHCR pull token | The updater pulls the app images | Manual — set to **no expiration** | No expiry |
| Frame certificate (`frame.example.com`) | HTTPS for the photo frame | Automatic (certbot, Cloudflare DNS) | Expires 2027-01-31, renews ~30 days before |
| Cloudflare DNS token | Lets certbot renew that certificate | No expiry | — |
| Tailscale node key | The Pi on the tailnet (management, Serve certificate) | Disable key expiry in the Tailscale admin console | 2027-04-27 |
| Tailscale Serve certificate | HTTPS for management | Automatic | — |
| Google OAuth consent | Calendar, Tasks, Gmail | Reconnect in FamilyHub if Google revokes it (Testing-mode apps expire weekly) | — |

GitHub tokens cannot be renewed by software: GitHub only creates them in its
website, and its container registry accepts only classic personal tokens (GitHub
Apps cannot pull from it). On a personal account both token types may be set to
never expire; GitHub deletes tokens unused for a year, which the hourly updater
prevents. Both tokens are read-only and narrowly scoped.

## Where to see it

**Settings → Advanced → Server credentials** (household owner only, collapsed by
default) shows the same list with days left. The Pi refreshes it daily, or
choose **Check now**.

*Expiry date, days left and a **Replace** button for each credential (screenshot omitted).*

## Replacing a token

**From the browser:** Settings → Advanced → Server credentials → **Replace** on
the row. The card links to the right GitHub or Cloudflare page and lists the
settings to choose. Paste the token and choose **Test and save**. Within a few
seconds the row reports "Updated … Saved" or "Not updated … Nothing changed".

**From the Mac's terminal:** `.familyhub-local/pi/update-github-tokens.sh`
(hidden prompts on the Pi, one sudo password).

Either way the Pi tests the token first and keeps the working one if the new one
fails. Delete the old token in GitHub or Cloudflare afterwards.

| Token | Create it at | Settings |
| --- | --- | --- |
| GitHub release | [Fine-grained tokens](https://github.com/settings/personal-access-tokens/new) | No expiration · only `santoshgs/familyhub` · Contents: Read-only |
| GHCR | [Classic tokens](https://github.com/settings/tokens/new?scopes=read:packages&description=FamilyHub%20Pi%20GHCR) | No expiration · `read:packages` only |
| Cloudflare | [API tokens](https://dash.cloudflare.com/profile/api-tokens) | "Edit zone DNS" template · zone `example.com` |

## How it works (and why it is safe)

```
Settings (owner, tailnet) ──PUT──▶ server container ──0600 file──▶ /opt/familyhub/admin-exchange/inbox/
                                                                      │  familyhub-credentials.path (root)
                                                                      ▼
                                       apply-credentials.sh: test → install → delete → results.json
Settings ◀──GET── server container ◀── status.json + results.json (no secrets)
```

* FamilyHub never stores, logs or returns a token. The server container can
  write submissions and read status, but cannot read installed credentials.
* Only the household owner can use it; parents, children and displays get 403,
  and the frame's LAN listener does not expose it.
* The Pi side is in [`deploy/familyhub/admin/`](../deploy/familyhub/admin/README.md);
  install or update it from the Mac with `.familyhub-local/pi/install-admin.sh`.

## Daily check and notifications

`familyhub-renewals.timer` runs `check-renewals.sh` every morning. It warns 30
days before anything expires (exit status 1, visible with
`systemctl status familyhub-renewals.service`). For a phone notification, install
the [ntfy](https://ntfy.sh) app, subscribe to a private topic name, and on the Pi:

```sh
echo 'NTFY_URL=https://ntfy.sh/<your-private-topic>' | sudo tee /etc/familyhub-renewals.env
sudo chmod 600 /etc/familyhub-renewals.env
```
