# Family Hub knowledge base

This is the practical guide to Family Hub: what it does, how it was built, how to use and operate it, and how to recover it. Each article is a separate Markdown file that can be read and navigated on GitHub. Paths and addresses in examples are placeholders unless explicitly described as local project paths.

**Current checkpoint: November 6, 2026 (familyhub-v1.5.3 released; the Pi was last confirmed on v1.5.1).** Family Hub runs on a Raspberry Pi 4 behind Tailscale HTTPS and updates itself from versioned releases. v1.5.0 (released November 6) adds frame colour swatches, budget shared expenses with settle up and expense groups, fixed budget categories, and editing and deleting Google Calendar events. v1.5.1 adds importing Splitwise budget history. v1.5.2 adds a frame display layout chooser, faster frame detail panels, per-account menu order and the merged Settings → Display. v1.5.3 adds Restart Family Hub in Settings → Advanced, uniform Classic Settings sections, and an F1 card that keeps its last good race calendar through a failed refresh. Earlier: v1.2.0 (November 5) was the release installed and confirmed on the Pi before v1.3 and v1.4. Since v1.0 (November 4) it is its own product: unused OpenFamily modules and every language except English and French were removed, module switches are enforced by the server, and sign in with Google and ntfy alerts are built in. v1.1.0 (November 5) fixed all 33 verified findings of a Claude Security scan of `server/` and `deploy/`. v1.2.0 (November 5) added the frame's quick bar (guest Wi-Fi, countdown, markets, photos), richer weather and Formula 1 panels, **Settings → Display**, and **Settings → Advanced → Software updates**. Changes are built on a `develop` branch and previewed on the Mac at `/develop/` before release, and the running version is printed in the footer of the display and management pages. As of November 4, Dependabot and Snyk scans were clean apart from two accepted, build-only findings. A Frameo photo frame shows the read-only display over the home network, pairs with one-time codes, and returns to the dashboard after a restart. The Pi's GitHub tokens no longer expire, its certificate renews itself, and a daily check reports anything due. **Released in v1.4.0 (November 6):** a Board Book redesign of the management app's Home, navigation and Settings, behind a per-browser **Look** switch with Classic as the default; see [Classic and Board Book looks](18-management-look.md). **Not yet verified:** v1.2 on the physical frame, a working Google sign-in, ntfy alerts (not set up on the Pi), representative live daycare email processing, a deliberate rollback drill on the Pi and working Gemini inference. The security scan did not cover `client/`, `scripts/`, `shared/` or the code added after November 4's revision.

<img src="../docs/familyhub/images/display.jpg" alt="The FamilyHub display (fictional data)" width="720">

## Start here

| Article | What it covers |
| --- | --- |
| [Project overview](01-overview.md) | Goals, ownership, current status, phases and remaining work |
| [Using Family Hub](02-using-family-hub.md) | Dashboard, calendar, tasks, notes, appearance, budget and modules |
| [Accounts and access](03-accounts-and-access.md) | Sign-in, your name, parent and display access, password changes and account recovery |
| [The photo frame](16-photo-frame.md) | The photo frame, what it shows, pairing, setup from scratch and lessons learned |
| [Classic and Board Book looks](18-management-look.md) | The trial switch between the original look and the Board Book redesign of Home, navigation and Settings |

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
