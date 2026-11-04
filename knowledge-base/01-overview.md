# Project overview

[Knowledge base index](README.md) · [Using Family Hub](02-using-family-hub.md) · [Architecture](12-development-architecture.md)

Family Hub is a household dashboard built by extending [OpenFamily](https://github.com/NexaFlowFrance/OpenFamily). It presents a shared calendar, Google Tasks, family notes, daycare updates and selected OpenFamily modules in a responsive interface. It retains OpenFamily's account system, database, AI assistant, existing modules and licensing rather than introducing a separate family-data backend.

## Where the data lives

| Information | Source of truth | Notes |
| --- | --- | --- |
| Calendar events | Selected Google Calendar | Family Hub reads and creates events there; it does not create competing local appointments. |
| To-Dos | Selected Google Tasks list | Card actions and supported AI proposals use the same Google Tasks integration. |
| Notes, budget, rewards and preferences | Family Hub PostgreSQL database | Database backups and application configuration must be protected together. |
| Daycare messages | The dedicated Google mailbox | Family Hub processes matching HiMama/Lillio messages and retains a disposable normalized cache. |
| AI models | Configured provider | A configured model must be available at the chosen service; entering a name does not install it. |
| Weather, Formula 1, news | Open-Meteo, Jolpica F1, BBC News RSS | Read-only and cached on the Pi; the display shows attribution. |

Google's account is separate from the Family Hub sign-in. Use the dedicated family account for the shared calendar, its task list, and optional daycare email. Classroom is a placeholder; it is not a working Classroom integration.

## Current deployment

- Raspberry Pi 4, 4 GB RAM, Raspberry Pi OS Lite 64-bit based on Debian 13; the card reported approximately 128 GB, not the earlier 256 GB estimate.
- Docker runs PostgreSQL, the Express server and the web client. The web client listens on the Pi's loopback interface and Tailscale Serve provides private HTTPS.
- Releases `familyhub-v0.1.0` through `v0.3.5` were installed by the Pi's hourly updater. See [releases](09-releases-updates.md).
- A Frameo photo frame shows the read-only display over the home network through a display-only listener on the Pi. See [the photo frame](16-photo-frame.md).
- The Pi's GitHub tokens are set to never expire and its frame certificate renews itself; a daily check and Settings → Advanced show what is due. See [renewals](17-renewals-and-credentials.md).
- The owner confirmed the Pi-hosted page opened in Safari and that Calendar and To-Dos were visible. Visibility is not proof that every mutation, timezone edge case, or reconnection has been tested.
- A Pi database backup was restored in isolation and selected record counts matched. This is not a complete off-device disaster-recovery exercise.

## How we got here

1. Audited OpenFamily and built a fictional-data prototype. The owner accepted the prototype and testing.
2. Added local notes, authenticated access, server-enforced display restrictions and cache privacy protections.
3. Added one verified Google connection for Calendar and Tasks, followed by optional Gmail daycare support. Fictional email simulations passed; real daycare templates still need acceptance.
4. Restored the requested OpenFamily features, added the full selected-calendar view, theme choices, color legend and rearrangeable cards.
5. Published a private GitHub release, replaced the Pi's prior OS after explicit approval, migrated the database and preserved encryption keys, and configured private HTTPS and release checks.
6. Added the ambient display (v0.2–v0.3), put it on a photo frame, replaced frame sign-in with pairing codes, and added detail panels, night dimming, news with a reader view, chores, overflowing navigation and server-credential management (v0.3.1–v0.3.5, November 2, 2026).

See [project history and verification](14-history-and-verification.md) for the evidence and remaining gaps. Older roadmap and product files contain historical checkpoints and should not be read as a current deployment status.
