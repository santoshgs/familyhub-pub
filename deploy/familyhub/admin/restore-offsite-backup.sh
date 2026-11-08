#!/usr/bin/env bash
# Restore Family Hub's encrypted off-site backup from Cloudflare R2.
#
#   sudo restore-offsite-backup.sh --list            list the snapshots
#   sudo restore-offsite-backup.sh --drill [ID]      prove a snapshot restores: load it into a
#                                                    throwaway PostgreSQL container with no network,
#                                                    count budget and notes rows, then delete it
#   sudo restore-offsite-backup.sh --to DIR [ID]     unpack a snapshot into DIR (0700) for a real
#                                                    recovery; see BACKUP_RESTORE.md for the steps
#
# ID defaults to the latest snapshot. On a replacement machine without
# /etc/familyhub-backup.env the script asks for the repository, the R2 keys and
# the encryption key, and keeps them only for this run. Nothing here touches
# the running Family Hub or contacts Google.
set -euo pipefail
[[ ${EUID} -eq 0 ]] || { echo "Run with sudo." >&2; exit 2; }
CONF=${FAMILYHUB_BACKUP_ENV:-/etc/familyhub-backup.env}
mode=${1:-}; shift || true
command -v restic >/dev/null || { echo "Install restic first (apt-get install restic)." >&2; exit 2; }
umask 077
SCRATCH=$(mktemp -d)
cleanup() { [[ -n ${PG:-} ]] && docker rm -f "$PG" >/dev/null 2>&1; rm -rf "$SCRATCH"; }
trap cleanup EXIT

if [[ -r $CONF ]]; then
	set -a
	# shellcheck source=/dev/null
	. "$CONF"
	set +a
else
	echo "No $CONF on this machine; enter the backup details (kept only for this run)."
	read -rp 'Repository (s3:https://<account>.r2.cloudflarestorage.com/<bucket>/familyhub): ' RESTIC_REPOSITORY
	read -rp 'R2 Access Key ID: ' AWS_ACCESS_KEY_ID
	read -rsp 'R2 Secret Access Key: ' AWS_SECRET_ACCESS_KEY; echo
	read -rsp 'Encryption key (from your password manager): ' key; echo
	printf '%s' "$key" > "$SCRATCH/key"; unset key
	RESTIC_PASSWORD_FILE=$SCRATCH/key
	export RESTIC_REPOSITORY AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY RESTIC_PASSWORD_FILE
fi
export AWS_DEFAULT_REGION=${AWS_DEFAULT_REGION:-auto}

restore_into() { # snapshot, target dir
	restic restore "$1" --target "$2" >/dev/null
	(cd "$2" && sha256sum --quiet -c SHA256SUMS) || { echo "Checksum mismatch in the restored files." >&2; exit 1; }
}

case $mode in
--list)
	restic snapshots --tag nightly ;;
--drill)
	snap=${1:-latest}
	echo "Downloading and decrypting snapshot $snap…"
	restore_into "$snap" "$SCRATCH/files"
	PG=familyhub-restore-drill-$$
	docker run -d --name "$PG" --network none -e POSTGRES_USER=familyhub -e POSTGRES_PASSWORD=drill \
		-e POSTGRES_DB=familyhub postgres:16-alpine >/dev/null
	for _ in $(seq 60); do docker exec "$PG" pg_isready -U familyhub -q 2>/dev/null && break; sleep 1; done
	docker exec -i "$PG" pg_restore -U familyhub -d familyhub --no-owner --exit-on-error < "$SCRATCH/files/database.dump"
	echo "Restored into a throwaway database. Row counts:"
	for table in budget_entries budget_groups budget_settlements recurring_expenses budget_limits family_notes shopping_items users; do
		n=$(docker exec "$PG" psql -U familyhub -d familyhub -X -At -c "SELECT count(*) FROM $table" 2>/dev/null || echo "-")
		printf '  %-22s %s\n' "$table" "$n"
	done
	printf '  %-22s %s\n' "readable CSV files" "$(ls "$SCRATCH/files/readable" | wc -l)"
	printf '  %-22s %s\n' "uploads archive" "$(tar -tzf "$SCRATCH/files/uploads.tar.gz" | grep -vc '/$') files"
	grep -q '^JWT_SECRET=' "$SCRATCH/files/private.env" && echo "  private.env            has JWT_SECRET" || echo "  private.env            JWT_SECRET MISSING"
	echo "Drill passed. The throwaway database and files are now deleted." ;;
--to)
	dir=${1:?Give a target folder}; snap=${2:-latest}
	[[ -e $dir && -n $(ls -A "$dir" 2>/dev/null) ]] && { echo "$dir is not empty." >&2; exit 1; }
	mkdir -p "$dir"; chmod 0700 "$dir"
	restore_into "$snap" "$dir"
	echo "Snapshot unpacked into $dir (database.dump, readable/*.csv, uploads.tar.gz, private.env)."
	echo "Follow 'Recover on a new Pi' in docs/familyhub/BACKUP_RESTORE.md." ;;
*)
	sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
