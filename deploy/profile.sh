#!/usr/bin/env bash
set -euo pipefail
umask 077
action="${1:-}"
id="${2:-}"
[[ "$action" =~ ^(issue|revoke|health)$ ]] || exit 2
if [ "$action" = health ]; then
  systemctl is-active --quiet openvpn-server@server
  systemctl is-active --quiet openvpn-server@obfuscated
  docker exec pihole pihole status >/dev/null
  list_count=$(sqlite3 /var/lib/navalnyvpn/pihole/gravity.db "SELECT COUNT(*) FROM adlist WHERE enabled=1 AND (number+abp_entries)>0 AND comment IN ('HaGeZi ads and trackers','HaGeZi adult domains');")
  [ "$list_count" -eq 2 ] || { echo "Required blocklists are not ready" >&2; exit 1; }
  dig +short +time=3 @10.8.0.1 example.com | grep -q .
  echo ready
  exit 0
fi
[[ "$id" =~ ^nv-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$ ]] || exit 2
exec 9>/var/lib/navalnyvpn/ca.lock
flock -w 90 9
cd /var/lib/navalnyvpn/easy-rsa
export EASYRSA_BATCH=1 EASYRSA_ALGO=ec EASYRSA_CURVE=prime256v1 EASYRSA_CERT_EXPIRE=365 EASYRSA_CRL_DAYS=3650
bucket=$(jq -r .artifactBucket /etc/navalnyvpn/node.json)
region=$(jq -r .artifactRegion /etc/navalnyvpn/node.json)
gateway_region=$(jq -r .region /etc/navalnyvpn/node.json)
if [ "$action" = revoke ]; then
  # A persistent tombstone also blocks delayed issue commands after a timeout.
  mkdir -p /var/lib/navalnyvpn/revoked
  touch "/var/lib/navalnyvpn/revoked/$id"
  # Missing certs and already revoked certs are safe, idempotent outcomes.
  if grep -q "^V.*CN=$id$" pki/index.txt; then ./easyrsa revoke "$id" >/dev/null 2>&1; fi
  ./easyrsa gen-crl >/dev/null 2>&1
  install -m 644 pki/crl.pem /etc/openvpn/server/crl.pem.new
  mv /etc/openvpn/server/crl.pem.new /etc/openvpn/server/crl.pem
  # Disconnect existing sessions immediately, without interrupting other devices.
  python3 - "$id" <<'PY'
import socket, sys
for path in ("/run/openvpn-server/navalnyvpn.sock", "/run/openvpn-server/navalnyvpn-obfuscated.sock"):
    s = socket.socket(socket.AF_UNIX)
    s.settimeout(5)
    s.connect(path)
    s.recv(4096)
    s.sendall(("kill " + sys.argv[1] + "\n").encode())
    response = s.recv(4096).decode()
    if "SUCCESS:" not in response and "not found" not in response:
        raise RuntimeError("Could not confirm active-session revocation")
    s.sendall(b"quit\n")
    s.close()
PY
  rm -f "pki/private/$id.key"
  aws s3 rm "s3://$bucket/profiles/$gateway_region/$id.ovpn" --region "$region" --only-show-errors
  echo revoked
  exit 0
fi
# Keys never go to stdout, SSM output, or Terraform state.
/usr/local/sbin/navalny-profile health health >/dev/null
[ ! -f "/var/lib/navalnyvpn/revoked/$id" ] || { echo "Certificate identifier was revoked" >&2; exit 1; }
host=$(jq -r .publicIp /etc/navalnyvpn/node.json)
[[ "$host" =~ ^[0-9.]+$ ]] || exit 2
[ ! -f "pki/issued/$id.crt" ] || { echo "Certificate already exists; revoke before retrying" >&2; exit 1; }
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"; rm -f "pki/private/$id.key"' EXIT
./easyrsa build-client-full "$id" nopass >/dev/null 2>&1
{
  cat <<CONF
client
dev tun
resolv-retry infinite
nobind
persist-key
persist-tun
remote-cert-tls server
verify-x509-name server name
tls-version-min 1.2
data-ciphers AES-256-GCM:AES-128-GCM:CHACHA20-POLY1305
allow-compression no
auth-nocache
ignore-unknown-option block-outside-dns
block-outside-dns
verb 1
<tls-crypt>
CONF
  cat /etc/openvpn/server/tls-crypt.key
  cat <<CONF
</tls-crypt>
connect-retry 1
connect-retry-max 1
<connection>
remote $host 1194 udp
connect-timeout 5
</connection>
<connection>
remote $host 443 tcp-client
connect-timeout 5
</connection>
<ca>
CONF
  cat pki/ca.crt
  printf '</ca>\n<cert>\n'
  openssl x509 -in "pki/issued/$id.crt" -outform PEM
  printf '</cert>\n<key>\n'
  cat "pki/private/$id.key"
  printf '</key>\n'
} > "$temporary/profile.ovpn"
aws s3 cp "$temporary/profile.ovpn" "s3://$bucket/profiles/$gateway_region/$id.ovpn" --region "$region" --sse AES256 --only-show-errors
echo issued
