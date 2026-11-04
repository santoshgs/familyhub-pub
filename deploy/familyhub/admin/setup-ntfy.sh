#!/usr/bin/env bash
# Set up push notifications for the Pi (renewals, updates, failed updates).
# Run on the Pi: sudo bash setup-ntfy.sh
# Creates /etc/familyhub-notify.env (root, 0600), sends a test push, and prints
# the topic to subscribe to in the ntfy app (iOS/Android) or at ntfy.sh.
#
# On the public ntfy.sh server anyone who knows a topic name can read it, so the
# topic is long and random and messages never carry secrets. For more privacy,
# reserve the topic with an ntfy account and add an access token, or point
# NTFY_URL at a self-hosted ntfy server.
set -euo pipefail
[[ ${EUID} -eq 0 ]] || { echo "Run with sudo." >&2; exit 2; }
HERE=$(cd "$(dirname "$0")" && pwd)
FILE=/etc/familyhub-notify.env
current=$( [[ -r $FILE ]] && sed -n 's/^NTFY_URL=//p' "$FILE" | tail -1 || true)
default=${current:-https://ntfy.sh/familyhub-$(openssl rand -hex 12)}
read -rp "ntfy topic URL [$default]: " url; url=${url:-$default}
[[ $url == https://*/* ]] || { echo "Use an https:// URL ending in a topic name." >&2; exit 1; }
read -rsp 'Access token (optional, Enter for none): ' token; echo
umask 077
tmp=$(mktemp "$FILE.XXXXXX")
{ printf 'NTFY_URL=%s\n' "$url"; [[ -n $token ]] && printf 'NTFY_TOKEN=%s\n' "$token"; } > "$tmp"
chmod 0600 "$tmp"; mv "$tmp" "$FILE"; unset token
install -m 0755 "$HERE/notify.sh" /opt/familyhub/notify.sh
/opt/familyhub/notify.sh "Family Hub" "Notifications are working. You'll hear about renewals, updates and failed updates." default tada
echo
echo "Saved $FILE and sent a test push."
echo "Subscribe in the ntfy app to: $url"
