#!/usr/bin/env bash
# Apply credentials submitted from FamilyHub's Settings → Advanced → Server
# credentials (run as root by familyhub-credentials.path). Each submission is a
# JSON file in $EXCHANGE/inbox: {"kind": "...", "token": "..."}. Every token is
# tested before it replaces the current one, the file is deleted either way,
# and the outcome (never the token) is published to $EXCHANGE/results.json.
set -uo pipefail
[[ ${EUID} -eq 0 ]] || { echo "Run as root." >&2; exit 2; }
EXCHANGE=${EXCHANGE:-/opt/familyhub/admin-exchange}
REPO=santoshgs/familyhub
RELEASE_ENV=${RELEASE_ENV:-/opt/familyhub/github-release.env}
CLOUDFLARE_INI=${CLOUDFLARE_INI:-/etc/family-hub-lan/cloudflare.ini}
CHECK=${CHECK:-/opt/familyhub/check-renewals.sh}
# Software updates (Settings → Advanced): the same release.py the hourly updater runs.
RELEASE_PY=${RELEASE_PY:-/opt/familyhub/release.py}
DEPLOY_STATE=${DEPLOY_STATE:-/opt/familyhub/state}
PRIVATE_ENV=${PRIVATE_ENV:-/opt/familyhub/private.env}
shopt -s nullglob
# One applier at a time (the path unit and the terminal script can both start one).
exec 9>"${LOCK_FILE:-/run/familyhub-credentials.lock}"
flock 9

# The exchange directory is writable by the server container. Root never follows
# a path in it: results are kept in a root-only directory and published into the
# exchange by an atomic rename of a file written through its own descriptor, and
# submissions are read and unlinked relative to a no-follow directory handle.
STATE_DIR=${STATE_DIR:-/opt/familyhub/admin-state}
install -d -m 0700 -o root -g root "$STATE_DIR"

# publish <root-only source> <name in $EXCHANGE>
publish() {
	python3 - "$1" "$EXCHANGE" "$2" <<'PY'
import os, sys, tempfile
src, exchange, name = sys.argv[1:]
data = open(src, 'rb').read()
dfd = os.open(exchange, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
try:
    tmp = f'.{name}.{os.getpid()}.{os.urandom(6).hex()}'
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=dfd)
    try:
        os.write(fd, data); os.fchmod(fd, 0o644)
    finally:
        os.close(fd)
    # rename() replaces whatever sits at the name (a planted symlink included)
    # without following it.
    os.replace(tmp, name, src_dir_fd=dfd, dst_dir_fd=dfd)
finally:
    os.close(dfd)
PY
}

result() { # kind ok message
	python3 - "$STATE_DIR/results.json" "$1" "$2" "$3" <<'PY'
import json, os, sys, datetime, tempfile
path, kind, ok, message = sys.argv[1:]
try: data = json.load(open(path))
except Exception: data = {}
data[kind] = {"ok": ok == "true", "message": message[:300], "at": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path))
with os.fdopen(fd, 'w') as f: f.write(json.dumps(data, indent=1))
os.replace(tmp, path)
PY
	publish "$STATE_DIR/results.json" results.json
	logger -t familyhub-credentials "$1: $3"
}

# Prints "kind token" per submission and unlinks it; never follows a symlinked
# inbox or entry (a symlinked inbox is refused outright).
take_submissions() {
	python3 - "$EXCHANGE" <<'PY'
import json, os, stat, sys
exchange = sys.argv[1]
try:
    efd = os.open(exchange, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    dfd = os.open('inbox', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=efd)
except OSError as error:
    print(f'refusing the inbox: {error}', file=sys.stderr); sys.exit(0)
for name in sorted(os.listdir(dfd)):
    if not name.endswith('.json'):
        continue
    try:
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=dfd)
    except OSError:
        try: os.unlink(name, dir_fd=dfd)
        except OSError: pass
        continue
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            continue
        raw = os.read(fd, 65536)
    finally:
        os.close(fd)
        try: os.unlink(name, dir_fd=dfd)
        except OSError: pass
    try:
        d = json.loads(raw)
        kind, token = str(d.get('kind', '')), str(d.get('token', ''))
    except Exception:
        continue
    if kind and ' ' not in kind and '\n' not in kind and '\n' not in token:
        print(kind, token)
PY
}

