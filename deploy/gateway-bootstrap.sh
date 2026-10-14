#!/usr/bin/env bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y openvpn easy-rsa docker.io curl unzip sqlite3 jq dnsutils
if ! command -v aws >/dev/null; then
  curl -fsSL https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip -o /tmp/awscli.zip
  unzip -q /tmp/awscli.zip -d /tmp
  /tmp/aws/install
fi
bash /usr/local/sbin/navalny-mount-data
systemctl enable --now docker
mkdir -p /var/lib/navalnyvpn/pihole /etc/openvpn/server /run/openvpn-server
chmod 755 /etc/openvpn/server
cd /var/lib/navalnyvpn
if [ ! -d easy-rsa ]; then cp -a /usr/share/easy-rsa easy-rsa; fi
cd easy-rsa
export EASYRSA_BATCH=1 EASYRSA_ALGO=ec EASYRSA_CURVE=prime256v1 EASYRSA_CA_EXPIRE=3650 EASYRSA_CERT_EXPIRE=365 EASYRSA_CRL_DAYS=3650
if [ ! -f pki/ca.crt ]; then
  ./easyrsa init-pki
  EASYRSA_REQ_CN=NavalnyVPN ./easyrsa build-ca nopass
fi
if [ ! -f pki/issued/server.crt ]; then ./easyrsa build-server-full server nopass; fi
./easyrsa gen-crl
install -m 644 pki/ca.crt /etc/openvpn/server/ca.crt
install -m 644 pki/issued/server.crt /etc/openvpn/server/server.crt
install -m 600 pki/private/server.key /etc/openvpn/server/server.key
install -m 644 pki/crl.pem /etc/openvpn/server/crl.pem
if [ ! -f /var/lib/navalnyvpn/tls-crypt.key ]; then openvpn --genkey secret /var/lib/navalnyvpn/tls-crypt.key; fi
install -m 600 /var/lib/navalnyvpn/tls-crypt.key /etc/openvpn/server/tls-crypt.key
cat > /etc/openvpn/server/server.conf <<'CONF'
port 1194
proto udp
dev tun0
topology subnet
server 10.8.0.0 255.255.255.0
server-ipv6 fd42:6e76:1::/64
push "redirect-gateway def1 ipv6"
push "dhcp-option DNS 10.8.0.1"
block-ipv6
ca /etc/openvpn/server/ca.crt
cert /etc/openvpn/server/server.crt
key /etc/openvpn/server/server.key
crl-verify /etc/openvpn/server/crl.pem
tls-crypt /etc/openvpn/server/tls-crypt.key
dh none
ecdh-curve prime256v1
tls-version-min 1.2
data-ciphers AES-256-GCM:AES-128-GCM:CHACHA20-POLY1305
allow-compression no
verify-client-cert require
remote-cert-tls client
keepalive 10 120
persist-key
persist-tun
user nobody
group nogroup
management /run/openvpn-server/navalnyvpn.sock unix
verb 1
CONF
sed \
  -e 's/^port 1194$/port 443/' \
  -e 's/^proto udp$/proto tcp-server/' \
  -e 's/^dev tun0$/dev tun1/' \
  -e 's/^server 10\.8\.0\.0 255\.255\.255\.0$/server 10.9.0.0 255.255.255.0/' \
  -e 's#^server-ipv6 fd42:6e76:1::/64$#server-ipv6 fd42:6e76:2::/64#' \
  -e 's#^management /run/openvpn-server/navalnyvpn.sock unix$#management /run/openvpn-server/navalnyvpn-obfuscated.sock unix#' \
  /etc/openvpn/server/server.conf > /etc/openvpn/server/obfuscated.conf
cat > /etc/sysctl.d/90-navalnyvpn.conf <<'CONF'
net.ipv4.ip_forward=1
net.ipv6.conf.all.forwarding=0
CONF
sysctl --system
systemctl enable --now openvpn-server@server
systemctl restart openvpn-server@server
systemctl enable --now openvpn-server@obfuscated
systemctl restart openvpn-server@obfuscated
cat > /etc/systemd/system/navalnyvpn-firewall.service <<'UNIT'
[Unit]
Description=NavalnyVPN routing and network isolation
After=network-online.target docker.service openvpn-server@server.service openvpn-server@obfuscated.service
Wants=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/navalny-firewall
RemainAfterExit=yes
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now navalnyvpn-firewall
# Free port 53 while retaining the host's VPC-provided resolver.
mkdir -p /etc/systemd/resolved.conf.d
printf '[Resolve]\nDNSStubListener=no\n' > /etc/systemd/resolved.conf.d/navalnyvpn.conf
ln -sf /run/systemd/resolve/resolv.conf /etc/resolv.conf
systemctl restart systemd-resolved
# Host networking exposes DNS only inside the host. SG and INPUT rules block public access.
image=$(jq -r .piholeImage /etc/navalnyvpn/node.json)
password_file=/var/lib/navalnyvpn/pihole-admin-password
if [ ! -f "$password_file" ]; then openssl rand -hex 32 > "$password_file"; chmod 600 "$password_file"; fi
docker rm -f pihole 2>/dev/null || true
docker run -d --name pihole --restart unless-stopped --network host \
  -e FTLCONF_dns_listeningMode=ALL \
  -e FTLCONF_dns_upstreams='1.1.1.1;1.0.0.1' \
  -e FTLCONF_dns_queryLogging=false \
  -e FTLCONF_database_maxDBdays=0 \
  -e FTLCONF_misc_privacylevel=3 \
  -e FTLCONF_webserver_port='127.0.0.1:8080' \
  -e FTLCONF_ntp_ipv4_active=false -e FTLCONF_ntp_ipv6_active=false \
  -e WEBPASSWORD_FILE=/run/secrets/admin-password \
  -v "$password_file:/run/secrets/admin-password:ro" \
  -v /var/lib/navalnyvpn/pihole:/etc/pihole \
  "$image"
for attempt in $(seq 1 90); do
  initial_count=$(sqlite3 /var/lib/navalnyvpn/pihole/gravity.db "SELECT value FROM info WHERE property='gravity_count';" 2>/dev/null || true)
  if [[ "$initial_count" =~ ^[1-9][0-9]*$ ]]; then break; fi
  sleep 2
done
# Wait for the container's initial gravity swap before modifying its database.
[[ "$initial_count" =~ ^[1-9][0-9]*$ ]] || { echo "Initial gravity build failed" >&2; exit 1; }
sqlite3 /var/lib/navalnyvpn/pihole/gravity.db <<'SQL'
INSERT OR IGNORE INTO adlist (address,enabled,comment) VALUES
('https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/pro.txt',1,'HaGeZi ads and trackers'),
('https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/nsfw.txt',1,'HaGeZi adult domains');
INSERT OR IGNORE INTO adlist_by_group (adlist_id,group_id) SELECT id,0 FROM adlist;
SQL
docker exec pihole pihole -g
# Refresh as the domain lists evolve.
cat > /etc/cron.d/navalnyvpn-gravity <<'CRON'
17 */8 * * * root docker exec pihole pihole -g >/dev/null 2>&1
CRON
/usr/local/sbin/navalny-profile health health
