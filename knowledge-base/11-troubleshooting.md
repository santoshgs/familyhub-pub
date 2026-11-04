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
| Pairing screen instead of the dashboard | The frame was removed, idle over a week, or exited: pair it again from Display setup |
| "Use … as Home" prompt | Choose Home HQ → Always |
| Frameo covers the dashboard after a restart | `frame.sh frameo-settings` → Disable, then `frame.sh home` |

More in [the photo frame](16-photo-frame.md) and the [frame runbook](../docs/familyhub/FRAME.md).

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

Compare the version in the display or Settings footer ("Family Hub vX.Y.Z") with the latest release to see whether an update was installed. Check container health and the update service/timer using the commands in [releases](09-releases-updates.md). A revoked or deleted GitHub token stops private pulls/checks; Settings → Advanced → Server credentials shows whether each token still works. Automatic update-failure notifications are not configured. If a release fails or a rollback is needed, pause the timer, preserve data and consult [backup and recovery](10-backup-recovery.md) before making changes. A rollback does not undo database migrations or Google writes.
