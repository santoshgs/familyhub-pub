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
# Results (no secrets) go to $STATUS_JSON for Settings → Advanced → Server
# credentials; failures send an ntfy push when setup-ntfy.sh was run.
set -uo pipefail
[[ ${EUID} -eq 0 ]] || { echo "Run with sudo." >&2; exit 2; }
CONF=${FAMILYHUB_BACKUP_ENV:-/etc/familyhub-backup.env}
ENV_FILE=${FAMILYHUB_ENV_FILE:-/opt/familyhub/private.env}
STATE_FILE=${FAMILYHUB_RELEASE_STATE:-/opt/familyhub/state/current.json}
STATUS_JSON=${STATUS_JSON:-/opt/familyhub/admin-exchange/backup-status.json}
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

STARTED=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
WORK=$(mktemp -d "$WORK_ROOT/offsite-XXXXXX") || exit 1
trap 'rm -rf "$WORK"' EXIT

status() { # state, message, [snapshot id], [bytes], [snapshots]
	local dir; dir=$(dirname "$STATUS_JSON")
	[[ -d $dir ]] || return 0
	local previous='{}'; [[ -r $STATUS_JSON ]] && previous=$(cat "$STATUS_JSON")
	python3 - "$STATUS_JSON" "$1" "$2" "$STARTED" "${3:-}" "${4:-0}" "${5:-0}" "$previous" <<'PY'
import json, os, sys, tempfile, datetime
path, state, message, started, snap, size, count, previous = sys.argv[1:]
try: old = json.loads(previous)
except Exception: old = {}
now = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
data = {'destination': 'Cloudflare R2', 'state': state, 'message': message[:300], 'attemptedAt': now,
        'lastSuccessAt': old.get('lastSuccessAt'), 'snapshot': old.get('snapshot'),
        'sizeBytes': old.get('sizeBytes'), 'snapshots': old.get('snapshots')}
if state == 'ok':
    data.update(lastSuccessAt=now, snapshot=snap[:16], sizeBytes=int(size or 0), snapshots=int(count or 0))
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix='.backup-status.')
with os.fdopen(fd, 'w') as f: json.dump(data, f)
os.chmod(tmp, 0o644)
os.replace(tmp, path)
PY
}
fail() {
	echo "Off-site backup failed: $1" >&2
	status failed "$1"
	[[ -x $NOTIFY ]] && "$NOTIFY" "Family Hub backup failed" "$1 The previous off-site copies are untouched." high warning || true
	exit 1
}

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
