# FamilyHub Ambient Display

## What it is

`/display` is a read-only, landscape-oriented dashboard served by the existing
FamilyHub application. It uses the same PostgreSQL household, Google adapters,
authentication, and OpenFamily chores as management mode. It does not introduce
a second family database. The original OpenFamily `/kiosk` route remains
available separately.

The initial cards are Calendar, Weather, Google To-dos, OpenFamily reward
chores, short daycare updates, and the next Formula 1 weekend. Parents select
the visible cards and weather location at `/display-settings`. Optional news,
travel, Bitcoin, weekly activity, and shopping cards are future work.

## Access and setup

Parents manage the display from **More → Display setup** (`/display-settings`)
on the tailnet: weather location, visible cards, night dimming, and paired
photo frames. The photo frame itself never signs in.

**Pairing a photo frame (normal path).**

1. On a phone or computer, open Display setup → **Paired displays**, enter a
   name (for example "Kitchen frame") and choose **Create pairing code**.
2. On the frame, the dashboard URL shows **Connect this frame** whenever the
   frame is not paired. Enter the 8-digit code. Codes work once and expire
   after five minutes; creating a new code cancels the previous unused one.
3. The frame switches to `/display` with an ambient read-only token bound to its
   own display session. Display setup lists it with *paired* and *last seen*
   times. **Remove** signs out that frame alone and returns it to the pairing
   screen; other devices and parent sessions are unaffected.

**Previewing on a management browser.** **Preview display** opens `/display`
in the signed-in browser without changing its session. **Start protected
display on this device** converts that browser into a display (listed as
"Browser display").

**Leaving display mode.** A display shows **Hold to exit** in its header. A
2-second press signs that browser out of display mode and reloads `/`: on the
tailnet that is the normal sign-in page; on the LAN listener every page leads
back to `/display`, so a frame shows its pairing screen. A quick tap does
nothing. A frame that is exited this way still appears under Paired displays
until it is removed there.

Any other page requested over the LAN listener redirects to `/display`, so a
signed-out or removed frame always lands on its pairing screen. Photo-frame setup, the kiosk app, brightness
and recovery are in [FRAME.md](FRAME.md).

## Display behavior

* **Detail panels.** Every card opens an in-place panel instead of navigating:
  Calendar shows the next 7 days grouped by day (Today, Tomorrow, then dates);
  To-dos shows all open tasks with due dates; Daycare shows each recent notice
  with its date and fuller text; Chores, Weather and Formula 1 keep their
  existing panels.
* **Night dimming.** Parents choose *Dim on a schedule*, a start and end time in
  the household time zone (the window may span midnight), and a night
  brightness of 0–80 % (0 shows a black screen). The display darkens itself with
  an overlay; a tap wakes it for two minutes without activating a card. The
  frame's backlight level is a separate device setting (Frameo or ADB, see
  FRAME.md).
* **News reader view.** Headlines → story → **All headlines**; closing the panel
  returns to the dashboard.
* **More indicators.** The Up next card shows the next three events (events on
  another day are labelled with the day) and a footer such as "+2 more events
  today", "4 more events this week" or "Nothing else this week". To-dos (four
  shown) and Daycare (three shown) add "+N more" when there are more.
* **Layout.** On landscape screens wider than 1040 px the dashboard is exactly
  one screen tall, so the bottom row and footer always stay visible (the target
  frame is 1280 × 800). Minimum display text is 10–11 px.
* **Session renewal.** The display renews its token on every load, whenever it
  becomes visible again, and every six hours. Tokens last seven days, so a
  frame that is used at least weekly never signs itself out.
* **Performance.** Detail panels use a solid scrim rather than a full-screen
  backdrop blur, which was slow on the frame's Rockchip GPU.
* **Refresh.** The snapshot reloads every minute and the clock every 15
  seconds. Display sessions do not open the live-update WebSocket.

## Read-only access policy

