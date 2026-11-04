#!/usr/bin/env bash
# Apply credentials submitted from FamilyHub's Settings → Advanced → Server
# credentials (run as root by familyhub-credentials.path). Each submission is a
# JSON file in $EXCHANGE/inbox: {"kind": "...", "token": "..."}. Every token is
# tested before it replaces the current one, the file is deleted either way,
# and the outcome (never the token) is written to $EXCHANGE/results.json.
set -uo pipefail
[[ ${EUID} -eq 0 ]] || { echo "Run as root." >&2; exit 2; }
EXCHANGE=${EXCHANGE:-/opt/familyhub/admin-exchange}
REPO=santoshgs/familyhub
RELEASE_ENV=${RELEASE_ENV:-/opt/familyhub/github-release.env}
CLOUDFLARE_INI=${CLOUDFLARE_INI:-/etc/family-hub-lan/cloudflare.ini}
CHECK=${CHECK:-/opt/familyhub/check-renewals.sh}
shopt -s nullglob
# One applier at a time (the path unit and the terminal script can both start one).
exec 9>"${LOCK_FILE:-/run/familyhub-credentials.lock}"
flock 9

result() { # kind ok message
	python3 - "$EXCHANGE/results.json" "$1" "$2" "$3" <<'PY'
import json, os, sys, datetime, tempfile
path, kind, ok, message = sys.argv[1:]
try: data = json.load(open(path))
except Exception: data = {}
data[kind] = {"ok": ok == "true", "message": message[:300], "at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path)); os.write(fd, json.dumps(data, indent=1).encode()); os.close(fd)
os.chmod(tmp, 0o644); os.replace(tmp, path)
PY
	logger -t familyhub-credentials "$1: $3"
}

apply_release() {
	if ! GH_TOKEN=$1 gh release list --repo "$REPO" --limit 1 >/dev/null 2>&1; then
		result github-release false "GitHub did not accept this token for listing $REPO releases. Nothing changed."; return; fi
	local tmp; tmp=$(mktemp "$(dirname "$RELEASE_ENV")/.github-release.XXXXXX")
	{ grep -v '^GH_TOKEN=' "$RELEASE_ENV" 2>/dev/null || true; printf 'GH_TOKEN=%s\n' "$1"; } > "$tmp"
	chown root:root "$tmp"; chmod 0600 "$tmp"; mv "$tmp" "$RELEASE_ENV"
	result github-release true "Saved. The updater uses it from its next hourly check."
}

apply_ghcr() {
	local user image
	user=$(curl -s -m 15 -H "Authorization: Bearer $1" https://api.github.com/user | python3 -c 'import json,sys; print(json.load(sys.stdin).get("login",""))' 2>/dev/null)
	[[ -n $user ]] || { result ghcr false "GitHub did not accept this token. Nothing changed."; return; }
	# Test against the running image before replacing the working login.
	image=$(docker ps --format '{{.Image}}' | grep -m1 'ghcr.io/santoshgs/familyhub-' || true)
	local probe; probe=$(mktemp -d)
	if ! printf '%s' "$1" | DOCKER_CONFIG=$probe docker login ghcr.io -u "$user" --password-stdin >/dev/null 2>&1 \
		|| { [[ -n $image ]] && ! DOCKER_CONFIG=$probe docker manifest inspect "$image" >/dev/null 2>&1; }; then
		rm -rf "$probe"; result ghcr false "This token cannot read the FamilyHub images (it needs the read:packages scope). Nothing changed."; return; fi
	rm -rf "$probe"
	printf '%s' "$1" | docker login ghcr.io -u "$user" --password-stdin >/dev/null 2>&1
	result ghcr true "Saved for $user."
}

apply_cloudflare() {
	local status
	status=$(curl -s -m 15 -H "Authorization: Bearer $1" https://api.cloudflare.com/client/v4/user/tokens/verify | python3 -c 'import json,sys; print((json.load(sys.stdin).get("result") or {}).get("status",""))' 2>/dev/null)
	[[ $status == active ]] || { result cloudflare false "Cloudflare reports this token as ${status:-invalid}. Nothing changed."; return; }
	local tmp; tmp=$(mktemp "$(dirname "$CLOUDFLARE_INI")/.cloudflare.XXXXXX")
	printf 'dns_cloudflare_api_token = %s\n' "$1" > "$tmp"; chown root:root "$tmp"; chmod 0600 "$tmp"; mv "$tmp" "$CLOUDFLARE_INI"
	result cloudflare true "Saved. Certificate renewals use it from now on."
}

for file in "$EXCHANGE"/inbox/*.json; do
	[[ -f $file ]] || continue
	read -r kind token < <(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d.get("kind",""), d.get("token",""))' "$file" 2>/dev/null) || true
	rm -f "$file"
	[[ -n ${kind:-} ]] || continue
	if [[ $kind != check && ! ${token:-} =~ ^[A-Za-z0-9_-]{20,255}$ ]]; then result "${kind:-unknown}" false "That does not look like a token. Nothing changed."; continue; fi
	case $kind in
		github-release) apply_release "$token" ;;
		ghcr) apply_ghcr "$token" ;;
		cloudflare) apply_cloudflare "$token" ;;
		check) ;;
		*) result unknown false "Unknown credential type." ;;
	esac
	unset token
done
STATUS_JSON="$EXCHANGE/status.json" "$CHECK" >/dev/null 2>&1 || true
