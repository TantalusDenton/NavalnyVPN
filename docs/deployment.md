# Deploy and operate NavalnyVPN

## Architecture

```mermaid
flowchart LR
  Browser -->|HTTPS| Caddy
  Caddy --> API[React + Express portal]
  API -->|PKCE login| Cognito
  API --> SQLite[(Encrypted account EBS)]
  API -->|Restricted SSM document| Virginia
  API -->|Restricted SSM document| Frankfurt
  API -->|Restricted SSM document| Singapore
  Virginia -->|Encrypted temporary profile| S3[(Private S3)]
  Frankfurt --> S3
  Singapore --> S3
  S3 -->|Authenticated single download| API
  Client[OpenVPN client or router] -->|UDP 1194| Gateway[Chosen regional gateway]
  Gateway --> PiHole[Local Pi-hole]
  Gateway --> Internet
```

The control host and Cognito live in Virginia. Each region has an independent VPC, gateway, static IP, CA, CRL, Pi-hole, and persistent encrypted EBS volume. Client private keys are generated at the gateway, delivered over TLS through private encrypted S3, then removed locally. Downloaded objects are immediately deleted. SSM receives operation status, never a private key.

Gateway IAM roles can write/delete only their own regional S3 prefix. The portal can read/delete profile objects, read its exact source artifact, invoke only the named management documents on the specified gateways, and read command status. AWS does not support resource-level authorization for `ssm:GetCommandInvocation`, so that single action uses `Resource: *`. EC2 role trust uses the EC2 service principal; source-ARN conditions are not added to a flow that does not supply them.

The API uses host networking behind loopback Caddy and obtains AWS credentials from its instance role using IMDSv2. The metadata hop limit stays at 1. Firewall rules isolate VPN clients from metadata, private networks, host services, and each other. Standard DNS is redirected to Pi-hole; DNS-over-TLS is blocked. Pi-hole administration binds to loopback.

## Prepare

1. Install Node.js 22.13+, Terraform 1.9+, and AWS CLI v2. Authenticate with a provisioning identity. The application stores no AWS access keys.
2. Check regional quotas and costs. The default footprint is four `t3.small` instances, four public IPv4 addresses, and encrypted disks. Outbound VPN bandwidth can dominate cost. CPU credit mode is standard; sustained load can reduce throughput.
3. Review dependency/container releases, OS updates, blocklists, and licenses. Pin container digests for an immutable release. Fonts are served locally, with no external analytics or font requests.
4. Configure encrypted remote Terraform state and locking for team use. Until configured, this project uses local state. Protect state, snapshots, SSM access, Cognito administration, and regional CA disks.
5. Set AWS Budgets, operational alerts, and a backup schedule before a public launch. Those account-level operations are not performed by this baseline.

```sh
# From the project root:
npm ci
npm test
npm run build
npm run package
cd infra
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform fmt -check -recursive
terraform validate
terraform test
terraform plan -out=navalnyvpn.tfplan
```

PowerShell also supports `Copy-Item terraform.tfvars.example terraform.tfvars`.

Set `enabled_regions` to any supported set containing `us-east-1`. Use only `["us-east-1"]` for a smaller initial deployment. A new region needs an explicit provider alias, another gateway module invocation, and metadata in `local.gateways`; Terraform cannot select provider aliases dynamically.

## Apply and inspect bootstrap

After reviewing the saved plan and costs:

```sh
terraform apply navalnyvpn.tfplan
terraform output
```

Resource creation does not establish cloud-init readiness. Use SSM Session Manager, without opening SSH:

```sh
aws ssm start-session --target CONTROL_INSTANCE_ID --region us-east-1
# Inside the control host session:
sudo cloud-init status --wait
sudo docker ps
curl --fail http://127.0.0.1:3001/api/health
sudo journalctl -u cloud-final --no-pager -n 100
```

In each gateway's own region, inspect it through SSM:

```sh
sudo cloud-init status --wait
sudo /usr/local/sbin/navalny-profile health health
sudo systemctl status openvpn-server@server
sudo docker exec pihole pihole status
sudo docker exec pihole pihole -q doubleclick.net
sudo dig @10.8.0.1 example.com
sudo iptables -S NV-FORWARD
```

Validate actual blocked-domain DNS responses, too. An adult test domain can be selected from the configured list and queried without visiting it. Never expose public DNS or Pi-hole administration for debugging.

The Pi-hole UI is `127.0.0.1:8080` on each gateway. The random admin password is generated locally at `/var/lib/navalnyvpn/pihole-admin-password`; retrieve it only in your private SSM session. Use SSM port forwarding to access the UI privately.

## Activate DNS later

**No registration, hosted zone, or DNS record is created.** The intended hostname is `navalnyvpn.net`.

Once the domain is owned and activation is intended, manually create the A record shown by `terraform output future_dns_record`. It points the portal hostname to the portal static IP. Profiles use gateway static IPs, so gateway DNS records are optional. Do not add an AAAA record for this IPv4 baseline.

