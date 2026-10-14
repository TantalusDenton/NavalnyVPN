#!/usr/bin/env bash
set -euo pipefail
mkdir -p /var/lib/navalnyvpn /etc/navalnyvpn /etc/openvpn/server /run/openvpn-server /tmp/mock-bin /tmp/delivery
cp -a /usr/share/easy-rsa /var/lib/navalnyvpn/easy-rsa
cd /var/lib/navalnyvpn/easy-rsa
export EASYRSA_BATCH=1 EASYRSA_ALGO=ec EASYRSA_CURVE=prime256v1
./easyrsa init-pki >/dev/null 2>&1
EASYRSA_REQ_CN=NavalnyVPN-Test ./easyrsa build-ca nopass >/dev/null 2>&1
./easyrsa build-server-full server nopass >/dev/null 2>&1
./easyrsa gen-crl >/dev/null 2>&1
install -m 644 pki/ca.crt /etc/openvpn/server/ca.crt
install -m 644 pki/issued/server.crt /etc/openvpn/server/server.crt
install -m 600 pki/private/server.key /etc/openvpn/server/server.key
install -m 644 pki/crl.pem /etc/openvpn/server/crl.pem
openvpn --genkey secret /etc/openvpn/server/tls-crypt.key
awk '/^cat > \/etc\/openvpn\/server\/server.conf/{copy=1;next} copy && /^CONF$/{exit} copy{print}' /workspace/deploy/gateway-bootstrap.sh > /etc/openvpn/server/server.conf
printf '%s\n' '{"artifactBucket":"test-bucket","artifactRegion":"us-east-1","region":"eu-central-1","publicIp":"127.0.0.1"}' > /etc/navalnyvpn/node.json
install -m 700 /workspace/deploy/profile.sh /usr/local/sbin/navalny-profile
# Only cloud transport, systemd, and DNS readiness are mocked. PKI and the tunnel use real tools.
printf '#!/bin/sh\nexit 0\n' > /tmp/mock-bin/systemctl
printf '#!/bin/sh\nexit 0\n' > /tmp/mock-bin/docker
printf '#!/bin/sh\necho 93.184.215.14\n' > /tmp/mock-bin/dig
printf '#!/bin/sh\necho 2\n' > /tmp/mock-bin/sqlite3
cat > /tmp/mock-bin/aws <<'MOCK'
#!/bin/bash
set -e
if [ "$1 $2" = "s3 cp" ]; then cp "$3" /tmp/delivery/profile.ovpn; fi
if [ "$1 $2" = "s3 rm" ]; then rm -f /tmp/delivery/profile.ovpn; fi
MOCK
chmod 755 /tmp/mock-bin/*
export PATH="/tmp/mock-bin:$PATH"
openvpn --config /etc/openvpn/server/server.conf --writepid /tmp/server.pid --daemon --log /tmp/server.log
for i in $(seq 1 30); do [ -S /run/openvpn-server/navalnyvpn.sock ] && break; sleep 1; done
id=nv-12345678-1234-1234-1234-123456789abc
/usr/local/sbin/navalny-profile issue "$id" > /tmp/issue-output
grep -qx issued /tmp/issue-output
! grep -q 'BEGIN.*PRIVATE KEY' /tmp/issue-output
test ! -f "pki/private/$id.key"
python3 - <<'PY'
import re
profile=open("/tmp/delivery/profile.ovpn").read()
for tag in ("ca","cert","key"):
    text=re.search(r"<"+tag+r">\n(.*?)</"+tag+">", profile, re.S).group(1)
    open("/tmp/"+tag+".pem","w").write(text)
assert "remote-cert-tls server" in profile
assert "verify-x509-name server name" in profile
assert "<tls-crypt>" in profile
PY
openssl verify -CAfile /tmp/ca.pem -purpose sslclient /tmp/cert.pem
openssl x509 -in /tmp/cert.pem -pubkey -noout > /tmp/cert.pub
openssl pkey -in /tmp/key.pem -pubout > /tmp/key.pub
cmp /tmp/cert.pub /tmp/key.pub
openvpn --config /tmp/delivery/profile.ovpn --dev tun1 --route-nopull --writepid /tmp/client.pid --daemon --log /tmp/client.log --verb 3
connected=false
for i in $(seq 1 40); do
  if grep -q 'Initialization Sequence Completed' /tmp/client.log; then connected=true; break; fi
  sleep 1
done
if [ "$connected" != true ]; then cat /tmp/server.log /tmp/client.log; exit 1; fi
echo "PASS: signed inline profile establishes a real OpenVPN tunnel"
/usr/local/sbin/navalny-profile revoke "$id" > /tmp/revoke-output
grep -qx revoked /tmp/revoke-output
test ! -f /tmp/delivery/profile.ovpn
python3 - "$id" <<'PY'
import socket, sys
s=socket.socket(socket.AF_UNIX)
s.settimeout(5)
s.connect('/run/openvpn-server/navalnyvpn.sock')
s.recv(4096)
s.sendall(b'status 3\n')
data=b''
while b'\nEND' not in data:
    data+=s.recv(4096)
assert sys.argv[1].encode() not in data, 'Revoked client is still connected'
s.sendall(b'quit\n')
s.close()
PY
echo "PASS: revoked client is removed from the live session table"
if openssl verify -CAfile /tmp/ca.pem -CRLfile /etc/openvpn/server/crl.pem -crl_check /tmp/cert.pem >/tmp/revocation-check 2>&1; then echo "Revoked certificate was accepted" >&2; exit 1; fi
grep -q 'certificate revoked' /tmp/revocation-check
echo "PASS: CRL rejects revoked certificate and profile artifact is removed"
/usr/local/sbin/navalny-profile revoke "$id" >/dev/null
echo "PASS: revocation is idempotent"
if /usr/local/sbin/navalny-profile issue '../../escape' >/dev/null 2>&1; then exit 1; fi
echo "PASS: invalid certificate identifiers are rejected"
other=nv-abcdef12-1234-1234-1234-123456789abc
/usr/local/sbin/navalny-profile revoke "$other" >/dev/null
if /usr/local/sbin/navalny-profile issue "$other" >/dev/null 2>&1; then exit 1; fi
echo "PASS: revocation tombstone rejects delayed issuance"
