#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y docker.io curl unzip jq
if ! command -v aws >/dev/null; then
  curl -fsSL https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip -o /tmp/awscli.zip
  unzip -q /tmp/awscli.zip -d /tmp
  /tmp/aws/install
fi
bash /usr/local/sbin/navalny-mount-data
systemctl enable --now docker
mkdir -p /opt/navalnyvpn
bucket=$(jq -r .artifactBucket /etc/navalnyvpn/node.json)
key=$(jq -r .archiveKey /etc/navalnyvpn/node.json)
region=$(jq -r .artifactRegion /etc/navalnyvpn/node.json)
aws s3 cp "s3://$bucket/$key" /opt/navalnyvpn/app.tar.gz --region "$region" --only-show-errors
tar -xzf /opt/navalnyvpn/app.tar.gz -C /opt/navalnyvpn
cd /opt/navalnyvpn
docker build -t navalnyvpn:local .
mkdir -p /var/lib/navalnyvpn/app
chown -R 1000:1000 /var/lib/navalnyvpn/app
docker rm -f navalnyvpn 2>/dev/null || true
docker run -d --name navalnyvpn --restart unless-stopped --network host \
  -e NODE_ENV=production -e HOST=127.0.0.1 -e PORT=3001 \
  -e DATA_DIR=/data -e RUNTIME_CONFIG=/run/navalnyvpn/runtime.json \
  -v /var/lib/navalnyvpn/app:/data \
  -v /etc/navalnyvpn/runtime.json:/run/navalnyvpn/runtime.json:ro \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,size=32m --cap-drop ALL --security-opt no-new-privileges \
  navalnyvpn:local
# Caddy obtains TLS only when the operator later points the domain to this host.
docker rm -f navalnyvpn-proxy 2>/dev/null || true
docker run -d --name navalnyvpn-proxy --restart unless-stopped --network host \
  -v /etc/navalnyvpn/Caddyfile:/etc/caddy/Caddyfile:ro \
  -v /var/lib/navalnyvpn/caddy-data:/data -v /var/lib/navalnyvpn/caddy-config:/config \
  caddy:2.10.2-alpine
for attempt in $(seq 1 90); do
  curl --fail --silent http://127.0.0.1:3001/api/health >/dev/null && exit 0
  sleep 2
done
exit 1
