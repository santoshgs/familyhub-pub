#!/usr/bin/env bash
# Remove one Family Hub account, by email, from the Pi's database (run with sudo).
#
#   sudo bash remove-account.sh --dry-run someone@example.test   # report only
#   sudo bash remove-account.sh someone@example.test             # report, back up, confirm, remove
#
# The app has no account-deletion path (Settings can only remove a member from a
# family), so this is the owner's tool for clearing an account such as a review
# or test login. Family data in Family Hub is keyed by the family owner's account,
# so removing an owner removes that family's records too (the database cascades).
# The script therefore refuses to remove an account that other accounts have
# joined as their family: that would delete the data they share.
#
# Before changing anything it prints what would be removed, takes a database dump
# into the root-only state directory, and asks you to type the address again.
# Running it again after a removal reports that no such account exists.
# Undo: restore the dump it names (pg_restore), as for a failed update.
set -euo pipefail
[[ ${EUID} -eq 0 ]] || { echo "Run with sudo." >&2; exit 2; }
usage() { echo "Usage: sudo bash $0 [--dry-run] <email>" >&2; exit 2; }

DRY_RUN=false
if [[ ${1:-} == --dry-run ]]; then DRY_RUN=true; shift; fi
[[ $# -eq 1 ]] || usage
EMAIL=$1
if (( ${#EMAIL} > 254 )) || [[ ! $EMAIL =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
	echo "That does not look like a plain email address. Nothing changed." >&2; exit 2
fi
STATE_DIR=${STATE_DIR:-/opt/familyhub/state}

# The release's PostgreSQL container, found by its Compose labels (not by name).
mapfile -t containers < <(docker ps -q --filter label=com.docker.compose.project=familyhub --filter label=com.docker.compose.service=postgres)
if [[ ${#containers[@]} -ne 1 ]]; then
	echo "Expected one running Family Hub database container, found ${#containers[@]}. Nothing changed." >&2; exit 1
fi
DB=${containers[0]}
# psql reads the SQL on stdin, so :'name' variables are quoted by psql itself.
sql() { docker exec -i "$DB" psql -U familyhub -d familyhub -X -q -At -F '|' -v ON_ERROR_STOP=1 "$@"; }

mapfile -t matches < <(sql -v email="$EMAIL" <<'SQL'
SELECT id, (family_owner_id IS NULL), to_char(created_at, 'YYYY-MM-DD') FROM users WHERE lower(email) = lower(:'email');
SQL
)
if [[ ${#matches[@]} -eq 0 ]]; then echo "No account uses $EMAIL. Nothing to do."; exit 0; fi
if [[ ${#matches[@]} -gt 1 ]]; then echo "More than one account matches $EMAIL. Nothing changed." >&2; exit 1; fi
IFS='|' read -r ID IS_OWNER CREATED <<<"${matches[0]}"
[[ $ID =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || { echo "Unexpected account id. Nothing changed." >&2; exit 1; }

MEMBERS=$(sql -v id="$ID" <<'SQL'
SELECT count(*) FROM users WHERE family_owner_id = :'id';
SQL
)
echo "Account: $EMAIL (created $CREATED)"
if [[ $IS_OWNER == t ]]; then echo "Role: owns its own family"; else echo "Role: member of another account's family (that family's data stays)"; fi
if [[ $MEMBERS != 0 ]]; then
	echo "Refusing: $MEMBERS other account(s) belong to this account's family. Removing it would delete the family data they share. Nothing changed." >&2
	exit 1
fi

# Every table that references the account and would lose rows with it.
echo "Rows that would be removed with it:"
REPORT=$(sql -v id="$ID" <<'SQL'
SELECT format('SELECT %L, count(*) FROM %s WHERE %I = %L HAVING count(*) > 0', c.conrelid::regclass::text || '.' || a.attname, c.conrelid::regclass, a.attname, :'id')
FROM pg_constraint c
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
WHERE c.contype = 'f' AND c.confrelid = 'users'::regclass AND c.confdeltype = 'c' AND array_length(c.conkey, 1) = 1
ORDER BY 1
\gexec
SQL
)
if [[ -n $REPORT ]]; then sed 's/^/  /; s/|/: /' <<<"$REPORT"; else echo "  (none besides the account itself)"; fi
if [[ $IS_OWNER == t ]]; then echo "Files this family uploaded (photos, avatars) stay in the uploads volume; nothing links to them afterwards."; fi

if $DRY_RUN; then echo "Dry run: nothing changed."; exit 0; fi

read -rp "Type the address again to remove this account: " ANSWER
[[ $ANSWER == "$EMAIL" ]] || { echo "The address did not match. Nothing changed."; exit 1; }

umask 077
install -d -m 0700 -o root -g root "$STATE_DIR"
BACKUP=$(mktemp -d "$STATE_DIR/pre-remove-account-XXXXXX")
if ! docker exec "$DB" pg_dump -U familyhub -d familyhub -Fc > "$BACKUP/database.dump"; then
	echo "The database backup failed, so nothing was removed. Partial backup: $BACKUP" >&2; exit 1
fi
echo "Backup: $BACKUP/database.dump"

# One statement: it removes the account only if still no one has joined its family.
REMOVED=$(sql -v id="$ID" <<'SQL'
DELETE FROM users WHERE id = :'id' AND NOT EXISTS (SELECT 1 FROM users m WHERE m.family_owner_id = :'id') RETURNING id;
SQL
)
if [[ $REMOVED != "$ID" ]]; then echo "The account was not removed (someone may have joined its family meanwhile). Nothing changed." >&2; exit 1; fi
logger -t familyhub-admin "removed one account (owner-run remove-account.sh)" 2>/dev/null || true
echo "Removed $EMAIL. Its sessions no longer work."
