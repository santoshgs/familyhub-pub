#!/usr/bin/env bash
# Report how long each credential and certificate the Pi depends on remains
# valid. Run as root. Never prints a secret. Exit status 1 when anything expires
# within WARN_DAYS (default 30) or cannot be checked.
#
# Optional notifications through ntfy: set up with setup-ntfy.sh (writes
# /etc/familyhub-notify.env); a push goes out when action is needed, urgent
# within URGENT_DAYS (default 7). /etc/familyhub-renewals.env still works.
# STATUS_JSON=<file> also writes the results (no secrets) for FamilyHub's
# Settings → Advanced → Server credentials.
set -uo pipefail
[[ ${EUID} -eq 0 ]] || { echo "Run with sudo." >&2; exit 2; }
WARN_DAYS=${WARN_DAYS:-30}
URGENT_DAYS=${URGENT_DAYS:-7}
URGENT=0
[[ -r /etc/familyhub-renewals.env ]] && . /etc/familyhub-renewals.env
NOW=$(date +%s); ALERTS=(); ROWS=(); JSON_ROWS=()

row() { # kind, name, expiry (epoch|never|unknown), note
	local kind=$1 name=$2 when=$3 note=${4:-} days status state iso=null
	case $when in
		never) status="no expiry"; days="-"; state=ok ;;
		unknown|'') status="CHECK MANUALLY"; days="?"; state=unknown; ALERTS+=("$name: could not determine expiry ($note)") ;;
		*) days=$(( (when - NOW) / 86400 )); status="$(date -d "@$when" '+%Y-%m-%d')"; iso="\"$(date -u -d "@$when" '+%Y-%m-%dT%H:%M:%SZ')\""; state=ok
		   (( days < WARN_DAYS )) && { state=warn; ALERTS+=("$name expires $status ($days days)"); }
		   (( days < URGENT_DAYS )) && URGENT=1 ;;
	esac
	ROWS+=("$(printf '%-34s %-12s %6s  %s' "$name" "$status" "$days" "$note")")
	JSON_ROWS+=("$(python3 -c 'import json,sys; k,n,e,s,note=sys.argv[1:]; print(json.dumps({"kind":k,"name":n,"expiresAt":json.loads(e),"state":s,"note":note}))' "$kind" "$name" "$iso" "$state" "$note")")
}
gh_expiry() { # token -> epoch|never|unknown from GitHub's expiry header
	local headers exp
	headers=$(curl -s -o /dev/null -D - -m 15 -H @<(printf 'Authorization: Bearer %s\n' "$1") https://api.github.com/user 2>/dev/null) || { echo unknown; return; }
	grep -qE '^HTTP/[0-9.]+ 200' <<<"$headers" || { echo unknown; return; }
	exp=$(grep -i '^github-authentication-token-expiration:' <<<"$headers" | cut -d' ' -f2- | tr -d '\r')
	[[ -z $exp ]] && { echo never; return; }
	date -d "$exp" +%s 2>/dev/null || echo unknown
}

# 1. GitHub release-download token used by the updater (gh, GH_TOKEN).
if [[ -r /opt/familyhub/github-release.env ]]; then
	GH_TOKEN=$(. /opt/familyhub/github-release.env >/dev/null 2>&1; printf '%s' "${GH_TOKEN:-}")
	if [[ -n $GH_TOKEN ]]; then row github-release "GitHub release token (updater)" "$(gh_expiry "$GH_TOKEN")" "/opt/familyhub/github-release.env"
	else row github-release "GitHub release token (updater)" unknown "GH_TOKEN not found in env file"; fi
	unset GH_TOKEN
else row github-release "GitHub release token (updater)" unknown "/opt/familyhub/github-release.env missing"; fi

# 2. GHCR image pull credential (docker login ghcr.io as root).
GHCR=$(python3 - <<'PY' 2>/dev/null
import base64, json
try:
    cfg = json.load(open('/root/.docker/config.json'))
    auth = cfg.get('auths', {}).get('ghcr.io', {}).get('auth')
    print(base64.b64decode(auth).decode().split(':', 1)[1] if auth else ('HELPER' if cfg.get('credsStore') or cfg.get('credHelpers') else ''))
except Exception:
    print('')
PY
)
case $GHCR in
	'') row ghcr "GHCR pull token (docker login)" unknown "no ghcr.io login in /root/.docker/config.json" ;;
	HELPER) row ghcr "GHCR pull token (docker login)" unknown "stored in a credential helper" ;;
	*) row ghcr "GHCR pull token (docker login)" "$(gh_expiry "$GHCR")" "classic token, read:packages" ;;