Display tokens carry the `ambient` scope and, since v0.3.1, a display-session
ID (`sid`). Auth middleware allows them only `GET /api/familyhub/ambient`,
`GET /api/familyhub/modules`, `GET /api/auth/me`, `GET /api/auth/dashboard-prefs`
and `POST /api/familyhub/display/refresh`; everything else returns 403. Every
request checks that the session still exists and has not been removed, so
removing a frame takes effect immediately. A forged or malformed `sid`, or a
`sid` on a non-ambient token, is rejected. Older ambient tokens without a
session are moved onto a new "Photo frame" session the next time they renew.

Pairing codes are created only by a parent (`requireParent`, tailnet only). The
database stores a SHA-256 hash, the code's expiry and the chosen display name;
redemption is atomic and single-use. Failed redemptions are rate limited
household-wide (20 failures per 15 minutes; successful ones do not count), so
typos cannot lock pairing while guessing an 8-digit, 5-minute code stays
impractical.

The snapshot sent to displays contains only rendered fields: event title,
location and start/end; task title and due date; daycare title, receive time,
a one-line summary and up to 900 characters of notice text for the detail
panel. Keep the photo frame physically private: authorized family information
is visible on its screen.

## Backend and data sources

| Data | Source and behavior |
| --- | --- |
| Calendar | Existing selected Google Calendar via the FamilyHub Google runtime: the next 7 days (up to 80 events), shown in the household time zone. The card lists the next four; the panel shows all, by day. |
| To-dos | Existing selected Google Tasks list via the same cached runtime; up to 40 open tasks. Due dates are calendar dates. |
| Chores | FamilyHub chores (OpenFamily `tasks` records) due today, with or without points; assigned family member names are included. Parents add and assign them under **Chores** in the navigation. Google to-dos and chores remain separate. |
| Daycare | Existing Gmail/Lillio integration cache: the five most recent notices with title, one-line summary and up to 900 characters of text for the panel. |
| Weather | Open-Meteo geocoding and forecast services. Selected city and coordinates are stored in the household's `familyhub_ambient_settings` row. Current temperature, condition, today's high/low and tomorrow's condition and high/low (shown under the current conditions) are cached in process for 20 minutes. No key is needed. The interface attributes Open-Meteo. |
| News | Opt-in **News** card. BBC News World and Technology RSS feeds, merged newest first, at most 10 headlines, cached 15 minutes. The card shows three; the panel lists all ten with a one-line summary. Tapping a story opens a reader view: the server fetches that BBC page once, extracts the article with Mozilla Readability, and sends only plain-text paragraphs, headings, list items and quotes (cached six hours). Only URLs that arrived in the feeds, on BBC hosts, are fetched; if extraction fails the panel shows the feed summary. No images or scripts from the article reach the display. BBC feeds are for personal, non-commercial use. |
| Formula 1 | Jolpica F1 Ergast-compatible schedule API. The server checks current and following season, filters for a strictly future race, returns sessions in the API's UTC schedule, and the browser displays them in the household time zone. Successful schedules are cached in process for six hours. The interface attributes Jolpica F1. |

Logo images supplied by the household go in
`client/public/assets/familyhub-brand/` (see the README there): `f1-logo.svg`
or `.png` replaces the styled "F1" text, and `team-shield.png` or `.jpg`
replaces the remote team photo. They are served from `/assets/`, so the frame
loads them without internet access. No logo artwork is drawn by FamilyHub.

