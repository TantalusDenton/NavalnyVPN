# Verification record — 2026-10-14

Completed locally without AWS credentials or resource creation:

- Six API/security tests passed: password/session behavior, CSRF, anonymous access, ownership, region validation, profile limits, drafts, single-use downloads, provisioning transitions, failed revocation/retry, expired artifacts, and production configuration guards.
- Vite production build and the multi-stage application Docker build passed. Dependency installation reported zero known vulnerabilities at test time.
- Terraform 1.9.8 with AWS provider 6.69.0 passed formatting and validation. Mock-provider plans passed for both the default three-region deployment and a Virginia-only deployment.
- A real OpenVPN 2.6.19 tunnel connected using the generated inline certificate/key profile. Revocation removed the client from the live session table, CRL verification rejected its certificate, and repeat revocation remained safe. Invalid identifiers and delayed issuance after revocation were rejected. System service readiness, blocklist readiness, and cloud transport were mocked in this fixture.
- Pi-hole image 2026.09.0 downloaded the actual HaGeZi ad and adult-domain lists. A normal domain resolved; selected ad and adult domains returned blocked responses. Privacy level 3, disabled query history, and loopback-only administration were verified. Its temporary test container was removed.
- Browser checks exercised local registration, draft profile creation/persistence, the account page, and sign-out. Desktop layout had no horizontal document overflow at 1440px. The narrow preview was inspected visually.
- Shell syntax checks passed for deployment scripts.

Not performed: live AWS apply, regional quota/IAM validation, Cognito email/callback testing, SSM-to-S3 delivery on AWS, public TLS/DNS activation, platform-specific DNS/IPv6 tests, throughput/load tests, backup/restore drills, or an independent security audit. Follow the deployment guide before launch.

No domain registration, DNS changes, public deployment, or external account creation was performed.
