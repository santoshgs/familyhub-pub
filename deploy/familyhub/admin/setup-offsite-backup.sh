#!/usr/bin/env bash
# Set up the nightly encrypted off-site backup to Cloudflare R2.
# Run on the Pi from this folder: sudo bash setup-offsite-backup.sh
#
# Before running, in the Cloudflare dashboard:
#   1. R2 → Create bucket (for example "familyhub-backup"), location automatic.
#   2. R2 → Manage API tokens → Create token: "Object Read & Write", applied to
#      that bucket only. Keep the Access Key ID and Secret Access Key at hand.
#   3. Note the Account ID (R2 overview page).
#
# The script installs restic, writes /etc/familyhub-backup.env and a random
# encryption key /etc/familyhub-backup.key (both root, 0600), creates the
# encrypted repository in the bucket, installs the nightly timer and runs the
# first backup. It prints the encryption key ONCE: store it in your password
# manager. Without it the backups cannot be read, and the copy on the Pi dies
# with the Pi. Re-running keeps the existing key and repository.
set -euo pipefail
[[ ${EUID} -eq 0 ]] || { echo "Run with sudo." >&2; exit 2; }
HERE=$(cd "$(dirname "$0")" && pwd)
CONF=/etc/familyhub-backup.env
KEY=/etc/familyhub-backup.key

command -v restic >/dev/null || { echo "Installing restic…"; apt-get update -qq && apt-get install -y -qq restic; }
restic version

current() { [[ -r $CONF ]] && sed -n "s/^$1=//p" "$CONF" | tail -1 || true; }
repo=$(current RESTIC_REPOSITORY)
if [[ -n $repo ]]; then
	read -rp "Keep the existing repository $repo? [Y/n] " keep
	[[ ${keep,,} == n ]] && repo=
fi
if [[ -z $repo ]]; then
	read -rp 'Cloudflare Account ID: ' account
	[[ $account =~ ^[0-9a-f]{32}$ ]] || { echo "An Account ID is 32 hexadecimal characters." >&2; exit 1; }
	read -rp 'R2 bucket name [familyhub-backup]: ' bucket; bucket=${bucket:-familyhub-backup}
	[[ $bucket =~ ^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$ ]] || { echo "That is not a valid R2 bucket name." >&2; exit 1; }
	repo="s3:https://$account.r2.cloudflarestorage.com/$bucket/familyhub"
fi
id=$(current AWS_ACCESS_KEY_ID)
read -rp "R2 Access Key ID${id:+ [keep current]}: " new_id; id=${new_id:-$id}
[[ -n $id ]] || { echo "An Access Key ID is required." >&2; exit 1; }
secret=$(current AWS_SECRET_ACCESS_KEY)
read -rsp "R2 Secret Access Key${secret:+ (Enter keeps the current one)}: " new_secret; echo
secret=${new_secret:-$secret}; unset new_secret
[[ -n $secret ]] || { echo "A Secret Access Key is required." >&2; exit 1; }

umask 077
new_key=0
if [[ ! -s $KEY ]]; then
	openssl rand -base64 33 | tr -d '\n' > "$KEY"; chmod 0600 "$KEY"; new_key=1
fi
tmp=$(mktemp "$CONF.XXXXXX")
printf 'RESTIC_REPOSITORY=%s\nRESTIC_PASSWORD_FILE=%s\nAWS_ACCESS_KEY_ID=%s\nAWS_SECRET_ACCESS_KEY=%s\nAWS_DEFAULT_REGION=auto\n' \
	"$repo" "$KEY" "$id" "$secret" > "$tmp"
chmod 0600 "$tmp"; mv "$tmp" "$CONF"; unset secret

set -a
# shellcheck source=/dev/null
. "$CONF"
set +a
if restic cat config >/dev/null 2>&1; then
	echo "The encrypted repository already exists and the key opens it."
else
	echo "Creating the encrypted repository…"
	restic init
fi

install -m 0755 "$HERE/offsite-backup.sh" /opt/familyhub/offsite-backup.sh
install -m 0755 "$HERE/restore-offsite-backup.sh" /opt/familyhub/restore-offsite-backup.sh
install -m 0644 "$HERE/familyhub-offsite-backup.service" /etc/systemd/system/familyhub-offsite-backup.service
install -m 0644 "$HERE/familyhub-offsite-backup.timer" /etc/systemd/system/familyhub-offsite-backup.timer
systemctl daemon-reload
systemctl enable --now familyhub-offsite-backup.timer

echo "Running the first backup (this can take a few minutes)…"
/opt/familyhub/offsite-backup.sh

if (( new_key )); then
	echo
	echo "=== ENCRYPTION KEY: store this in your password manager now ==="
	echo "Repository: $repo"
	echo "Key:        $(cat "$KEY")"
	echo "Without this key the backups cannot be restored. It is not shown again."
	echo "================================================================"
fi
echo
echo "Nightly backup scheduled: $(systemctl list-timers familyhub-offsite-backup.timer --no-pager | sed -n 2p | awk '{print $1, $2, $3}')"
echo "Prove a restore works: sudo /opt/familyhub/restore-offsite-backup.sh --drill"
