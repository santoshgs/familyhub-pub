#!/usr/bin/env bash
# Install or update the Pi admin helpers from this folder (run on the Pi as root):
#   sudo bash install-admin.sh
# Copies every helper to /opt/familyhub and every unit to /etc/systemd/system,
# reloads systemd and enables the timers and the credentials watcher. Safe to
# re-run after each release; it never touches secrets, the database or the
# running containers. The off-site backup units are installed only once
# setup-offsite-backup.sh has created /etc/familyhub-backup.env.
#
# To fetch this folder for a release on the Pi itself (the updater's read-only token):
#   tag=familyhub-vX.Y.Z; mkdir -p ~/familyhub-admin && cd ~/familyhub-admin
#   export GH_TOKEN=$(sed -n 's/^GH_TOKEN=//p' /opt/familyhub/github-release.env | tail -1)
#   gh api "repos/santoshgs/familyhub/tarball/$tag" | tar -xz --strip-components=4 --wildcards '*/deploy/familyhub/admin/*'
#   unset GH_TOKEN; sudo bash install-admin.sh
set -euo pipefail
[[ ${EUID} -eq 0 ]] || { echo "Run with sudo." >&2; exit 2; }
HERE=$(cd "$(dirname "$0")" && pwd)
cd "$HERE"

helpers=(check-renewals.sh apply-credentials.sh update-github-tokens.sh notify.sh remove-account.sh offsite-backup.sh restore-offsite-backup.sh)
units=(familyhub-renewals.service familyhub-renewals.timer familyhub-credentials.path familyhub-credentials.service)
backup_units=(familyhub-offsite-backup.service familyhub-offsite-backup.timer)

install -d -m 0755 /opt/familyhub
for f in "${helpers[@]}"; do
	[[ -f $f ]] || { echo "Missing $f in $HERE" >&2; exit 1; }
	install -m 0755 -o root -g root "$f" "/opt/familyhub/$f"
done
for f in "${units[@]}"; do install -m 0644 -o root -g root "$f" "/etc/systemd/system/$f"; done
if [[ -r /etc/familyhub-backup.env ]]; then
	for f in "${backup_units[@]}"; do install -m 0644 -o root -g root "$f" "/etc/systemd/system/$f"; done
fi
systemctl daemon-reload
systemctl enable --now familyhub-renewals.timer familyhub-credentials.path >/dev/null
[[ -r /etc/familyhub-backup.env ]] && systemctl enable --now familyhub-offsite-backup.timer >/dev/null

echo "Installed: ${helpers[*]}"
echo "Units: ${units[*]}$([[ -r /etc/familyhub-backup.env ]] && echo " ${backup_units[*]}")"
systemctl list-timers 'familyhub-*' --no-pager | sed -n '1,6p'
[[ -r /etc/familyhub-backup.env ]] || echo "Off-site backup not set up yet: sudo bash setup-offsite-backup.sh"
