# Troubleshooting

[Knowledge base index](README.md) · [Pi deployment](07-raspberry-pi.md) · [Networking](08-tailscale-networking.md)

Start by separating the app login, Google account, Pi login and Tailscale connection. They are distinct. Never post passwords, tokens, OAuth authorization codes, database dumps, daycare messages or unreviewed logs in chat or issues.

## Safari: server cannot be found

1. Confirm the Pi is powered on and connected. On a Tailscale-connected device, confirm the Pi appears online.
2. Confirm the affected phone/tablet itself says Tailscale is connected to the same tailnet.
3. Use the exact HTTPS hostname reported by `tailscale serve status` on the Pi.
4. If the device sees the Pi but the hostname does not resolve, check whether Tailscale DNS/MagicDNS is applied on that device. A the DNS resolver DNS configuration caused this exact symptom during initial iOS acceptance; temporarily disabling it isolated the conflict. See [networking](08-tailscale-networking.md).
5. On the Pi, inspect `tailscale status`, `tailscale dns status`, `tailscale serve status` and container health. Do not bypass a certificate warning.

If the Pi itself can open the HTTPS endpoint but the phone cannot, that does not prove the phone's DNS or tailnet settings are correct.

## Photo frame

| Symptom | Fix |
| --- | --- |
| Sample dashboard marked "Placeholder · offline" | The kiosk has no saved URL: `deploy/familyhub/frame/frame.sh url https://frame.example.com/display` |
| "Can't reach the dashboard" | Check the Pi (`systemctl status caddy`), Wi-Fi, and that `frame.example.com` resolves to the Pi's LAN address |
| Pairing screen instead of the dashboard | The frame was removed, idle over a week, or exited: pair it again from Settings → Display |
| "Use … as Home" prompt | Choose Home HQ → Always |
| Frameo covers the dashboard after a restart | `frame.sh frameo-settings` → Disable, then `frame.sh home` |

More in [the photo frame](16-photo-frame.md) and the [frame runbook](../docs/familyhub/FRAME.md).

## Frame extras (v1.2): a pill or panel is missing

| Symptom | Fix |
| --- | --- |
| No Wi-Fi, countdown, markets or photos pill on the quick bar | A pill appears only once that feature is switched on and filled in under **Settings → Display** (parents) |
| Markets pill empty | Stocks need a Finnhub API key in Settings → Display; the key is write-only, so re-enter it to replace it |
| Photos do not load on the frame | The LAN listener must allow the photo route added in v1.2: re-run `apply-lan-display.sh` from the Mac. Any other API path on that listener answers 404 by design |
| Wi-Fi password or API key "disappeared" | Secrets are write-only: the page shows only whether one is set; leave the field blank to keep it |
| Photos rejected | One image per upload, up to 25 MB, up to 200 per household |

## Formula 1 card says "temporarily unavailable"

Since v1.5.3 the card keeps the last good race calendar when one refresh of the Jolpica schedule fails, so it should not go blank after a single failure. The server retries in five minutes and logs `familyhub.f1_schedule_failed` with the reason. On November 6, 2026 the card showed the message while Jolpica and the server's own fetch and parser worked by hand; it then recovered without a fix. If it persists, check the log and the source from inside the server container (service name `server` in `deploy/familyhub/compose.yml`; use the Jolpica URL in `server/src/services/familyhub/ambient.ts`):

```sh
docker compose --env-file <deployment env file> -f deploy/familyhub/compose.yml logs --tail 200 server | grep f1_schedule_failed
docker compose --env-file <deployment env file> -f deploy/familyhub/compose.yml exec server node -e "fetch(process.argv[1]).then(r => console.log(r.status))" <jolpica-url>
```

If the message stays after a restart, check the Pi's internet access and the logged reason.

## Restarting the server

If the app seems stuck, use **Settings → Advanced → Restart Family Hub** (server administrator; v1.5.3). The page waits and reloads. On the Pi, `sudo python3 /opt/familyhub/release.py restart --state-dir /opt/familyhub/state --env-file /opt/familyhub/private.env` does the same (the arguments follow the other `release.py` commands in [releases](09-releases-updates.md)). Docker's `unless-stopped` policy brings the server back; the database and gateway keep running.

## A module opens Settings or answers 403

Since v1.0 a module that a parent has switched off is closed on the server (403 `MODULE_DISABLED`) and its page redirects to Settings. A parent turns it back on with **Enabled** in **Settings → Modules**; the records were kept. If it is on but missing from your own menu, tick **Show**.

## Signed out after the v1.1.0 update

Joining a family by invitation or request now ends the account's older sessions, and members who joined that way before v1.1.0 are asked to sign in again once. This is expected. If a member still cannot sign in, use the recovery tool in [accounts and access](03-accounts-and-access.md).

