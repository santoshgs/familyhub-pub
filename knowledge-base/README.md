# Family Hub knowledge base

This is the practical guide to Family Hub: what it does, how it was built, how to use and operate it, and how to recover it. Each article is a separate Markdown file that can be read and navigated on GitHub. Paths and addresses in examples are placeholders unless explicitly described as local project paths.

**Current checkpoint: November 4, 2026 (familyhub-v0.3.7).** FamilyHub runs on a Raspberry Pi 4 behind Tailscale HTTPS and updates itself from versioned releases (v0.1.0 → v0.3.5 confirmed installed this way; v0.3.6 and v0.3.7 were published on November 4 for the hourly updater). Changes are now built on a `develop` branch and previewed on the Mac at `/develop/` before release, and the running version is printed in the footer of the display and management pages. Dependabot and Snyk scans are clean apart from two accepted, build-only findings. An inexpensive Frameo photo frame shows the read-only display over the home network, pairs with one-time codes, and returns to the dashboard after a restart. The Pi's GitHub tokens no longer expire, its certificate renews itself, and a daily check reports anything due. Representative live daycare email processing, a deliberate rollback drill and working Gemini inference remain unverified.

<img src="../docs/familyhub/images/display.jpg" alt="The FamilyHub display (fictional data)" width="720">

## Start here

| Article | What it covers |
| --- | --- |
| [Project overview](01-overview.md) | Goals, ownership, current status, phases and remaining work |
| [Using Family Hub](02-using-family-hub.md) | Dashboard, calendar, tasks, notes, appearance, budget and modules |
| [Accounts and access](03-accounts-and-access.md) | Sign-in, your name, parent and display access, password changes and account recovery |
| [The photo frame](16-photo-frame.md) | The photo frame, what it shows, pairing, setup from scratch and lessons learned |

## Integrations

| Article | What it covers |
| --- | --- |
| [Google Calendar and Tasks](04-google-calendar-tasks.md) | Dedicated Google account, OAuth, source selection and live verification |
| [Daycare updates from Gmail](05-daycare-gmail.md) | Lillio/HiMama messages, optional consent, parsing and privacy |
| [AI assistant](06-ai-assistant.md) | OpenFamily model providers, Ollama, proposal review and Gemini troubleshooting |

## Operations

| Article | What it covers |
| --- | --- |
| [Raspberry Pi deployment](07-raspberry-pi.md) | Installed stack, LAN display listener, firewall, SSH and health checks |
| [Tailscale, HTTPS and DNS](08-tailscale-networking.md) | Connecting devices, MagicDNS, the DNS resolver troubleshooting, private access and the frame's LAN name |
| [Releases and updates](09-releases-updates.md) | GitHub Actions, versioned packages, automatic checks and rollback limits |
| [Backup and recovery](10-backup-recovery.md) | What to preserve, tested restores, safe recovery and incident steps |
| [Renewals and credentials](17-renewals-and-credentials.md) | What expires, what renews itself, replacing a token from Settings → Advanced |
| [Troubleshooting](11-troubleshooting.md) | Common sign-in, networking, photo frame, Google, AI, local-port and service problems |

## Development and governance

| Article | What it covers |
| --- | --- |
| [Development and architecture](12-development-architecture.md) | Code layout, data flow, migrations, environments, builds and tests |
| [Security and privacy](13-security-privacy.md) | Secrets, access boundaries, provider data, backups and safe disclosure |
| [Project history and verification](14-history-and-verification.md) | Milestones, evidence, known gaps and links to historical records |
| [Glossary and reference](15-glossary-reference.md) | Terms, file locations, commands, and primary project references |

Ideas for future builds are collected in [WISHLIST.md](../WISHLIST.md). The older files under [`docs/familyhub/`](../docs/familyhub/) document individual development increments. Some passages there describe the state *at the time they were written*, including the pre-deployment prototype. Prefer this index and the dated checkpoint above for orientation; consult source code and current runtime status before operational changes. Never put secrets or household data in documentation, issues, screenshots or Git history.