Caddy obtains HTTPS certificates after DNS resolves. Cognito's callback is `https://navalnyvpn.net/auth/callback`; logout returns to `https://navalnyvpn.net`. To use another hostname, change `domain` in Terraform and reapply so the proxy, allowed origin, and Cognito URLs agree.

Cognito managed login provides registration, email verification, password recovery, and sign-in. Its default email delivery has quotas; configure a verified SES sender before public service. Managed-login v2 branding is explicitly created per app client. The pool supports optional TOTP, but this baseline has no in-app MFA enrollment screen.

## Validate the live service

1. Register and verify an account through the deployed portal.
2. Create a profile for a device in one region. It becomes ready only after SSM reports successful issuance.
3. Download the `.ovpn` once. It contains a private key. Keep it out of Git, logs, tickets, shared links, and third-party testing sites. Revoke and replace if lost.
4. Import into OpenVPN Connect. Check external IPv4 against the selected gateway's output. Check DNS and ensure no native IPv6 escapes the tunnel.
5. Query normal and blocked domains, and confirm standard DNS directed to alternate resolvers is redirected. DNS-over-HTTPS may bypass filtering and needs browser/client policy for stricter control.
6. Confirm clients cannot access `169.254.169.254`, VPC private IPs, host administration, or each other.
7. Revoke the connected profile. Its existing session should terminate and reconnect must fail. Retry any displayed revocation error until confirmed.
8. Repeat in each region and on every supported client platform before opening public registration.

OpenVPN Community on Linux does not automatically apply `dhcp-option DNS`. Use NetworkManager's OpenVPN plugin or the distribution's `openvpn-systemd-resolved` integration. Configure kill switches and IPv6 protection explicitly. The website cannot control OS routing.

For household-wide protection, import a dedicated profile into an OpenVPN-compatible router. Route the intended household traffic through it, remove unintended split routes and alternate/secure DNS, and test IPv6 behavior. Devices outside that tunnel are unaffected. The VPN does not expose a home network to other VPN clients.

## Retention and privacy

- Every certificate is tied to an account, device name, and region. Certificates last 365 days; replace before expiry. CA/CRL validity is ten years and requires planned maintenance.
- Profile artifacts are stored in an unversioned encrypted private S3 bucket. Download deletes immediately; revocation requests deletion too. A one-day lifecycle rule cleans up unused objects asynchronously, not at a guaranteed exact time.
- Web sessions last one hour. Cognito ID/access tokens last 15 minutes and are discarded after verification; refresh tokens are not stored. Logging out does not revoke VPN profiles.
- SQLite stores email, device names, region, certificate IDs, dates, status, and download state. It never stores client private keys.
- Pi-hole DNS query history is disabled. OpenVPN verbosity is low. OS, AWS, SSM, upstream DNS, and operational logs can still contain metadata. This is not an audited no-logs/anonymity claim.
- Region cards show configuration, not continuous availability monitoring. The portal does not invent live latency, bandwidth, connection activity, or block counts.

## Backup, updates, and recovery

Data volumes use `prevent_destroy = true`. Take encrypted EBS snapshots in every region before upgrades or replacements. Configure AWS Backup or DLM for volumes tagged `NavalnyBackup=true`; scheduling is an operator task here.

Use SQLite's online backup API for consistent database backups, or briefly stop the portal before snapshotting. Back up the regional PKI as well. Restoring the database without matching PKI may make revocation impossible; restoring outdated CRLs can resurrect revoked profiles. Reconcile revocations before reopening restored gateways.

For app updates, run `npm run package`, review a new Terraform plan, and apply it. The content-addressed source artifact changes user data and replaces the portal host while retaining its data disk. Gateway script changes replace that gateway and reattach its PKI disk, briefly disconnecting users. Plan maintenance windows. Retained disks must stay in the same availability zone; an AZ migration needs a reviewed snapshot/restore procedure.

Maintain Ubuntu/OpenVPN packages and Pi-hole image releases. Gravity lists refresh every eight hours. Host patching, monitoring, abuse prevention, and backup automation remain operational responsibilities. For larger service, add a shared account database, portal redundancy, gateway capacity management, signing-key hardening, independent security review, and tested failover.

Existing tunnels can survive a control-host outage. A gateway outage disconnects its region. There is no automatic cross-region certificate failover.

## Teardown

`terraform destroy` is intentionally blocked by protected EBS volumes and Cognito deletion protection. The S3 bucket refuses deletion while nonempty. Before removing protections, export needed account data, back up or deliberately retire each CA, revoke access, and explicitly decide to delete the service. Then remove protections in reviewed source, empty the intended artifact bucket, and destroy reviewed resources. Remove any manually created DNS record separately.

## Verification boundaries

Local API tests, container builds, and mocked Terraform plans do not establish AWS permissions, quotas, email delivery, or DNS correctness. The gateway fixture uses real certificate tools and a real tunnel, while cloud transport and service/DNS readiness are mocked. Real Cognito callbacks, cross-region SSM/S3 delivery, external connectivity, platform-specific DNS/IPv6 behavior, throughput, and restoration must be verified on the live deployment.
