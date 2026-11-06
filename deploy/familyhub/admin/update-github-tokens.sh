#!/usr/bin/env bash
# Terminal alternative to Settings → Advanced → Server credentials (run as root).
# Prompts with hidden input and applies through the same tested path.
#   Release token: fine-grained, only the familyhub repository, Contents: read.
#   GHCR token: classic, read:packages only (GHCR accepts only classic tokens).
# Press Enter at a prompt to keep the current token.
#
# Hardened like apply-credentials.sh: the exchange directory is writable by the
# server container, so root never follows a path in it. A submission is written
# through its own descriptor to a new exclusive file in a no-follow handle on
# inbox/ (never truncating an existing file), checked, and renamed into place.
# Results are read from the root-only state directory the applier writes, not
# from the exchange. The script does not create inbox/; the server's exchange
# folder must already hold it (see deploy/familyhub/admin/README.md).
# Undo: nothing is installed or changed by this script itself; an unwanted
# submission can be removed with `sudo rm <exchange>/inbox/<kind>.json`.
set -euo pipefail
[[ ${EUID} -eq 0 ]] || { echo "Run with sudo." >&2; exit 2; }
EXCHANGE=${EXCHANGE:-/opt/familyhub/admin-exchange}
STATE_DIR=${STATE_DIR:-/opt/familyhub/admin-state}
APPLY=${APPLY:-/opt/familyhub/apply-credentials.sh}
CHECK=${CHECK:-/opt/familyhub/check-renewals.sh}
export EXCHANGE STATE_DIR CHECK

echo "This will hand the tokens you type to the credential applier ($APPLY)."
echo "It tests each token before replacing the current one. Nothing else changes."

# submit <kind>: reads the token on stdin (never argv) and drops
# inbox/<kind>.json into the exchange, root-owned and 0600.
SUBMIT_PY=$(cat <<'PY'
import json, os, re, stat, sys
exchange, kind = sys.argv[1:3]
if not re.fullmatch(r'[a-z][a-z-]{0,30}', kind):
    sys.exit('refusing an unexpected credential kind')
token = sys.stdin.read().strip()
if not token:
    sys.exit('refusing an empty token')
body = json.dumps({"kind": kind, "token": token}).encode()
try:
    efd = os.open(exchange, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    dfd = os.open('inbox', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=efd)
except OSError as error:
    sys.exit(f'refusing: {exchange}/inbox is missing, is not a directory or is a symlink ({error.strerror}). '
             'Nothing was written. The folder must be set up by the installed server, not created here.')
tmp = f'.{kind}.{os.getpid()}.{os.urandom(6).hex()}.tmp'
fd = -1
try:
    # O_EXCL | O_NOFOLLOW: always a brand new file, never a planted file or symlink.
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=dfd)
    os.fchmod(fd, 0o600)
    st = os.fstat(fd)
    if not stat.S_ISREG(st.st_mode) or st.st_uid != 0 or st.st_nlink != 1 or st.st_mode & 0o022:
        sys.exit('refusing: the new submission file is not a root-owned private regular file. Nothing was submitted.')
    view = memoryview(body)
    while view:
        view = view[os.write(fd, view):]
    os.fsync(fd)
    os.close(fd); fd = -1
    # rename() replaces whatever sits at the name (a planted symlink included)
    # without following it or writing through it.
    os.replace(tmp, f'{kind}.json', src_dir_fd=dfd, dst_dir_fd=dfd)
    tmp = None
finally:
    if fd >= 0:
        os.close(fd)
    if tmp:
        try: os.unlink(tmp, dir_fd=dfd)
        except OSError: pass
PY
)
submit() { python3 -c "$SUBMIT_PY" "$EXCHANGE" "$1"; }

# Prints the applier's outcome from the root-only state directory, after checking
# the directory and file are root-owned and not group/world writable.
SHOW_PY=$(cat <<'PY'
import json, os, stat, sys
def trusted(st, kind):
    return kind(st.st_mode) and st.st_uid == 0 and not st.st_mode & 0o022
try:
    sfd = os.open(sys.argv[1], os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    if not trusted(os.fstat(sfd), stat.S_ISDIR):
        sys.exit('results not shown: the state directory is not root-owned and private')
    fd = os.open('results.json', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=sfd)
    try:
        if not trusted(os.fstat(fd), stat.S_ISREG):
            sys.exit('results not shown: results.json is not a root-owned private file')
        data = json.loads(os.read(fd, 1 << 20))
    finally:
        os.close(fd)
except OSError as error:
    sys.exit(f'results not available yet: {error.strerror}')
for kind, value in data.items():
    clean = lambda text: ''.join(c for c in str(text) if c.isprintable())[:300]
    print(clean(kind) + ': ' + ('OK' if value.get('ok') else 'FAILED') + ' - ' + clean(value.get('message', '')))
PY
)

read -rsp 'New release token (fine-grained, Contents: read on santoshgs/familyhub), or Enter to keep: ' T; echo
if [[ -n $T ]]; then printf '%s' "$T" | submit github-release; fi; unset T
read -rsp 'New GHCR token (classic, read:packages), or Enter to keep: ' T; echo
if [[ -n $T ]]; then printf '%s' "$T" | submit ghcr; fi; unset T
"$APPLY"
python3 -c "$SHOW_PY" "$STATE_DIR" || true
echo; "$CHECK" || true
