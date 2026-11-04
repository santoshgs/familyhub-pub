#!/usr/bin/env bash
# Send one push notification through ntfy. Best effort: never fails the caller.
#   notify.sh "Title" "Message" [priority: min|low|default|high|urgent] [tags]
# Settings (root, 0600): /etc/familyhub-notify.env with
#   NTFY_URL=https://ntfy.sh/<private random topic>
#   NTFY_TOKEN=<access token>   (optional, for a protected topic or self-hosted ntfy)
# The older /etc/familyhub-renewals.env NTFY_URL is still read as a fallback.
# Messages never carry secrets: only names, versions, dates and states.
set -u
title=${1:-Family Hub} message=${2:-} priority=${3:-default} tags=${4:-}
NTFY_URL='' NTFY_TOKEN=''
for f in /etc/familyhub-notify.env /etc/familyhub-renewals.env; do
	[[ -r $f ]] || continue
	[[ -z $NTFY_URL ]] && NTFY_URL=$(sed -n 's/^NTFY_URL=//p' "$f" | tail -1 | tr -d '"'"'")
	[[ -z $NTFY_TOKEN ]] && NTFY_TOKEN=$(sed -n 's/^NTFY_TOKEN=//p' "$f" | tail -1 | tr -d '"'"'")
done
[[ $NTFY_URL == https://* ]] || exit 0
args=(-s -o /dev/null -m 15 -H "Title: $title" -H "Priority: $priority")
[[ -n $tags ]] && args+=(-H "Tags: $tags")
# The token goes in a header file descriptor, never on the command line (visible in ps).
if [[ -n $NTFY_TOKEN ]]; then
	curl "${args[@]}" -H @<(printf 'Authorization: Bearer %s\n' "$NTFY_TOKEN") --data-binary "$message" "$NTFY_URL" || true
else
	curl "${args[@]}" --data-binary "$message" "$NTFY_URL" || true
fi
exit 0