esac
unset GHCR

# 3. Let's Encrypt certificate for the frame's LAN name (auto-renewed by certbot.timer).
if [[ -r /etc/family-hub-lan/lan-cert.pem ]]; then
	end=$(date -d "$(openssl x509 -in /etc/family-hub-lan/lan-cert.pem -noout -enddate | cut -d= -f2)" +%s)
	timer=$(systemctl is-active certbot.timer 2>/dev/null)
	# Let's Encrypt renews 30 days ahead; only warn if renewal looks stuck.
	if [[ $timer == active ]] && (( (end - NOW) / 86400 > 20 )); then row certificate "Frame LAN certificate" "$end" "auto-renews (certbot.timer active)"
	else row certificate "Frame LAN certificate" "$end" "certbot.timer: ${timer:-missing}"; (( (end - NOW) / 86400 <= 20 )) && ALERTS+=("Frame certificate has not renewed"); fi
fi

# 4. Cloudflare DNS token used by certbot to renew that certificate.
if [[ -r /etc/family-hub-lan/cloudflare.ini ]]; then
	CF=$(sed -n 's/^dns_cloudflare_api_token *= *//p' /etc/family-hub-lan/cloudflare.ini)
	CFJ=$(curl -s -m 15 -H @<(printf 'Authorization: Bearer %s\n' "$CF") https://api.cloudflare.com/client/v4/user/tokens/verify)
	unset CF
	CFS=$(python3 -c 'import json,sys; r=json.load(sys.stdin).get("result") or {}; print(r.get("status",""), r.get("expires_on") or "never")' <<<"$CFJ" 2>/dev/null)
	if [[ ${CFS%% *} == active ]]; then
		exp=${CFS#* }; [[ $exp == never ]] && row cloudflare "Cloudflare DNS token (certbot)" never "zone DNS edit" || row cloudflare "Cloudflare DNS token (certbot)" "$(date -d "$exp" +%s)" "zone DNS edit"
	else row cloudflare "Cloudflare DNS token (certbot)" unknown "verify returned: ${CFS:-no response}"; fi
fi

# 5. Tailscale node key (management access and the tailnet certificate).
if command -v tailscale >/dev/null; then
	KE=$(tailscale status --json 2>/dev/null | python3 -c 'import json,sys; s=json.load(sys.stdin).get("Self",{}); print(s.get("KeyExpiry") or "never")' 2>/dev/null)
	case $KE in never) row tailscale "Tailscale node key" never "key expiry disabled" ;; '') row tailscale "Tailscale node key" unknown "tailscale status failed" ;;
		*) row tailscale "Tailscale node key" "$(date -d "$KE" +%s)" "renew by re-authenticating, or disable key expiry" ;; esac
fi

if [[ -n ${STATUS_JSON:-} ]]; then
	# Written through one descriptor and renamed into place: nothing is reopened
	# or chmodded by path, so a symlink planted in a shared directory is never
	# followed. (The applier points STATUS_JSON at a root-only directory.)
	printf '%s\n' "${JSON_ROWS[@]}" | python3 -c '
import json, os, sys, datetime, tempfile
path, warn = sys.argv[1], int(sys.argv[2])
items = [json.loads(l) for l in sys.stdin if l.strip()]
body = json.dumps({"checkedAt": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "warnDays": warn, "items": items}, indent=1)
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(os.path.abspath(path)), prefix=".status.")
try:
    os.write(fd, body.encode()); os.fchmod(fd, 0o644)
finally:
    os.close(fd)
os.replace(tmp, path)' "$STATUS_JSON" "$WARN_DAYS"
fi
printf '%-34s %-12s %6s  %s\n' "Item" "Expires" "Days" "Notes"
printf '%s\n' "${ROWS[@]}"
if ((${#ALERTS[@]})); then
	printf '\nACTION NEEDED:\n'; printf ' - %s\n' "${ALERTS[@]}"
	priority=high; ((URGENT)) && priority=urgent
	if [[ -x /opt/familyhub/notify.sh ]]; then
		/opt/familyhub/notify.sh "Family Hub renewals" "$(printf '%s\n' "${ALERTS[@]}")" "$priority" warning
	elif [[ -n ${NTFY_URL:-} ]]; then
		printf '%s\n' "${ALERTS[@]}" | curl -s -m 15 -H "Title: FamilyHub renewals" -H "Tags: warning" --data-binary @- "$NTFY_URL" >/dev/null || true
	fi
	exit 1
fi
printf '\nNothing expires within %s days.\n' "$WARN_DAYS"