The race card makes the next scheduled session prominent and shows later
weekend sessions as compact time capsules. Its car illustration is original
inline SVG artwork. The Scuderia Ferrari shield photograph is “Scuderia Ferrari
(4484419145).jpg” by Damian Morys, via Wikimedia Commons, under
[CC BY 2.0](https://creativecommons.org/licenses/by/2.0/). The browser loads Wikimedia's 120 px
thumbnail of the image from [Wikimedia Commons](https://commons.wikimedia.org/wiki/File%3AScuderia_Ferrari_%284484419145%29.jpg)
and hides it if it cannot load;
the card also names the team directly. The ambient background and weather/race
artwork use CSS and SVG rather than stock-image URLs.

### Quick bar and detail panels (v1.2)

Below the cards, a quick bar shows pills for guest Wi-Fi, a countdown, markets
and the photo slideshow; each appears only when set up in **Settings → Display**
and opens a panel in place. All data is prepared on the Pi and included in the
`extras` field of `GET /api/familyhub/ambient`: the weather panel (Open-Meteo
forecast and air quality, sun progress, moon phase and its SVG path, forecast
bar positions), Formula 1 standings (Jolpica, cached for the chosen interval),
the Wi-Fi QR code as an SVG path, the countdown target instant, market prices
and the slideshow's photo ids. The display draws these as given; it ticks only
the countdown's seconds, from the server's clock. Market prices are fetched at
9:35, 12:30 and 16:05 New York time on weekdays (and when the settings change),
so the frame never polls a market API. Photos are uploaded from a phone or
computer, decoded once on the Pi, turned upright, scaled to fit 1280 × 800 and
re-encoded without EXIF data; the frame downloads one at a time with its token
and releases the previous one. The guest Wi-Fi password is shown on the frame by
design; the market API keys never leave the server.

### Google Photos widget feasibility

Google's Ambient API is the appropriate route for a photo-frame slideshow. A
parent would authorize a Google account on behalf of the display, then select
the media sources (including albums where offered by Google Photos) in the
Google Photos app. FamilyHub could then associate that device with the family
and retrieve only its user-selected media. A shared Google account that owns or
has access to the intended family album can be used for the frame authorization;
individual family members' personal accounts do not need to be shown on the
display.

The v1.2 slideshow uses photos uploaded to the Pi instead. Google Photos is **not implemented**. Google currently requires acceptance into its
Photos Partner Program before granting Ambient API access. Standard Library API
shared-album listing is no longer available, and Picker is intended for a
user's explicit media selection rather than a continuously synchronized album.
Do not add OAuth scopes, tokens, or a simulated Photos card until partner access
and account-consent/privacy behavior are settled. See [Ambient API overview](https://developers.google.com/photos/ambient/guides/about),
[Ambient API setup flow](https://developers.google.com/photos/ambient/guides/get-started),
[Partner Program access requirements](https://developers.google.com/photos/partner-program/overview),
and [Google Photos API updates](https://developers.google.com/photos/support/updates).

Weather/F1 cache state is in server memory; a restart causes a fresh request.
The display refreshes its snapshot once a minute and its clock every 15 seconds.
Third-party data is omitted or marked unavailable when not configured or when
the source cannot be reached. The display does not fabricate sample weather.

Settings are stored by the namespaced additive migrations
`server/src/migrations/familyhub/ambient.ts` (0006) and `displaySessions.ts`
(0008, night-dimming columns) in `familyhub_ambient_settings`. Pairing codes
(0007, `displayPairing.ts`) and display sessions (0008) have their own tables. The enabled-widget list is a JSON array and
defaults to `calendar`, `weather`, `tasks`, `chores`, `daycare`, and `f1`.
Coordinates are range-checked. The schema change is backward-compatible; the
release policy records it as rollback-safe.

## API and configuration

| Method and path | Access | Purpose |
| --- | --- | --- |
| `GET /api/familyhub/ambient` | Authenticated management or display session | Household timezone, today's date, selected display widgets, and minimized card data. |
| `GET /api/familyhub/ambient/article?id=` | Management or display session; News card enabled | Reader view of a headline currently in the feed. |
| `GET /api/familyhub/ambient/photos/:id` | Management or display session | One slideshow photo (JPEG, pre-scaled to 1280 × 800). The only path-parameter route ambient tokens may read. |
| `GET/PUT /api/familyhub/dashboard/settings` | Parent/owner | v1.2 options: `weather`, `formula1`, `wifi`, `countdown`, `markets`, `photos`, plus write-only `secrets` (`wifiPassword`, `finnhubKey`, `coingeckoKey`: omit to keep, `null` to clear). Responses report only whether each secret is set. |
| `GET/POST /api/familyhub/photos`, `DELETE /api/familyhub/photos/:id`, `GET /api/familyhub/photos/:id/thumb` | Parent/owner | List, upload (raw image body, one per request, 25 MB, 200 per family), delete, thumbnail. |
| `GET /api/familyhub/ambient/settings` | Authenticated management session | Read widget and weather-location settings. |
| `PUT /api/familyhub/ambient/settings` | Parent/owner | Save `{ location: null \| { city, country, latitude, longitude }, widgets: string[], night?: { enabled, start: "HH:MM", end: "HH:MM", brightness: 0–80 } }`. Omitting `night` keeps the saved schedule. |
| `GET /api/familyhub/ambient/locations?q=Springfield` | Parent/owner | Search Open-Meteo geocoding; `q` must contain 2–80 characters. |
| `POST /api/familyhub/ambient/display-session` | Parent/owner | Turn this browser into a display (creates a "Browser display" session). |
| `POST /api/familyhub/display/pairing-code` | Parent/owner | `{ name? }` → `{ code, name, expiresInSeconds: 300 }`. Cancels the previous unused code. |
| `POST /api/familyhub/display/pair` | Unauthenticated, rate limited | `{ code }` → ambient token bound to a new display session. |
| `GET /api/familyhub/display/sessions` | Parent/owner | Paired displays: id, name, created and last-seen times. |
| `DELETE /api/familyhub/display/sessions/:id` | Parent/owner | Remove one display; its token stops working immediately. |
| `POST /api/familyhub/display/refresh` | Ambient token only | Renew the same session and read-only scope. |

The legacy `POST /api/familyhub/display-session` endpoint retains the earlier
protected overview scope for compatibility with existing clients. The Ambient
Display setup uses the narrower endpoint above.

There are no new environment variables, provider API keys, or user secrets for
this feature. Existing Google connection credentials remain in the existing
private deployment configuration and are not copied into display settings.

## Photo-frame compatibility

The household frame is a Frameo-branded 10" panel labelled 105K: Rockchip
RK312x, Android 6.0.1 (API 23, userdebug firmware), WebView 107, 1280 × 800
landscape. It boots into the open-source HomeHQ kiosk launcher
(`com.wesbos.homehq`, from Wes Bos's photo-frame-dashboard), which loads the
saved dashboard URL full-screen and shows its own offline screen with retry
when the dashboard cannot be reached. The frame reaches the Pi over the home
network through the LAN display listener; it has no Tailscale client. Setup,
recovery and day-to-day commands are in [FRAME.md](FRAME.md).

The dashboard was checked in a browser at 1280 × 800 with fictional data
(display, every detail panel, night dimming, pairing screen and Display setup).
Long-duration burn-in on the physical frame and native iOS Safari keyboard
verification are still outstanding.

## Source links

- [Open-Meteo API documentation](https://open-meteo.com/en/docs) and
  [terms](https://open-meteo.com/en/terms) (personal non-commercial use and
  attribution requirements apply).
- [Jolpica F1 API documentation](https://api.jolpi.ca/docs/) and
  [project](https://github.com/jolpica/jolpica-f1).
- [Scuderia Ferrari shield photo attribution](https://commons.wikimedia.org/wiki/File%3AScuderia_Ferrari_%284484419145%29.jpg):
  Damian Morys, CC BY 2.0.
- [Wes Bos Photo Frame Dashboard](https://github.com/wesbos/photo-frame-dashboard):
  source of the HomeHQ kiosk launcher installed on the frame.
- The [requested X visual reference](https://x.com/software_chef/status/2110113979439927740)
  was not retrievable during implementation; the dark card design follows the
  visual requirements supplied in the project request.
