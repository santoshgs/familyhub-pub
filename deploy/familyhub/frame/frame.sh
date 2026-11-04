#!/usr/bin/env bash
# Everyday frame helpers over ADB.
#   frame.sh frameo           open the Frameo app (brightness, sleep, display settings)
#   frame.sh brightness N     set the backlight directly, N = 0-255
#   frame.sh home             return to the FamilyHub dashboard
#   frame.sh reload           restart the kiosk (reloads the dashboard)
#   frame.sh url URL          save the dashboard URL the kiosk opens (survives restarts)
#   frame.sh frameo-settings  open Frameo's App info screen (Enable / Disable it there)
#   frame.sh screenshot       save a screenshot next to this script
set -euo pipefail
ADB="$(command -v adb || ls /opt/homebrew/bin/adb "$HOME/Library/Android/sdk/platform-tools/adb" /usr/local/bin/adb 2>/dev/null | head -1)"
DIR="$(cd "$(dirname "$0")" && pwd)"
case "${1:-}" in
  frameo) "$ADB" shell monkey -p net.frameo.frame -c android.intent.category.LAUNCHER 1 >/dev/null ;;
  brightness) [[ ${2:-} =~ ^[0-9]+$ && $2 -le 255 ]] || { echo "brightness 0-255"; exit 2; }
    "$ADB" shell settings put system screen_brightness_mode 0; "$ADB" shell settings put system screen_brightness "$2" ;;
  home) "$ADB" shell am start -a android.intent.action.MAIN -c android.intent.category.HOME >/dev/null ;;
  reload) "$ADB" shell am force-stop com.wesbos.homehq; "$ADB" shell am start -a android.intent.action.MAIN -c android.intent.category.HOME >/dev/null ;;
  # HomeHQ saves a URL only when it arrives as the "url" string extra; a plain
  # VIEW intent opens it once and is forgotten on the next restart.
  url) "$ADB" shell am start -n com.wesbos.homehq/.MainActivity --es url "${2:?url}" >/dev/null
       sleep 3; "$ADB" logcat -d -s HomeHQ:I | grep 'Saved kiosk URL' | tail -1 ;;
  frameo-settings) "$ADB" shell am start -a android.settings.APPLICATION_DETAILS_SETTINGS -d package:net.frameo.frame >/dev/null ;;
  screenshot) f="$DIR/frame-$(date +%Y%m%d-%H%M%S).png"; "$ADB" exec-out screencap -p > "$f"; echo "$f" ;;
  *) sed -n 2,10p "$0"; exit 2 ;;
esac
