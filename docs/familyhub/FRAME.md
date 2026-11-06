# Photo frame runbook

The kitchen photo frame shows the read-only FamilyHub display. This page covers
the device, how it reaches the Pi, pairing, brightness and recovery. Display
features and the access policy are in [AMBIENT_DISPLAY.md](AMBIENT_DISPLAY.md);
the Pi side is in [`deploy/familyhub/lan-display`](../../deploy/familyhub/lan-display/README.md).

## Device

| Item | Value |
| --- | --- |
| Hardware | Frameo-branded 10" frame labelled 105K, Rockchip RK312x board |
| Android | 6.0.1 (API 23). The build fingerprint says `userdebug`, but `adb root` is refused ("production build"), so ADB runs as the unprivileged shell user |
| Browser engine | Android System WebView 107 (since v1.2 the client also builds for Chromium 104, for margin) |
| Screen | 1280 × 800 landscape, always on (screen-off timeout disabled) |
| Home screen | HomeHQ kiosk launcher (`com.wesbos.homehq`), set as the **Always** home app |
| Frameo app | `net.frameo.frame`: unhidden but still **disabled**; it can be enabled from its App info screen (see below) |
| Disabled | System UI (status bar, notification shade and the Settings brightness slider), firmware updater `com.adups.fota` (hidden) |

Addresses and MAC addresses are kept out of this repository. The router
reserves the frame's and the Pi's addresses.

## How the frame reaches FamilyHub

```
frame ──Wi-Fi──▶ https://frame.example.com/display
                 │  public DNS "A" record (Cloudflare, DNS only) = Pi's LAN address
                 ▼
Pi: host Caddy bound to the LAN address, Let's Encrypt certificate
    allowlist: display pages, static assets, 4 display reads, pair + refresh
    every other page → 302 /display; every other API path → 404
                 ▼
127.0.0.1:8080 (the FamilyHub containers; the same service Tailscale Serve uses)
```

* The DNS name is public but points at a private address: nothing outside the
  home network can connect to it, and inside it the Pi's firewall accepts HTTPS
  only from the frame's reserved address.
* The frame uses ordinary DNS (Wi-Fi **IP settings: DHCP**). It no longer needs
  the Pi as its DNS server; the earlier Pi-hosted resolver and the Android DNS
  override it required are retired.
* Management (sign-in, Display setup, pairing codes) is only on the tailnet
  address. The frame cannot reach it.

## Kiosk (HomeHQ)

HomeHQ is the frame's launcher, so it starts on boot. It opens its saved
dashboard URL full-screen, retries every few seconds with a "Can't reach the
dashboard" screen when the Pi is unreachable, and has a small floating
**Back / Dashboard** bar. Until a URL is saved it shows a built-in sample
dashboard marked "Placeholder · offline".

The saved URL is `https://frame.example.com/display`. HomeHQ saves a URL only
when it is passed as the `url` string extra (`am start … --es url URL`); a plain
VIEW intent opens it once and the next restart shows the placeholder again. To
set or change it:

```sh
deploy/familyhub/frame/frame.sh url https://frame.example.com/display
```

If Android asks which app to use as Home (for example after an app is enabled),
choose **Home HQ → Always**; otherwise the frame can stop at that chooser after a
restart.

## Pairing and recovery

1. On a phone or computer on the tailnet: FamilyHub → Display setup →
   **Paired displays** → name the frame → **Create pairing code**.
2. On the frame: enter the 8-digit code on **Connect this frame**.

The frame renews its session whenever the dashboard loads and every six hours.
If it was off for more than a week, a parent removed it, or someone held its
**Hold to exit** button for two seconds, it shows the pairing screen again:
repeat the two steps. No password is ever typed on the frame.

## Brightness and Frameo settings

The Android Settings brightness slider does not work because it belongs to the
disabled System UI. Use either:

* **ADB** — `frame.sh brightness 0-255` sets the backlight directly. The level
  persists across restarts.
* **Frameo app** — Frameo is unhidden but disabled. Without `adb root` the shell
  cannot enable it or switch off its boot receivers, so it is enabled by hand:
  `frame.sh frameo-settings` opens its App info screen on the frame; tap
  **Enable**, then `frame.sh frameo` to open it. Because its boot receivers
  stay active, check after the next restart that it does not cover the
  dashboard. Frameo updates itself while it is enabled and online; the firmware
  updater (`com.adups.fota`) stays hidden. To return to the previous state, tap
  **Disable** on the same App info screen.

FamilyHub's own night dimming (Display setup → Night mode) darkens the dashboard
on a schedule on top of whatever backlight level is set here.

## ADB

The frame is connected to the Mac over USB with USB debugging enabled. Install
the tools with `brew install --cask android-platform-tools`. Everyday commands:

| Command | What it does |
| --- | --- |
| `frame.sh home` | Return to the dashboard |
| `frame.sh reload` | Restart the kiosk and reload the dashboard |
| `frame.sh frameo` | Open the Frameo app |
| `frame.sh brightness N` | Backlight 0–255 |
| `frame.sh url URL` | Save the kiosk's dashboard URL (prints `Saved kiosk URL` when it worked) |
| `frame.sh frameo-settings` | Open Frameo's App info screen to enable or disable it |
| `frame.sh screenshot` | Save a screenshot on the Mac (contains household data; do not commit) |

One-off setup and diagnosis scripts used on November 2, 2026 live in the
owner's private `.familyhub-local/frame/` folder and are not committed. The
shell user can hide/unhide packages and change settings, but cannot change an
app's enabled state; use the App info screen for that.

## Troubleshooting

| Symptom | Likely cause and fix |
| --- | --- |
| Sample dashboard with "Placeholder · offline" | No URL saved in HomeHQ: `frame.sh url https://frame.example.com/display` |
| "Can't reach the dashboard" | Pi or Caddy down, Wi-Fi down, or DNS. On the Pi: `systemctl status caddy familyhub-firewall`. From the frame's network the name must resolve to the Pi's LAN address. |
| `ERR_SSL_PROTOCOL_ERROR` in `adb logcat \| grep HomeHQ` | The Pi is not serving the `frame.` certificate: rerun the LAN apply script. |
| Pairing screen instead of the dashboard | Session removed or older than a week: pair again. |
| "Use … as Home" chooser | Choose Home HQ → Always. |
| Frameo covers the dashboard after a restart | Frameo is enabled and starts at boot: `frame.sh frameo-settings` → **Disable**, then `frame.sh home`. |
