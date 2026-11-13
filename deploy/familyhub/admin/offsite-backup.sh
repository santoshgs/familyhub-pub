#!/usr/bin/env bash
# Nightly encrypted off-site backup of the household's Family Hub to Cloudflare R2.
# Installed and scheduled by setup-offsite-backup.sh; run by
# familyhub-offsite-backup.service as root. Never prints a secret.
#
# What goes into each snapshot (restic encrypts everything before upload):
#   database.dump     pg_dump custom format of the whole database (restore with pg_restore)
#   readable/*.csv    budget, notes and shopping tables as plain CSV, usable in any
#                     spreadsheet without Family Hub
#   uploads.tar.gz    the uploads volume (frame photos, avatars)
#   private.env       deployment secrets: JWT_SECRET and FAMILYHUB_TOKEN_KEY are needed
#                     to decrypt the stored Google and server credentials after a restore
#   release.json      which Family Hub release was running
#   SHA256SUMS        checksums of the files above
#
# Retention: 14 daily, 8 weekly and 12 monthly snapshots. Sundays also read back
# 5% of the stored data to prove the repository is intact.
#
# Results (no secrets) are kept in the root-only $STATE_DIR and published into
# the app's exchange folder for Settings → Advanced → Server credentials, the
# same way apply-credentials.sh publishes (root never follows a path in the
# container-writable exchange). Failures send an ntfy push when setup-ntfy.sh
# was run. "Back up now" in Settings starts this through the applier.
set -uo pipefail
[[ ${EUID} -eq 0 ]] || { echo "Run with sudo." >&2; exit 2; }
CONF=${FAMILYHUB_BACKUP_ENV:-/etc/familyhub-backup.env}
ENV_FILE=${FAMILYHUB_ENV_FILE:-/opt/familyhub/private.env}
STATE_FILE=${FAMILYHUB_RELEASE_STATE:-/opt/familyhub/state/current.json}
EXCHANGE=${EXCHANGE:-/opt/familyhub/admin-exchange}
STATE_DIR=${STATE_DIR:-/opt/familyhub/admin-state}
NOTIFY=${FAMILYHUB_NOTIFY:-/opt/familyhub/notify.sh}
WORK_ROOT=${FAMILYHUB_STATE_DIR:-/opt/familyhub/state}
[[ -r $CONF ]] || { echo "Missing $CONF; run setup-offsite-backup.sh first." >&2; exit 2; }
set -a
# shellcheck source=/dev/null
. "$CONF"
set +a
: "${RESTIC_REPOSITORY:?}" "${RESTIC_PASSWORD_FILE:?}" "${AWS_ACCESS_KEY_ID:?}" "${AWS_SECRET_ACCESS_KEY:?}"
export AWS_DEFAULT_REGION=${AWS_DEFAULT_REGION:-auto}
KEEP=${BACKUP_KEEP:---keep-daily 14 --keep-weekly 8 --keep-monthly 12}
umask 077
# One backup at a time: the timer, "Back up now" and a terminal run share this lock.
exec 8>"${BACKUP_LOCK:-/run/familyhub-offsite-backup.lock}"
flock -n 8 || { echo "A backup is already running."; exit 0; }
install -d -m 0700 "$STATE_DIR"
STATUS_FILE=$STATE_DIR/backup-status.json

STARTED=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
WORK=$(mktemp -d "$WORK_ROOT/offsite-XXXXXX") || exit 1
trap 'rm -rf "$WORK"' EXIT

