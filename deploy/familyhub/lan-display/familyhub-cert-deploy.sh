#!/bin/sh
# certbot deploy hook: copy the renewed LAN certificate where Caddy can read it.
set -eu
LIVE=${RENEWED_LINEAGE:-/etc/letsencrypt/live/$(. /etc/family-hub-lan/listener.env && echo "$FAMILYHUB_LAN_HOST")}
install -o root -g caddy -m 0644 "$LIVE/fullchain.pem" /etc/family-hub-lan/lan-cert.pem
install -o root -g caddy -m 0640 "$LIVE/privkey.pem" /etc/family-hub-lan/lan-key.pem
if systemctl is-active --quiet caddy; then systemctl reload caddy; fi
