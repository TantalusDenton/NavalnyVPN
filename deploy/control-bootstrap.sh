#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y docker.io curl
bash /usr/local/sbin/navalny-mount-data
systemctl enable --now docker
docker rm -f navalnyvpn-proxy 2>/dev/null || true
docker run -d --name navalnyvpn-proxy --restart unless-stopped --network host \
  -v /etc/navalnyvpn/Caddyfile:/etc/caddy/Caddyfile:ro \
  -v /var/lib/navalnyvpn/caddy-data:/data -v /var/lib/navalnyvpn/caddy-config:/config \
  caddy:2.10.2-alpine
for attempt in $(seq 1 30); do
  docker inspect --format '{{.State.Running}}' navalnyvpn-proxy 2>/dev/null | grep -q true && exit 0
  sleep 2
done
exit 1
