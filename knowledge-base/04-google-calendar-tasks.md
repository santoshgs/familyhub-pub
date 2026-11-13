# Google Calendar and Tasks

[Knowledge base index](README.md) · [Daycare](05-daycare-gmail.md) · [AI assistant](06-ai-assistant.md)

The household connection uses one **dedicated Google account**. Family Hub verifies the account's Google identity against the server's configured expected account. Calendar and Tasks stay authoritative in Google; the database holds disposable snapshots and encrypted connection credentials, not independent authoritative copies.

## What the integration can do

- List eligible calendars, read the selected shared calendar, and create, edit and delete events in it (v1.5.0; parents only). The dedicated account needs permission to make event changes. A change to a repeating event affects only that occurrence.
- Event colours: Google stores the colour of each event, but its API does not expose colour names. Family Hub keeps its own **Calendar colours** legend (parent-editable labels, stored for the household), so the colour picker and calendar show the household's names, for example "Blue: Alex". Changing a label does not change the Google event.
- List task lists and read, create, edit, complete, reopen and delete tasks in the selected list. Switch to the dedicated account in the native Google Tasks app to see the same list.
- Use the selected sources and household time zone for the dashboard and full calendar. Google Tasks scheduling is date-only in this integration.
- Display the last successful snapshot as stale if a source fails. Calendar/Tasks snapshots normally have a 60-second freshness window, with periodic refresh. A stale label is not confirmation that a recent Google change succeeded.

The calendar UI does not combine every calendar in the account; it works with the one saved calendar. Its month/week/day range is bounded. Google is still the place for anything Family Hub does not expose.

## Cloud setup and consent

The owner has configured a Google Cloud web OAuth client and registered the Pi HTTPS callback. For another deployment, enable the Calendar and Tasks APIs, configure the OAuth consent audience/test users as appropriate, and add the **exact** callback for that deployment:

```text
https://<your-tailnet-hostname>/api/familyhub/google/callback
```

The local Mac callback is a different URI. The scheme, host, port and path must match the server configuration; no trailing slash should be invented. Supply client ID, client secret, expected dedicated email and a separate Google token encryption key as server-side configuration, never as frontend build variables. The private deployment environment resides on the Pi under `/opt/familyhub/`; do not print or commit it.

As a signed-in parent, open the Google connection settings, complete Google consent for the dedicated account, confirm the displayed identity, select the shared calendar and task list, and set the household time zone. Gmail consent is separate and optional. A wrong Google account should be rejected; display sessions cannot manage the connection or write.

OAuth uses state, nonce and PKCE. The saved connection is bound to the verified Google subject and email. `FAMILYHUB_TOKEN_KEY` is independent of `JWT_SECRET`; preserving it with the database is necessary to decrypt saved Google credentials.

## Verify and troubleshoot

The owner confirmed Calendar events and To-Dos appear on the deployed Pi. Additional acceptance should include a clearly labeled disposable event, a task create/complete/reopen round trip in Google's own apps, all-day/DST behavior, and reconnection after consent expiry or revocation. Delete test records deliberately afterward in the appropriate source.

If connection fails, check the exact redirect URI in Cloud Console, the configured expected Google account, API enablement, consent/test-user settings and selected source permissions. An external OAuth app in Testing receives refresh tokens that expire after seven days for these scopes, so the connection has to be renewed weekly. Signing in no longer uses Google (removed in v1.4.2), but this connection still does, so publish the app to **In production** in Google Auth Platform → Audience and reconnect once (see [GOOGLE_SETUP](../docs/familyhub/GOOGLE_SETUP.md#testing-mode-restricted-gmail-access-and-long-running-use)). Shopping lists (v1.6.0) use the same Tasks permission; any task list chosen in Settings → Household becomes a shopping list. Do not share OAuth codes, client secrets, tokens, or callback URLs containing codes. See [the original setup notes](../docs/familyhub/GOOGLE_SETUP.md) for the full scope list and [Google's OAuth documentation](https://developers.google.com/identity/protocols/oauth2/web-server).