status() { # state, message, [snapshot id], [bytes], [snapshots]
	python3 - "$STATUS_FILE" "$EXCHANGE" "$1" "$2" "$STARTED" "${3:-}" "${4:-0}" "${5:-0}" <<'PY'
import json, os, sys, datetime
path, exchange, state, message, started, snap, size, count = sys.argv[1:]
try: old = json.load(open(path))
except Exception: old = {}
now = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
data = {'destination': 'Cloudflare R2', 'state': state, 'message': message[:300], 'startedAt': started,
        'attemptedAt': now, 'lastSuccessAt': old.get('lastSuccessAt'), 'snapshot': old.get('snapshot'),
        'sizeBytes': old.get('sizeBytes'), 'snapshots': old.get('snapshots')}
if state == 'ok':
    data.update(lastSuccessAt=now, snapshot=snap[:16], sizeBytes=int(size or 0), snapshots=int(count or 0))
body = json.dumps(data).encode()
tmp = f'{path}.{os.getpid()}.tmp'
with open(tmp, 'wb') as f: f.write(body)
os.replace(tmp, path)
# Publish into the container-writable exchange: written through its own
# descriptor under a no-follow directory handle, then renamed over the name
# (a planted symlink is replaced, never followed).
try:
    dfd = os.open(exchange, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
except OSError:
    sys.exit(0)
try:
    name = 'backup-status.json'
    t = f'.{name}.{os.getpid()}.{os.urandom(6).hex()}'
    fd = os.open(t, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=dfd)
    try:
        os.write(fd, body); os.fchmod(fd, 0o644)
    finally:
        os.close(fd)
    os.replace(t, name, src_dir_fd=dfd, dst_dir_fd=dfd)
finally:
    os.close(dfd)
PY
}
fail() {
	echo "Off-site backup failed: $1" >&2
	status failed "$1"
	[[ -x $NOTIFY ]] && "$NOTIFY" "Family Hub backup failed" "$1 The previous off-site copies are untouched." high warning || true
	exit 1
}

status running "Backing up…"
mapfile -t containers < <(docker ps -q --filter label=com.docker.compose.project=familyhub --filter label=com.docker.compose.service=postgres)
(( ${#containers[@]} == 1 )) || fail "The database container is not running."
DB=${containers[0]}
mapfile -t servers < <(docker ps -q --filter label=com.docker.compose.project=familyhub --filter label=com.docker.compose.service=server)

# 1. Database: one consistent snapshot, then the readable tables.
docker exec "$DB" pg_dump -U familyhub -d familyhub -Fc > "$WORK/database.dump" || fail "pg_dump did not complete."
[[ -s $WORK/database.dump ]] || fail "The database dump is empty."
mkdir "$WORK/readable"
mapfile -t tables < <(docker exec "$DB" psql -U familyhub -d familyhub -X -At -c "
	SELECT table_name FROM information_schema.tables
	WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND (
	  table_name IN ('budget_entries','budget_limits','budget_groups','budget_settlements','budget_sharing_settings',
	                 'recurring_expenses','recurring_expense_logs','kakeibo_months','family_notes',
	                 'shopping_items','shopping_list_templates','users','family_members'))
	ORDER BY 1") || fail "Could not list the tables to export."
for table in "${tables[@]}"; do
	[[ $table =~ ^[a-z_]+$ ]] || continue
	if [[ $table == users ]]; then # names and e-mails only; never password hashes
		query="COPY (SELECT id, email, name, role, family_owner_id, currency, created_at FROM users) TO STDOUT WITH (FORMAT csv, HEADER)"
	else
		query="COPY public.$table TO STDOUT WITH (FORMAT csv, HEADER)"
	fi
	docker exec "$DB" psql -U familyhub -d familyhub -X -q -v ON_ERROR_STOP=1 -c "$query" > "$WORK/readable/$table.csv" \
		|| fail "Could not export $table as CSV."
done

# 2. Uploads, deployment secrets and the running release.
if (( ${#servers[@]} == 1 )); then
	docker exec "${servers[0]}" tar -czf - -C /app/uploads . > "$WORK/uploads.tar.gz" || fail "Could not archive the uploads."
else
	fail "The server container is not running, so the uploads could not be read."
fi
[[ -r $ENV_FILE ]] || fail "$ENV_FILE is missing."
cp "$ENV_FILE" "$WORK/private.env"
[[ -r $STATE_FILE ]] && cp "$STATE_FILE" "$WORK/release.json"
(cd "$WORK" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS) || fail "Could not write checksums."

# 3. Encrypt and upload; a failed upload leaves earlier snapshots in place.
out=$(cd "$WORK" && restic backup --json --quiet --host familyhub-pi --tag nightly . 2>&1) || fail "Upload to R2 failed: $(tail -c 200 <<<"$out")"
snap=$(python3 -c 'import json,sys
for line in sys.stdin:
    try: d=json.loads(line)
    except Exception: continue
    if d.get("message_type")=="summary": print(d.get("snapshot_id","")); break' <<<"$out")
size=$(du -sb "$WORK" | cut -f1)

# 4. Retention, and a weekly read-back check.
restic forget --quiet --host familyhub-pi --tag nightly $KEEP --prune >/dev/null 2>&1 || fail "Pruning old snapshots failed (the new snapshot was uploaded)."
if [[ $(date +%u) == 7 ]]; then
	restic check --read-data-subset=5% >/dev/null 2>&1 || fail "The weekly integrity check of the R2 copy failed."
fi
count=$(restic snapshots --json --host familyhub-pi --tag nightly 2>/dev/null | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))' 2>/dev/null || echo 0)
status ok "Backed up ${#tables[@]} readable tables, the database, uploads and settings." "$snap" "$size" "$count"
echo "Off-site backup ${snap:0:8} uploaded ($(numfmt --to=iec "$size") before compression; $count snapshots kept)."
