#!/usr/bin/env bash
# Terminal alternative to Settings → Advanced → Server credentials (run as root).
# Prompts with hidden input and applies through the same tested path.
#   Release token: fine-grained, only the familyhub repository, Contents: read.
#   GHCR token: classic, read:packages only (GHCR accepts only classic tokens).
# Press Enter at a prompt to keep the current token.
set -euo pipefail
[[ ${EUID} -eq 0 ]] || { echo "Run with sudo." >&2; exit 2; }
INBOX=/opt/familyhub/admin-exchange/inbox
install -d -m 0700 "$INBOX"
submit() { python3 -c 'import json,sys,os; fd=os.open(sys.argv[1], os.O_WRONLY|os.O_CREAT|os.O_TRUNC, 0o600); os.write(fd, json.dumps({"kind": sys.argv[2], "token": sys.stdin.read().strip()}).encode())' "$INBOX/$1.json" "$1"; }
read -rsp 'New release token (fine-grained, Contents: read on santoshgs/familyhub), or Enter to keep: ' T; echo
[[ -n $T ]] && printf '%s' "$T" | submit github-release; unset T
read -rsp 'New GHCR token (classic, read:packages), or Enter to keep: ' T; echo
[[ -n $T ]] && printf '%s' "$T" | submit ghcr; unset T
/opt/familyhub/apply-credentials.sh
python3 -c 'import json; [print(k + ": " + ("OK" if v["ok"] else "FAILED") + " - " + v["message"]) for k, v in json.load(open("/opt/familyhub/admin-exchange/results.json")).items()]' 2>/dev/null || true
echo; /opt/familyhub/check-renewals.sh || true