# curl with an Authorization header read from a file descriptor, never argv
# (visible to every local user in /proc/<pid>/cmdline).
curl_bearer() { # token curl-args...
	local token=$1; shift
	curl "$@" -H @<(printf 'Authorization: Bearer %s\n' "$token")
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
	user=$(curl_bearer "$1" -s -m 15 https://api.github.com/user | python3 -c 'import json,sys; print(json.load(sys.stdin).get("login",""))' 2>/dev/null)
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
	status=$(curl_bearer "$1" -s -m 15 https://api.cloudflare.com/client/v4/user/tokens/verify | python3 -c 'import json,sys; print((json.load(sys.stdin).get("result") or {}).get("status",""))' 2>/dev/null)
	[[ $status == active ]] || { result cloudflare false "Cloudflare reports this token as ${status:-invalid}. Nothing changed."; return; }
	local tmp; tmp=$(mktemp "$(dirname "$CLOUDFLARE_INI")/.cloudflare.XXXXXX")
	printf 'dns_cloudflare_api_token = %s\n' "$1" > "$tmp"; chown root:root "$tmp"; chmod 0600 "$tmp"; mv "$tmp" "$CLOUDFLARE_INI"
	result cloudflare true "Saved. Certificate renewals use it from now on."
}

# release <check|start-update>: asks release.py, with the updater's read-only
# release token in its environment (never argv), to check GitHub for a newer
# stable release or to start the updater unit now. release.py writes the
# secret-free status file and publishes it into the exchange itself. The app can
# only ask; the version, backup, health check and rollback stay the updater's.
release() {
	local token
	token=$(sed -n 's/^GH_TOKEN=//p' "$RELEASE_ENV" 2>/dev/null | tail -n 1 | tr -d "\"'")
	GH_TOKEN=$token python3 "$RELEASE_PY" "$1" --state-dir "$DEPLOY_STATE" --env-file "$PRIVATE_ENV" --publish-dir "$EXCHANGE" >/dev/null 2>&1 \
		|| logger -t familyhub-credentials "software update $1 did not complete (details in the update status)"
}

# backup-now: starts the nightly off-site backup unit at once (Settings →
# Advanced → Back up now). --no-block returns straight away; the backup
# publishes its own progress and result as backup-status.json.
backup_now() {
	if ! systemctl cat familyhub-offsite-backup.service >/dev/null 2>&1; then
		result backup false "The off-site backup is not set up on this Pi (run setup-offsite-backup.sh)."; return; fi
	if systemctl start --no-block familyhub-offsite-backup.service; then
		result backup true "Backup started."
	else
		result backup false "The backup could not be started (see journalctl -u familyhub-offsite-backup)."
	fi
}

while read -r kind token; do
	[[ -n ${kind:-} ]] || continue
	case $kind in
		check|update-check|update-install|backup-now) ;;
		*) if [[ ! ${token:-} =~ ^[A-Za-z0-9_-]{20,255}$ ]]; then result "${kind:-unknown}" false "That does not look like a token. Nothing changed."; continue; fi ;;
	esac
	case $kind in
		github-release) apply_release "$token" ;;
		ghcr) apply_ghcr "$token" ;;
		cloudflare) apply_cloudflare "$token" ;;
		check) ;;
		update-check) release check ;;
		update-install) release start-update ;;
		backup-now) backup_now ;;
		*) result unknown false "Unknown credential type." ;;
	esac
	unset token
done < <(take_submissions)
STATUS_JSON="$STATE_DIR/status.json" "$CHECK" >/dev/null 2>&1 || true
if [[ -f $STATE_DIR/status.json ]]; then publish "$STATE_DIR/status.json" status.json; fi
exit 0
