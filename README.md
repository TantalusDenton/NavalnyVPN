# ! NavalnyVPN

A free-to-use VPN account portal with OpenVPN Community Edition gateways, Pi-hole DNS filtering, and Terraform for AWS. The `!` mark is the brand. The future domain is **navalnyvpn.net**.

**Nothing has been deployed to AWS, registered, or changed in DNS.** The local app saves draft profiles until real gateways are configured. Use an OpenVPN client to connect; the account website does not operate your OS VPN.

## Run locally

Use Node.js 22.13 or later. Node 22 is used by the Docker image.

```sh
npm ci
npm run dev
```

Open **http://localhost:5173**. Create a local account using an email and a password of at least 12 characters. Accounts and drafts persist in `data/navalnyvpn.sqlite`. The development API binds only to loopback. Local accounts have no email verification or recovery; deployed authentication uses Cognito.

```sh
npm test
npm run build
npm run package
```

The deployment archive at `build/navalnyvpn.tar.gz` contains source and the dependency lockfile. The AWS host builds the container from it. Local accounts, environment files, Terraform state, and private keys are excluded.

## Implemented

- Responsive dashboard, account page, profile manager, region selection, connection guide, and `!` branding.
- Local authentication with scrypt hashes and server-side sessions. Production Cognito managed login with verified email, recovery, optional TOTP support, authorization code + PKCE, state, nonce, and HttpOnly cookies. Browser code never receives Cognito tokens.
- Five current profiles per account. Individual 365-day EC device certificates, asynchronous issuance, single-use `.ovpn` downloads, retryable revocation, CRL updates, and immediate session termination on revocation.
- OpenVPN Community Edition over UDP/1194, AEAD ciphers, TLS 1.2 minimum, verified server certificates, and inline client credentials.
- Pi-hole v6 on every gateway. Ad/tracker and adult-domain lists, eight-hour gravity refresh, redirected standard DNS, blocked DNS-over-TLS, and disabled DNS query history.
- Independent gateways in Virginia (`us-east-1`), Frankfurt (`eu-central-1`), and Singapore (`ap-southeast-1`). A Virginia-only deployment is also supported.
- Encrypted EBS volumes for account data and regional PKI, protected against accidental Terraform destruction. No public SSH, DNS resolver, or Pi-hole admin port.

## AWS deployment

Read [the deployment guide](docs/deployment.md) for activation, validation, backups, and teardown.

```sh
npm ci
npm run package
cd infra
terraform init
terraform validate
terraform plan -out=navalnyvpn.tfplan
# Review the plan and AWS costs before applying.
terraform apply navalnyvpn.tfplan
```

The Terraform creates no domain registration, hosted zone, or DNS record. Domain activation is a later manual step. Caddy obtains HTTPS certificates once the operator points the intended hostname to the portal IP.

The service is **free for users**, not free to operate. AWS instances, public IPs, disks, snapshots, Cognito, S3, and outbound bandwidth incur charges. There is no subscription or payment flow.

## Practical limits

This is a deployment baseline, not an audited anonymity service. The portal uses one control host and SQLite. Each region has one gateway. There is no automatic failover, autoscaling, traffic obfuscation, native VPN client, or audited no-logs guarantee.

Pi-hole filters domain names. It cannot block every in-app ad, inspect encrypted pages, or guarantee adult-content blocking. DNS-over-HTTPS can bypass filtering. A compatible OpenVPN router can extend coverage to a home network; devices outside its tunnel are unaffected.

This IPv4 baseline routes IPv6 into the tunnel and blocks it server-side. Enable the client's kill switch and IPv6 protection and verify behavior on every supported platform before public launch. Linux OpenVPN Community needs resolver integration; see the guide.

## Project layout

| Path | Purpose |
|---|---|
| `web/` | React dashboard, responsive styles, locally served fonts |
| `server/` | Express, authentication, SQLite, SSM/S3 provisioning |
| `infra/` | Terraform, gateway module, credential-free plan tests |
| `deploy/` | Bootstrap, firewall, certificate and revocation scripts |
| `test/` | API/security tests and real OpenVPN tunnel fixture |
| `docs/deployment.md` | Deployment and operations |

## Tests

```sh
npm test
cd infra
terraform init -backend=false
terraform test
```

Terraform tests use mocked providers to plan one-region and three-region topologies without creating AWS resources. The API suite covers authentication, CSRF, ownership, profile limits, downloads, issuance/revocation, and production configuration guards.

The gateway integration fixture uses real Easy-RSA, OpenSSL, and OpenVPN. Cloud transport and system/DNS readiness are mocked; certificate creation, a tunnel handshake, and CRL rejection are real:

```sh
docker build -f test/gateway.Dockerfile -t navalnyvpn-gateway:test .
docker run --rm --cap-add NET_ADMIN --device /dev/net/tun navalnyvpn-gateway:test
```

On Windows, `./test/pihole-integration.ps1` checks the real Pi-hole image, downloads the configured lists, verifies normal/adult/ad DNS behavior, and removes its temporary container. Build the gateway test image above first.

## References and licenses

- [OpenVPN Community manual](https://openvpn.net/community-docs/community-articles/openvpn-2-6-manual.html)
- [Pi-hole Docker configuration](https://docs.pi-hole.net/docker/configuration/)
- [Pi-hole privacy controls](https://docs.pi-hole.net/ftldns/configfile/#privacylevel)
- [HaGeZi domain lists and licenses](https://github.com/hagezi/dns-blocklists)
- [Cognito authorization and PKCE](https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html)
- [Systems Manager Run Command](https://docs.aws.amazon.com/systems-manager/latest/userguide/run-command.html)

Third-party components retain their own licenses. Deployment installs upstream OpenVPN/Easy-RSA packages, runs the Pi-hole container, and downloads HaGeZi lists; their source is not copied into this repository.
