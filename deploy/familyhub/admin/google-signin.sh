#!/usr/bin/env bash
# Sign in with Google for Family Hub. Run on the Pi with sudo; edits the private
# deployment settings (/opt/familyhub/private.env, kept 0600) and restarts the
# running release so they take effect. Household data is untouched.
#
#   sudo bash google-signin.sh enable        Google button on the sign-in page; passwords still work
#   sudo bash google-signin.sh google-only   turn password sign-in off (after everyone has linked Google)
#   sudo bash google-signin.sh passwords-on  turn password sign-in back on (escape hatch)
#   sudo bash google-signin.sh disable       remove sign-in with Google
#   sudo bash google-signin.sh status
#
# Before "enable": in Google Cloud Console → APIs & Services → Credentials, open
# the OAuth client Family Hub already uses for Calendar and Tasks and add the
# authorized redirect URI  https://<your Family Hub host>/api/auth/oidc/callback
# "enable" reuses that client's ID and secret unless you paste different ones.
# See docs/familyhub/GOOGLE_SIGNIN.md.
set -euo pipefail
[[ ${EUID} -eq 0 ]] || { echo "Run with sudo." >&2; exit 2; }
ENV=${FAMILYHUB_ENV:-/opt/familyhub/private.env}
STATE=${FAMILYHUB_STATE:-/opt/familyhub/state}
[[ -f $ENV ]] || { echo "Missing $ENV" >&2; exit 1; }

get() { sed -n "s/^$1=//p" "$ENV" | tail -1; }
set_key() { # key value: replace or append, atomically, keeping 0600
	# The value travels in the environment (root-only), never in argv.
	FH_VALUE=$2 python3 - "$ENV" "$1" <<'PY'
import os, sys, tempfile
path, key = sys.argv[1:]
value = os.environ['FH_VALUE']
lines = open(path).read().splitlines()
out, done = [], False
for line in lines:
    if line.split('=', 1)[0] == key:
        if not done:
            out.append(f'{key}={value}'); done = True
    else:
        out.append(line)
if not done:
    out.append(f'{key}={value}')
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path))
os.fchmod(fd, 0o600)
with os.fdopen(fd, 'w') as f:
    f.write('\n'.join(out) + '\n')
os.replace(tmp, path)
PY
}
restart() {
	local version
	version=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["current"])' "$STATE/current.json")
	echo "Restarting $version…"
	python3 "$STATE/releases/$version/release.py" restart --state-dir "$STATE" --env-file "$ENV"
}
host=$(get FAMILYHUB_HOST)

case ${1:-status} in
	enable)
		id=$(get GOOGLE_CLIENT_ID); secret=$(get GOOGLE_CLIENT_SECRET)
		read -rp "OAuth client ID [Enter = reuse the Calendar/Tasks client${id:+ ${id:0:12}…}]: " new_id
		[[ -n $new_id ]] && { id=$new_id; read -rsp 'OAuth client secret: ' secret; echo; }
		[[ -n $id && -n $secret ]] || { echo "No client ID/secret: set GOOGLE_CLIENT_ID/SECRET first or paste them." >&2; exit 1; }
		set_key OIDC_ISSUER_URL https://accounts.google.com
		set_key OIDC_CLIENT_ID "$id"
		set_key OIDC_CLIENT_SECRET "$secret"
		set_key OIDC_PROVIDER_NAME Google
		set_key OIDC_REGISTRATION_ENABLED false
		unset secret
		echo "Redirect URI to authorize in Google Cloud: https://$host/api/auth/oidc/callback"
		restart
		echo "Done. Each person: sign in with their password once, then Settings → Sign-in → Link Google." ;;
	google-only)
		[[ -n $(get OIDC_ISSUER_URL) ]] || { echo "Run 'enable' first." >&2; exit 1; }
		echo "Make sure every account has linked Google (Settings → Sign-in) before continuing."
		read -rp "Turn password sign-in off? [y/N] " ok; [[ $ok == [yY] ]] || exit 0
		set_key PASSWORD_LOGIN_ENABLED false; restart
		echo "Password sign-in is off. To undo: sudo bash google-signin.sh passwords-on" ;;
	passwords-on) set_key PASSWORD_LOGIN_ENABLED true; restart ;;
	disable)
		for k in OIDC_ISSUER_URL OIDC_CLIENT_ID OIDC_CLIENT_SECRET; do set_key "$k" ''; done
		set_key PASSWORD_LOGIN_ENABLED true; restart ;;
	status)
		echo "Sign in with Google: $([[ -n $(get OIDC_ISSUER_URL) ]] && echo on || echo off)"
		echo "Password sign-in:    $([[ $(get PASSWORD_LOGIN_ENABLED) == false ]] && echo off || echo on)"
		echo "Redirect URI:        https://$host/api/auth/oidc/callback" ;;
	*) sed -n '2,16p' "$0"; exit 2 ;;
esac