## Settings → Software updates does nothing

Only the server administrator sees and can use it (`FAMILYHUB_ADMIN_EMAIL`, otherwise the first account created). It also needs the updated `release.py`, `familyhub-update.service` (then `systemctl daemon-reload`) and `apply-credentials.sh` on the Pi, which a normal release does not install by itself; see [releases](09-releases-updates.md). The Pi still decides the version; if an install fails the previous release is restored and the failure is not retried automatically.

## Clicking the calendar or to-dos used to sign me out

Before v1.4.2, when the Google connection needed re-authorizing the server answered with the same status as an expired sign-in, and the app signed out. Since v1.4.2 the Home page says that Google needs reconnecting and offers **Reconnect Google**; your sign-in is unaffected. A Google Cloud project left in **Testing** expires the authorization after 7 days; publishing the OAuth app (an unverified personal app is fine) stops that.

## ntfy alerts do not arrive

ntfy is off until `sudo bash setup-ntfy.sh` is run on the Pi (it needs `notify.sh` beside it, installed in `/opt/familyhub/`). Then subscribe to the printed topic in the ntfy app.

## A browser is stuck on the display

A browser that was put into display mode always returns to `/display`. Hold **Hold to exit** for two seconds (v0.3.2 and later), or use a private window to sign in.

## Family Hub sign-in

Use the Family Hub login email and password, not the Pi password or necessarily the dedicated Google account. If a password is forgotten, the Pi operator can use the interactive recovery tool in [accounts and access](03-accounts-and-access.md); it signs the account out of all devices. Do not reveal password hashes or create a new account without understanding household ownership.

For `Permission denied (publickey)` over SSH, use the dedicated Pi deployment key explicitly with `IdentitiesOnly=yes` and the verified host-key file. The fresh OS initially used port 22, not the old installation's custom port. See [Pi deployment](07-raspberry-pi.md). A changed host key after reinstall must be verified independently, not blindly accepted.

If typing at the Pi console produces the wrong characters, inspect the keyboard layout and Caps Lock. A Canadian layout was initially selected; the owner switched to English (US) using `sudo raspi-config` → Localisation → Keyboard. Test punctuation at a non-secret prompt, never by exposing your password.

## Google Calendar or Tasks

Check the Google connection status, displayed dedicated account, selected shared calendar/list, source permissions, freshness label and household time zone. A stale cache may remain visible after a provider error. Verify the exact HTTPS callback in the Google OAuth web client and whether the account remains a permitted test user. Calendar event creation requires write access to the selected calendar. For Google Tasks, switch the native app to the same dedicated account.

Reconnect if consent was revoked or a Testing-mode refresh token expired. If a specific operation fails, record only sanitized error text and verify whether the change reached Google before retrying. See [Google Calendar and Tasks](04-google-calendar-tasks.md).

## Daycare is empty

Confirm optional Gmail consent, the dedicated mailbox, the actual sender, whether recent messages contain details, and any stale/error indicator. A sender filter is not a mailbox permission restriction. Fictional simulations passed; real Lillio/HiMama messages still require acceptance. Do not share the child's messages while troubleshooting. See [daycare](05-daycare-gmail.md).

## AI provider fails

Check the provider URL from the server container, model availability, credentials and the sanitized provider error. An Ollama model must actually be installed and running; a name in settings is not an installation. Gemini previously showed blocked-method and provider-availability/timeout errors and was deferred; no successful inference is recorded. See [AI assistant](06-ai-assistant.md).

## Local Mac port already in use

`EADDRINUSE 127.0.0.1:53001` usually means the local backend is already listening. The local runner starts frontend and backend together; avoid starting a duplicate. Identify the owner of the port before stopping it:

```sh
lsof -nP -iTCP:53001 -sTCP:LISTEN
```

The normal authenticated local frontend uses port 5174; PostgreSQL uses 55432. `dev:familyhub:local` and `dev:familyhub:develop` share these ports, so run only one of them. Do not restart the Mac live-data backend alongside the Pi's Google synchronizer without a cutover plan. Avoid killing unrelated processes.

## Updates or service health

Compare the version in the display or Settings footer ("Family Hub vX.Y.Z") with the latest release to see whether an update was installed. Check container health and the update service/timer using the commands in [releases](09-releases-updates.md). A revoked or deleted GitHub token stops private pulls/checks; Settings → Advanced → Server credentials shows whether each token still works. Phone alerts for update failures need ntfy, which is not set up yet (`setup-ntfy.sh`). If a release fails or a rollback is needed, pause the timer, preserve data and consult [backup and recovery](10-backup-recovery.md) before making changes. A rollback does not undo database migrations or Google writes.
